// 報告の処理(キューの中で動く): 受信 → 分類 → 構造化 → 畳み込み → ボード更新 → スレッド返事
//
// 守ること(CLAUDE.md、設計書 5-2・9章)
// - 報告は追記のみ。原本(reports)と構造化の結果(report_versions の版1)を分けて積む
// - 同一人物の5分以内の送信は畳み込む。元の送信も残し、畳み込み先を参照で結ぶ
// - 判定は送信時刻で行う(ボードの日付も送信時刻の JST)
// - スタッフへの返事は、本人が送ってきたものへのスレッド返事だけ(承認不要)。オーナー宛てのトラブル通知も承認不要
// - オーナー・副担当の投稿は報告として数えない
// - 本文はログに出さない

import type { ReportEvent } from "../channels/report-event";
import { jstDate } from "../lib/time";
import type { SlackClient } from "../slack/api";
import { ensureBoard, markDone, markNeedsRecheck, resyncBoard } from "./board";
import type { Resolver } from "./clarify";
import type { ModelCall } from "../knowledge/agent";
import type { RuleDrafter } from "../rules/candidate";
import { md, ruleOrigin } from "../rules/origin";
import { handleOwnerAnswer, handleQuestion, lookupPerson, type QuestionOutcome } from "../knowledge/handle";
import { composeReply, type Structurer, type StructureResult } from "./structure";

export type ProcessDeps = {
  structure: Structurer;
  resolve: Resolver;
  agent: ModelCall; // 引き継ぎ帳のエージェント(claude-opus-5-5)
  draftRule: RuleDrafter; // 判断の答えからルール候補の文面を下書きする
  slack: SlackClient;
  newId?: () => string;
};

export type ProcessOutcome =
  | { kind: "ignored"; reason: string }
  | { kind: "not_report"; categories: string[]; findingId: string | null; question?: QuestionOutcome }
  | {
      kind: "report";
      reportId: string;
      mergedInto: string | null;
      areas: string[];
      boardUpdated: number;
      needsRecheck: number;
      replied: boolean;
      findingId: string | null;
      ruleFindings: { findingId: string; ruleNo: number }[];
      question?: QuestionOutcome;
    }
  | QuestionOutcome
  | { kind: "clarified"; reportId: string; version: number; areas: string[]; replied: boolean };

const MAX_IMAGES = 4;

type Store = { id: string; name: string; tone_sample: string | null };
type Person = { id: string; display_name: string; role: "staff" | "sub" | "owner" };

export async function processReportEvent(db: D1Database, ev: ReportEvent, deps: ProcessDeps): Promise<ProcessOutcome> {
  const newId = deps.newId ?? (() => crypto.randomUUID());

  // ボットへの DM: 写真つきなら本人の主な店舗への清掃報告(11/3 実機: DM に写真を送ったら空の質問としてオーナーに飛んだ)。
  // 文だけならスタッフ・副担当の質問、オーナーが問い合わせのスレッドで答えたものは引き継ぎ帳
  let store: Store | null = null;
  if (ev.isDirect) {
    const person = await lookupPerson(db, ev.senderRef);
    if (!person) return { kind: "ignored", reason: "unknown_sender" };
    const kdeps = { slack: deps.slack, agent: deps.agent, draftRule: deps.draftRule, newId };
    if (ev.isReplyInThread) {
      if (person.role !== "staff") return handleOwnerAnswer(db, ev, kdeps, person);
      // スタッフが DM の報告のスレッドで聞き返しに答えた
      store = person.home_store_id ? await db.prepare("SELECT id, name, tone_sample FROM stores WHERE id = ?").bind(person.home_store_id).first<Store>() : null;
      return store ? processClarifyAnswer(db, ev, deps, newId, store) : { kind: "ignored", reason: "thread_reply" };
    }
    if (person.role === "owner") return { kind: "ignored", reason: "operator_post" };
    if (ev.images.length === 0) {
      if (!ev.text) return { kind: "ignored", reason: "empty" };
      return handleQuestion(db, ev, kdeps, { store: null, sender: person });
    }
    store = person.home_store_id ? await db.prepare("SELECT id, name, tone_sample FROM stores WHERE id = ?").bind(person.home_store_id).first<Store>() : null;
    if (!store) {
      await deps.slack.postMessage(ev.channelRef, "写真を受け取りましたが、どの店の報告か分かりませんでした。店舗のチャンネルに送ってください。", ev.threadRef).catch(() => undefined);
      return { kind: "ignored", reason: "no_home_store" };
    }
  } else {
    store = await db
      .prepare("SELECT id, name, tone_sample FROM stores WHERE slack_channel_id = ?")
      .bind(ev.channelRef)
      .first<Store>();
    if (!store) return { kind: "ignored", reason: "unknown_channel" };
  }

  // スレッドの中の返事は、聞き返しへの答えのときだけ扱う(報告として数えない)
  if (ev.isReplyInThread) return processClarifyAnswer(db, ev, deps, newId, store);

  // Slack の再送やキューの再配達で同じ送信が二度来ても、一度しか処理しない
  const seen = await db
    .prepare("SELECT 1 FROM reports WHERE channel = ? AND channel_ref = ? AND message_ref = ?")
    .bind(ev.channel, ev.channelRef, ev.messageRef)
    .first();
  if (seen) return { kind: "ignored", reason: "duplicate" };

  const sender = await db
    .prepare("SELECT id, display_name, role FROM staff WHERE slack_user_id = ? AND status = 'active'")
    .bind(ev.senderRef)
    .first<Person>();
  if (sender && sender.role !== "staff") return { kind: "ignored", reason: "operator_post" };

  const { results: areas } = await db
    .prepare("SELECT id, name FROM areas WHERE store_id = ? AND active = 1 ORDER BY sort_order")
    .bind(store.id)
    .all<{ id: string; name: string }>();

  const images: { base64: string; mediaType: string }[] = [];
  let unreadable = 0;
  for (const img of ev.images.slice(0, MAX_IMAGES)) {
    const got = await deps.slack.fetchImage(img.url).catch(() => null);
    if (got) images.push(got);
    else unreadable++;
  }
  unreadable += Math.max(0, ev.images.length - MAX_IMAGES);

  const rules = await activeJudgmentRules(db, store.id);
  const { result, usage } = await deps.structure({
    storeName: store.name,
    areas,
    senderName: sender?.display_name ?? null,
    toneSample: store.tone_sample,
    text: ev.text,
    images,
    imagesUnreadable: unreadable,
    rules: rules.map((r) => ({ no: r.rule_no, text: r.natural_text })),
  });
  // Claude 呼び出し1回あたりの消費を実測する(本文は出さない)
  console.log(JSON.stringify({ claude: "structure", ...usage, images: images.length, categories: result.categories }));

  const isReport = result.categories.includes("cleaning_report");
  const hasTrouble = result.categories.includes("request_trouble") || !!result.trouble;
  // 質問は引き継ぎ帳へ(報告と質問の両方に当たる投稿は両方)
  const askQuestion = async () =>
    result.categories.includes("question")
      ? handleQuestion(db, ev, { slack: deps.slack, agent: deps.agent, draftRule: deps.draftRule, newId }, { store: await storeRow(db, store.id), sender: await lookupPerson(db, ev.senderRef) })
      : undefined;

  if (!isReport) {
    const findingId = hasTrouble ? await recordTrouble(db, deps, newId, store, sender, ev, result, null) : null;
    await recordRuleMatches(db, deps, newId, store, sender, ev, result, rules, images.length, null);
    const question = await askQuestion();
    return { kind: "not_report", categories: result.categories, findingId, ...(question ? { question } : {}) };
  }

  // 畳み込み: 同じ人が同じ店に、この送信の前 N 分以内に送った報告があれば、その畳み込み先に結ぶ
  const org = await db.prepare("SELECT merge_window_minutes FROM org_settings WHERE id = 1").first<{ merge_window_minutes: number }>();
  const windowMs = (org?.merge_window_minutes ?? 5) * 60_000;
  const since = new Date(new Date(ev.sentAt).getTime() - windowMs).toISOString();
  const prev = await db
    .prepare(
      `SELECT id, merged_into_report_id FROM reports
        WHERE store_id = ? AND sender_ref = ? AND channel = ? AND sent_at >= ? AND sent_at <= ?
        ORDER BY sent_at ASC LIMIT 1`,
    )
    .bind(store.id, ev.senderRef, ev.channel, since, ev.sentAt)
    .first<{ id: string; merged_into_report_id: string | null }>();
  const mergedInto = prev ? (prev.merged_into_report_id ?? prev.id) : null;

  const reportId = newId();
  await db.batch([
    db
      .prepare(
        `INSERT INTO reports (id, store_id, sender_ref, sender_staff_id, sent_at, received_at, raw_text, image_ids,
                              channel, channel_ref, message_ref, merged_into_report_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        reportId,
        store.id,
        ev.senderRef,
        sender?.id ?? null,
        ev.sentAt,
        new Date().toISOString(),
        ev.text,
        JSON.stringify(ev.images.map((i) => i.id)),
        ev.channel,
        ev.channelRef,
        ev.messageRef,
        mergedInto,
      ),
    db
      .prepare(
        `INSERT INTO report_versions (id, report_id, version, performer_staff_id, areas, supplies_out, trouble, memo,
                                      confidence, basis, basis_ref, model)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 'structuring', NULL, ?)`,
      )
      .bind(
        newId(),
        reportId,
        sender?.id ?? null,
        JSON.stringify(result.areas),
        JSON.stringify(result.supplies_out),
        result.trouble,
        result.memo,
        result.confidence,
        usage.model,
      ),
  ]);

  // 遅れて届いた報告: この報告より前の入室で「報告なし」と検出していたら取り下げる(承認前の下書きも消える)
  if (sender) await withdrawUnreported(db, store.id, sender.id, ev.sentAt);

  const date = jstDate(new Date(ev.sentAt)).iso;
  await ensureBoard(db, store.id, date);
  // 汚れ・ゴミが残っている箇所は完了にしない(要確認)。それ以外の箇所を完了に
  const leftoverAreas = new Set(result.leftover.map((l) => l.area));
  const boardUpdated = await markDone(db, store.id, date, result.areas.filter((a) => !leftoverAreas.has(a)), mergedInto ?? reportId);
  const needsRecheck = await markNeedsRecheck(db, store.id, date, result.leftover, mergedInto ?? reportId);

  const findingId = hasTrouble ? await recordTrouble(db, deps, newId, store, sender, ev, result, reportId) : null;
  const ruleFindings = await recordRuleMatches(db, deps, newId, store, sender, ev, result, rules, images.length, reportId);

  let replied = false;
  const reply = composeReply(result, (id) => areas.find((a) => a.id === id)?.name ?? id);
  if (reply) {
    const res: { ok: boolean; ts?: string } = await deps.slack
      .postMessage(ev.channelRef, reply, ev.threadRef)
      .catch(() => ({ ok: false }));
    replied = res.ok;
    // 聞き返しを送れたら記録する(1報告に1回だけ)。答えがこのスレッドに来たら版2を積む
    const asked = result.leftover.length
      ? `${result.leftover.map((l) => `${areas.find((a) => a.id === l.area)?.name ?? l.area}の${l.what}`).join("、")}が見えます。拾ってもらえますか?`
      : result.clarify_question;
    if (res.ok && asked) {
      await db
        .prepare("INSERT OR IGNORE INTO clarifications (id, report_id, question, asked_ref, asked_at) VALUES (?, ?, ?, ?, ?)")
        .bind(newId(), reportId, asked, res.ts ?? null, new Date().toISOString())
        .run();
    }
  }

  const question = await askQuestion();
  return {
    kind: "report",
    reportId,
    mergedInto,
    areas: result.areas,
    boardUpdated,
    needsRecheck,
    replied,
    findingId,
    ruleFindings,
    ...(question ? { question } : {}),
  };
}

async function storeRow(db: D1Database, id: string) {
  return db.prepare("SELECT id, name, closed_days FROM stores WHERE id = ?").bind(id).first<{ id: string; name: string; closed_days: string }>();
}

// 聞き返しへの答え: 報告した本人が、問いを載せた受付のスレッドで答えたら、版2を積んでボードを合わせ直す
async function processClarifyAnswer(
  db: D1Database,
  ev: ReportEvent,
  deps: ProcessDeps,
  newId: () => string,
  store: Store,
): Promise<ProcessOutcome> {
  const report = await db
    .prepare(
      `SELECT r.id, r.sender_ref, r.sent_at, r.raw_text, r.image_ids, r.merged_into_report_id,
              c.question
         FROM reports r JOIN clarifications c ON c.report_id = r.id
        WHERE r.channel = ? AND r.channel_ref = ? AND r.message_ref = ?`,
    )
    .bind(ev.channel, ev.channelRef, ev.threadRef)
    .first<{
      id: string;
      sender_ref: string;
      sent_at: string;
      raw_text: string;
      image_ids: string;
      merged_into_report_id: string | null;
      question: string;
    }>();
  if (!report) return { kind: "ignored", reason: "thread_reply" };
  if (report.sender_ref !== ev.senderRef) return { kind: "ignored", reason: "not_reporter" };

  // 聞き返しは1回だけ。答えが一度反映されたら、それ以降のスレッドの投稿では版を積まない
  const answered = await db
    .prepare("SELECT 1 FROM report_versions WHERE report_id = ? AND basis = 'staff_reply'")
    .bind(report.id)
    .first();
  if (answered) return { kind: "ignored", reason: "already_answered" };

  const cur = await db
    .prepare("SELECT version, performer_staff_id, areas, supplies_out, trouble, memo, confidence FROM reports_current WHERE id = ?")
    .bind(report.id)
    .first<{
      version: number;
      performer_staff_id: string | null;
      areas: string;
      supplies_out: string;
      trouble: string | null;
      memo: string | null;
      confidence: number | null;
    }>();
  if (!cur) return { kind: "ignored", reason: "thread_reply" };

  const { results: areas } = await db
    .prepare("SELECT id, name FROM areas WHERE store_id = ? AND active = 1 ORDER BY sort_order")
    .bind(store.id)
    .all<{ id: string; name: string }>();

  const { result, usage } = await deps.resolve({
    storeName: store.name,
    areas,
    originalText: report.raw_text,
    imageCount: (JSON.parse(report.image_ids) as string[]).length,
    current: {
      areas: JSON.parse(cur.areas) as string[],
      supplies_out: JSON.parse(cur.supplies_out) as string[],
      trouble: cur.trouble,
      memo: cur.memo,
      confidence: cur.confidence,
    },
    question: report.question,
    answer: ev.text,
    toneSample: store.tone_sample,
  });
  console.log(JSON.stringify({ claude: "clarify_answer", ...usage }));

  const version = cur.version + 1;
  await db
    .prepare(
      `INSERT INTO report_versions (id, report_id, version, performer_staff_id, areas, supplies_out, trouble, memo,
                                    confidence, basis, basis_ref, model)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'staff_reply', ?, ?)`,
    )
    .bind(
      newId(),
      report.id,
      version,
      cur.performer_staff_id,
      JSON.stringify(result.areas),
      JSON.stringify(result.supplies_out),
      result.trouble,
      result.memo,
      result.confidence,
      ev.messageRef,
      usage.model,
    )
    .run();

  // ボードの日付は報告の送信時刻で決まる(答えた時刻ではない)
  const boardDate = jstDate(new Date(report.sent_at)).iso;
  const rootId = report.merged_into_report_id ?? report.id;
  await resyncBoard(db, store.id, boardDate, rootId);
  // 「拾ってもらえますか」に「拾いました」と答えたら、要確認の箇所を完了にする
  if (result.leftover_cleared) {
    await db
      .prepare(
        `UPDATE board_items SET status = 'done', recheck_note = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
          WHERE store_id = ? AND date = ? AND status = 'needs_recheck' AND done_report_id = ?`,
      )
      .bind(store.id, boardDate, rootId)
      .run();
  }

  const res = await deps.slack.postMessage(ev.channelRef, result.reply, ev.threadRef).catch(() => ({ ok: false }));
  return { kind: "clarified", reportId: report.id, version, areas: result.areas, replied: res.ok };
}

// 設計書 5-3「遅れて届いた入室や報告で前提が変わったら検出を取り下げ、取り下げたことも判断経路に残す。
// 承認前の下書きは取り下げと同時に消える」。判定は送信時刻: 入室(解錠時刻)のあとに送られた報告なら、その入室の報告
async function withdrawUnreported(db: D1Database, storeId: string, staffId: string, sentAt: string): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT id, reasoning_path FROM findings
        WHERE store_id = ? AND target_staff_id = ? AND kind = 'unreported' AND status = 'active'
          AND json_extract(evidence, '$.unlocked_at') <= ?`,
    )
    .bind(storeId, staffId, sentAt)
    .all<{ id: string; reasoning_path: string }>();
  const hhmm = (iso: string) => {
    const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  };
  for (const f of results) {
    const reason = `報告が届いた(送信 ${hhmm(sentAt)}。入室のあとの送信なので、その入室の報告とみる)`;
    const path = [...(JSON.parse(f.reasoning_path) as unknown[]), { step: "取り下げ", detail: `${reason}。承認前の下書きも取り下げた` }];
    await db.batch([
      db
        .prepare("UPDATE findings SET status = 'withdrawn', withdrawn_at = ?, withdrawn_reason = ?, reasoning_path = ? WHERE id = ?")
        .bind(new Date().toISOString(), reason, JSON.stringify(path), f.id),
      db.prepare("UPDATE drafts SET status = 'withdrawn', decided_at = ? WHERE finding_id = ? AND status = 'pending'").bind(new Date().toISOString(), f.id),
    ]);
  }
  return results.length;
}

type JudgmentRule = {
  id: string;
  rule_no: number;
  natural_text: string;
  origin: string;
  question: string | null;
  asked_at: string | null;
  asked_by: string | null;
  answer: string | null;
  answered_at: string | null;
  answered_by: string | null;
};

// 有効な「判断の基準」のルール(全店のものと、この店のもの)。由来の質問と回答も一緒に読む
async function activeJudgmentRules(db: D1Database, storeId: string): Promise<JudgmentRule[]> {
  const { results } = await db
    .prepare(
      `SELECT r.id, r.rule_no, r.natural_text, r.origin,
              k.question, k.asked_at, ks.display_name AS asked_by,
              a.answer, a.answered_at, s.display_name AS answered_by
         FROM rules r
         LEFT JOIN knowledge k ON k.id = r.origin_knowledge_id
         LEFT JOIN staff ks ON ks.id = k.asked_by_staff_id
         LEFT JOIN knowledge_answers a ON a.id = r.origin_answer_id
         LEFT JOIN staff s ON s.id = a.answered_by_staff_id
        WHERE r.status = 'active' AND r.action = 'judgment_basis' AND (r.store_id = ? OR r.store_id IS NULL)
        ORDER BY r.rule_no`,
    )
    .bind(storeId)
    .all<JudgmentRule>();
  return results;
}

// ルール(判断の基準)に当たる様子を検出事項にし、オーナーに知らせる(運営宛てなので承認不要)。
// 判断経路には、該当したルールの原文と由来(元の質問と回答の日付)を残す(仕様 2章「判断時の扱い」)
async function recordRuleMatches(
  db: D1Database,
  deps: ProcessDeps,
  newId: () => string,
  store: Store,
  sender: Person | null,
  ev: ReportEvent,
  result: StructureResult,
  rules: JudgmentRule[],
  imageCount: number,
  reportId: string | null,
): Promise<{ findingId: string; ruleNo: number }[]> {
  const out: { findingId: string; ruleNo: number }[] = [];
  const owner = result.rule_matches.length
    ? await db
        .prepare("SELECT slack_user_id FROM staff WHERE role = 'owner' AND status = 'active' AND slack_user_id IS NOT NULL LIMIT 1")
        .first<{ slack_user_id: string }>()
    : null;
  for (const m of result.rule_matches) {
    const rule = rules.find((r) => r.rule_no === m.rule_no);
    if (!rule) continue;
    const id = newId();
    const who = sender?.display_name ?? "名簿にない人";
    const path = [
      { step: "投稿を受け取る", detail: `${who}さんの投稿(送信 ${ev.sentAt})` },
      { step: "写真と本文を読む", detail: `写真${imageCount}枚と本文を、有効な判断の基準${rules.length}件と照合` },
      { step: `ルール${rule.rule_no}に該当`, detail: `「${rule.natural_text}」` },
      { step: "ルールの由来", detail: ruleOrigin(rule) },
      { step: "見えたこと", detail: m.evidence },
      { step: "対応", detail: "オーナーに知らせる(宛先が運営側なので承認なし)。スタッフには送らない" },
    ];
    await db
      .prepare(
        `INSERT INTO findings (id, store_id, detected_at, kind, target_staff_id, evidence, rule_ids, reasoning_path)
         VALUES (?, ?, ?, 'rule_match', ?, ?, ?, ?)`,
      )
      .bind(
        id,
        store.id,
        new Date().toISOString(),
        sender?.id ?? null,
        JSON.stringify({ report_id: reportId, message_ref: ev.messageRef, sent_at: ev.sentAt, seen: m.evidence }),
        JSON.stringify([rule.id]),
        JSON.stringify(path),
      )
      .run();
    out.push({ findingId: id, ruleNo: rule.rule_no });
    if (owner) {
      const from = rule.origin === "knowledge" ? `(${md(rule.asked_at)} のスタッフの質問から生まれたルール)` : "";
      await deps.slack
        .postMessage(owner.slack_user_id, `【${store.name}】ルール${rule.rule_no}「${rule.natural_text}」に当たりそうな様子がありました${from}\n${m.evidence}(${who}さんの報告から)`)
        .catch(() => undefined);
    }
  }
  return out;
}

// トラブルは検出事項に回し、オーナーに即時で知らせる(運営宛てなので承認不要。設計書 5-4)
async function recordTrouble(
  db: D1Database,
  deps: ProcessDeps,
  newId: () => string,
  store: Store,
  sender: Person | null,
  ev: ReportEvent,
  result: StructureResult,
  reportId: string | null,
): Promise<string> {
  const id = newId();
  const what = result.trouble ?? result.memo ?? "依頼・トラブルの投稿";
  const path = [
    { step: "投稿を受け取る", detail: `送信 ${ev.sentAt}` },
    { step: "分類と構造化", detail: `分類: ${result.categories.join(" / ")}` },
    { step: "トラブルとして検出", detail: what },
    { step: "既定値", detail: "トラブルはすぐオーナーに知らせる" },
  ];
  await db
    .prepare(
      `INSERT INTO findings (id, store_id, detected_at, kind, target_staff_id, evidence, rule_ids, reasoning_path)
       VALUES (?, ?, ?, 'trouble', ?, ?, '[]', ?)`,
    )
    .bind(
      id,
      store.id,
      new Date().toISOString(),
      sender?.id ?? null,
      JSON.stringify({ report_id: reportId, message_ref: ev.messageRef, sent_at: ev.sentAt, trouble: what }),
      JSON.stringify(path),
    )
    .run();

  const owner = await db
    .prepare("SELECT slack_user_id FROM staff WHERE role = 'owner' AND status = 'active' AND slack_user_id IS NOT NULL LIMIT 1")
    .first<{ slack_user_id: string }>();
  if (owner) {
    const who = sender?.display_name ?? "名簿にない人";
    await deps.slack
      .postMessage(owner.slack_user_id, `【${store.name}】${who}さんの投稿にトラブルがありました: ${what}`)
      .catch(() => undefined);
  }
  return id;
}
