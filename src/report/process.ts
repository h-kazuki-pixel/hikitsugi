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
import { ensureBoard, markDone } from "./board";
import type { Structurer, StructureResult } from "./structure";

export type ProcessDeps = {
  structure: Structurer;
  slack: SlackClient;
  newId?: () => string;
};

export type ProcessOutcome =
  | { kind: "ignored"; reason: string }
  | { kind: "not_report"; categories: string[]; findingId: string | null }
  | {
      kind: "report";
      reportId: string;
      mergedInto: string | null;
      areas: string[];
      boardUpdated: number;
      replied: boolean;
      findingId: string | null;
    };

const MAX_IMAGES = 4;

type Store = { id: string; name: string; tone_sample: string | null };
type Person = { id: string; display_name: string; role: "staff" | "sub" | "owner" };

export async function processReportEvent(db: D1Database, ev: ReportEvent, deps: ProcessDeps): Promise<ProcessOutcome> {
  const newId = deps.newId ?? (() => crypto.randomUUID());

  // 引き継ぎ帳(DM の質問)と、聞き返しへのスレッド返事は次の段階で扱う
  if (ev.isDirect) return { kind: "ignored", reason: "direct_message" };
  if (ev.isReplyInThread) return { kind: "ignored", reason: "thread_reply" };

  const store = await db
    .prepare("SELECT id, name, tone_sample FROM stores WHERE slack_channel_id = ?")
    .bind(ev.channelRef)
    .first<Store>();
  if (!store) return { kind: "ignored", reason: "unknown_channel" };

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

  const { result, usage } = await deps.structure({
    storeName: store.name,
    areas,
    senderName: sender?.display_name ?? null,
    toneSample: store.tone_sample,
    text: ev.text,
    images,
    imagesUnreadable: unreadable,
  });
  // Claude 呼び出し1回あたりの消費を実測する(本文は出さない)
  console.log(JSON.stringify({ claude: "structure", ...usage, images: images.length, categories: result.categories }));

  const isReport = result.categories.includes("cleaning_report");
  const hasTrouble = result.categories.includes("request_trouble") || !!result.trouble;

  if (!isReport) {
    const findingId = hasTrouble ? await recordTrouble(db, deps, newId, store, sender, ev, result, null) : null;
    return { kind: "not_report", categories: result.categories, findingId };
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

  const date = jstDate(new Date(ev.sentAt)).iso;
  await ensureBoard(db, store.id, date);
  const boardUpdated = await markDone(db, store.id, date, result.areas, mergedInto ?? reportId);

  const findingId = hasTrouble ? await recordTrouble(db, deps, newId, store, sender, ev, result, reportId) : null;

  let replied = false;
  if (result.reply) {
    const res = await deps.slack.postMessage(ev.channelRef, result.reply, ev.threadRef).catch(() => ({ ok: false }));
    replied = res.ok;
  }

  return { kind: "report", reportId, mergedInto, areas: result.areas, boardUpdated, replied, findingId };
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
