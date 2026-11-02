// 現場エージェント: 夜の突き合わせ(設計書 5-3、仕様 5章)
//
// claude-opus-5-5 にツールを持たせ、その日の入室記録と報告を突き合わせて、
// 入室したのに報告が届いていない人を見つけ、ルールに照らして声かけ文を下書きする。
// 呼んだツールはそのまま判断経路になる(「入室記録を読む → 報告を読む → 報告なし → ルール一覧を参照 →
// ルール2に該当 → 声かけ文を下書き」)。
//
// 守り(コードが確かめる。Claude の判断をそのまま通さない):
// - 下書きを作れるのは、本当に「入室から N 分たっても、その入室のあとに報告がない」ときだけ。判定は解錠時刻・送信時刻
// - 該当ルールとして挙げられるのは、有効で動作が「下書きを作る」のルールだけ
// - 同じ入室で二度検出しない
// - スタッフ宛ての下書きは承認待ちで止まる。送るのはオーナーの一押し(drafts の CHECK でも止まる)

import type Anthropic from "@anthropic-ai/sdk";
import { AGENT_MODEL, type ModelCall } from "../knowledge/agent";
import { ruleOrigin } from "../rules/origin";

const MAX_TURNS = 8;
const JST = 9 * 60 * 60 * 1000;

export type PathStep = { step: string; detail: string };
export type NightResult = {
  findings: { findingId: string; draftId: string; staffId: string }[];
  path: PathStep[];
  summary: string | null;
  usage: { model: string; input_tokens: number; output_tokens: number; turns: number };
};

const hm = (iso: string) => {
  const d = new Date(new Date(iso).getTime() + JST);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

// JST の日付の範囲(UTC の ISO)
function dayRange(date: string): { from: string; to: string } {
  const from = new Date(new Date(`${date}T00:00:00Z`).getTime() - JST).toISOString();
  const to = new Date(new Date(`${date}T00:00:00Z`).getTime() - JST + 24 * 60 * 60 * 1000).toISOString();
  return { from, to };
}

const TOOLS: Anthropic.Tool[] = [
  { name: "read_entries", description: "この店のその日の入室記録(スタッフの解錠だけ)を読む。解錠時刻つき", input_schema: { type: "object", properties: {} } },
  { name: "read_reports", description: "この店のその日の清掃報告を読む。送信者・送信時刻・清掃箇所つき", input_schema: { type: "object", properties: {} } },
  { name: "read_roster", description: "名簿を見る(呼び名・役割・報告義務の対象か・今日の欠席予定)", input_schema: { type: "object", properties: {} } },
  { name: "read_rules", description: "有効なルールの一覧を参照する(番号・原文・動作・宛先・由来)", input_schema: { type: "object", properties: {} } },
  {
    name: "draft_nudge",
    description:
      "入室したのに報告が届いていない人について、検出事項を記録し、本人への声かけ文を下書きする(送信はしない。オーナーの承認待ちになる)。該当するルールの番号を必ず挙げる",
    input_schema: {
      type: "object",
      properties: {
        entry_id: { type: "string", description: "報告のない入室の id(read_entries の結果)" },
        rule_no: { type: "integer", description: "該当するルールの番号(動作が「下書きを作る」のもの)" },
        reasoning: { type: "string", description: "なぜ未報告とみたか(1文。判断経路に出る)" },
        body: {
          type: "string",
          description:
            "本人への声かけ文。オーナーの口調の例に寄せる。責めない。来てくれたことへのお礼を先に。2〜3文。署名は書かない(システムがオーナー名を添える)",
        },
      },
      required: ["entry_id", "rule_no", "reasoning", "body"],
    },
  },
  {
    name: "finish",
    description: "突き合わせを終える。下書きを作ったかどうかにかかわらず最後に呼ぶ",
    input_schema: { type: "object", properties: { summary: { type: "string", description: "オーナー向けの一文の要約" } }, required: ["summary"] },
  },
];

type Ctx = { storeId: string; storeName: string; date: string; now: string; toneSample: string | null };

export async function runNightCheck(db: D1Database, ctx: Ctx, deps: { call: ModelCall; newId: () => string }): Promise<NightResult> {
  const { from, to } = dayRange(ctx.date);
  const org = await db.prepare("SELECT unreported_after_minutes FROM org_settings WHERE id = 1").first<{ unreported_after_minutes: number }>();
  const thresholdMin = org?.unreported_after_minutes ?? 120;
  const owner = await db.prepare("SELECT id, display_name FROM staff WHERE role = 'owner' AND status = 'active' LIMIT 1").first<{ id: string; display_name: string }>();

  const path: PathStep[] = [];
  const result: NightResult = { findings: [], path, summary: null, usage: { model: AGENT_MODEL, input_tokens: 0, output_tokens: 0, turns: 0 } };

  // ---- ツールの中身(すべてこの店・この日に絞る)
  const entries = async () =>
    (
      await db
        .prepare(
          `SELECT e.id, e.staff_id, s.display_name AS name, e.unlocked_at
             FROM entries e JOIN staff s ON s.id = e.staff_id
            WHERE e.store_id = ? AND e.unlocked_at >= ? AND e.unlocked_at < ? AND e.unlocked_at <= ?
            ORDER BY e.unlocked_at`,
        )
        .bind(ctx.storeId, from, to, ctx.now)
        .all<{ id: string; staff_id: string; name: string; unlocked_at: string }>()
    ).results;
  const reports = async () =>
    (
      await db
        .prepare(
          `SELECT r.id, r.sender_staff_id AS staff_id, s.display_name AS name, r.sent_at, r.areas
             FROM reports_current r LEFT JOIN staff s ON s.id = r.sender_staff_id
            WHERE r.store_id = ? AND r.sent_at >= ? AND r.sent_at < ? AND r.sent_at <= ?
            ORDER BY r.sent_at`,
        )
        .bind(ctx.storeId, from, to, ctx.now)
        .all<{ id: string; staff_id: string | null; name: string | null; sent_at: string; areas: string | null }>()
    ).results;
  const rules = async () =>
    (
      await db
        .prepare(
          `SELECT r.id, r.rule_no, r.natural_text, r.action, r.recipient, r.origin,
                  k.question, k.asked_at, ks.display_name AS asked_by, a.answer, a.answered_at, s.display_name AS answered_by
             FROM rules r
             LEFT JOIN knowledge k ON k.id = r.origin_knowledge_id
             LEFT JOIN staff ks ON ks.id = k.asked_by_staff_id
             LEFT JOIN knowledge_answers a ON a.id = r.origin_answer_id
             LEFT JOIN staff s ON s.id = a.answered_by_staff_id
            WHERE r.status = 'active' AND (r.store_id = ? OR r.store_id IS NULL)
            ORDER BY r.rule_no`,
        )
        .bind(ctx.storeId)
        .all<{
          id: string;
          rule_no: number;
          natural_text: string;
          action: string;
          recipient: string | null;
          origin: string;
          question: string | null;
          asked_at: string | null;
          asked_by: string | null;
          answer: string | null;
          answered_at: string | null;
          answered_by: string | null;
        }>()
    ).results;

  async function run(name: string, input: Record<string, unknown>): Promise<{ content: string; isError?: boolean; done?: boolean }> {
    if (name === "read_entries") {
      const rows = await entries();
      path.push({ step: "入室記録を読む", detail: `${rows.length}件(解錠時刻で見る)` });
      return {
        content: JSON.stringify(
          rows.map((e) => ({ entry_id: e.id, staff_id: e.staff_id, name: e.name, unlocked_at: hm(e.unlocked_at), minutes_ago: Math.floor((Date.parse(ctx.now) - Date.parse(e.unlocked_at)) / 60000) })),
        ),
      };
    }
    if (name === "read_reports") {
      const rows = await reports();
      path.push({ step: "報告を読む", detail: `${rows.length}件(送信時刻で見る)` });
      return { content: JSON.stringify(rows.map((r) => ({ report_id: r.id, staff_id: r.staff_id, name: r.name, sent_at: hm(r.sent_at), areas: JSON.parse(r.areas ?? "[]") }))) };
    }
    if (name === "read_roster") {
      const { results } = await db
        .prepare(
          `SELECT s.id AS staff_id, s.display_name AS name, s.role, s.is_obligated,
                  EXISTS (SELECT 1 FROM absences a WHERE a.staff_id = s.id AND ? BETWEEN a.starts_on AND a.ends_on) AS absent_today
             FROM staff s WHERE s.status = 'active' ORDER BY s.role, s.display_name`,
        )
        .bind(ctx.date)
        .all();
      path.push({ step: "名簿を見る", detail: `${results.length}人` });
      return { content: JSON.stringify(results) };
    }
    if (name === "read_rules") {
      const rows = await rules();
      path.push({ step: "ルール一覧を参照", detail: `有効 ${rows.length}件` });
      return { content: JSON.stringify(rows.map((r) => ({ rule_no: r.rule_no, text: r.natural_text, action: r.action, recipient: r.recipient, origin: ruleOrigin(r) }))) };
    }
    if (name === "draft_nudge") {
      const entryId = String(input.entry_id ?? "");
      const ruleNo = Number(input.rule_no);
      const body = String(input.body ?? "").trim();
      const entry = (await entries()).find((e) => e.id === entryId);
      if (!entry) return { content: "その入室はこの店のこの日の記録にありません", isError: true };
      const minutes = Math.floor((Date.parse(ctx.now) - Date.parse(entry.unlocked_at)) / 60000);
      if (minutes < thresholdMin) return { content: `入室から${minutes}分なので、まだ未報告とはみません(${thresholdMin}分から)`, isError: true };
      const after = (await reports()).find((r) => r.staff_id === entry.staff_id && r.sent_at >= entry.unlocked_at);
      if (after) return { content: `${entry.name}さんは ${hm(after.sent_at)} に報告しています`, isError: true };
      const rule = (await rules()).find((r) => r.rule_no === ruleNo);
      if (!rule || rule.action !== "draft") return { content: `ルール${ruleNo}は有効な「下書きを作る」ルールではありません`, isError: true };
      const dup = await db
        .prepare("SELECT 1 FROM findings WHERE kind = 'unreported' AND status = 'active' AND json_extract(evidence, '$.entry_id') = ?")
        .bind(entry.id)
        .first();
      if (dup) return { content: "この入室はすでに検出済みです", isError: true };
      if (!body) return { content: "声かけ文が空です", isError: true };

      const findingId = deps.newId();
      const draftId = deps.newId();
      // この人の経路: 読んだツールまで(ほかの人の検出や断られた呼び出しは入れない)
      const steps: PathStep[] = [
        ...path.filter((p) => !p.step.includes("さん: 報告なし") && !p.step.endsWith("を断った")),
        { step: "報告なし", detail: `${entry.name}さん ${hm(entry.unlocked_at)} に入室 → ${minutes}分たっても、そのあとの報告がない。${String(input.reasoning ?? "")}` },
        { step: `ルール${rule.rule_no}に該当`, detail: `「${rule.natural_text}」(由来: ${ruleOrigin(rule)})` },
        { step: "声かけ文を下書き", detail: "オーナーの承認待ち。承認するまでスタッフには送らない" },
      ];
      const signed = owner ? `${body}\n(${owner.display_name})` : body;
      await db.batch([
        db
          .prepare(
            `INSERT INTO findings (id, store_id, detected_at, kind, target_staff_id, evidence, rule_ids, reasoning_path)
             VALUES (?, ?, ?, 'unreported', ?, ?, ?, ?)`,
          )
          .bind(
            findingId,
            ctx.storeId,
            ctx.now,
            entry.staff_id,
            JSON.stringify({ entry_id: entry.id, unlocked_at: entry.unlocked_at, threshold_minutes: thresholdMin, checked_at: ctx.now }),
            JSON.stringify([rule.id]),
            JSON.stringify(steps),
          ),
        db
          .prepare("INSERT INTO drafts (id, store_id, finding_id, recipient_type, recipient_staff_id, body) VALUES (?, ?, ?, 'staff', ?, ?)")
          .bind(draftId, ctx.storeId, findingId, entry.staff_id, signed),
      ]);
      path.push({ step: `${entry.name}さん: 報告なし → ルール${rule.rule_no}`, detail: "声かけ文を下書き(承認待ち)" });
      result.findings.push({ findingId, draftId, staffId: entry.staff_id });
      return { content: JSON.stringify({ ok: true, finding_id: findingId, draft_id: draftId }) };
    }
    if (name === "finish") {
      result.summary = String(input.summary ?? "").trim() || null;
      return { content: "ok", done: true };
    }
    return { content: `知らないツール: ${name}`, isError: true };
  }

  // ---- ツール使用ループ
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `店舗: ${ctx.storeName}\n日付: ${ctx.date}\n今の時刻: ${hm(ctx.now)}\n未報告とみるのは、入室(解錠時刻)から${thresholdMin}分たっても、その入室のあとに本人の報告がないとき。`,
    },
  ];
  const system = [
    `あなたは無人自習室「${ctx.storeName}」の夜の突き合わせを行う現場エージェントです。`,
    "ツールで入室記録・報告・名簿・ルールを読み、入室したのに報告が届いていない人を見つけてください。",
    "見つけたら、ルール一覧から該当するルールを選んで draft_nudge で声かけ文を下書きします。送信はしません(オーナーが承認して送ります)。最後に必ず finish を呼びます。",
    "",
    "決まりごと:",
    "- 判定は解錠時刻と送信時刻で行う。報告がその入室より前なら、その入室の報告ではない",
    "- 報告がないことには理由があるかもしれない(鍵の同期の遅れ・送り忘れ)。声かけ文は確かめる口調で、責めない",
    "- 運営(オーナー・副担当)の入室は対象にしない",
    ctx.toneSample ? `- オーナーの口調の例: 「${ctx.toneSample}」` : "",
  ]
    .filter(Boolean)
    .join("\n");

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await deps.call({ model: AGENT_MODEL, max_tokens: 1500, system, tools: TOOLS, tool_choice: { type: "auto" }, messages });
    result.usage.model = res.model;
    result.usage.input_tokens += res.usage.input_tokens;
    result.usage.output_tokens += res.usage.output_tokens;
    result.usage.turns++;
    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (uses.length === 0) break;
    messages.push({ role: "assistant", content: res.content });
    const outs: Anthropic.ToolResultBlockParam[] = [];
    let done = false;
    for (const u of uses) {
      const r = await run(u.name, (u.input ?? {}) as Record<string, unknown>);
      outs.push({ type: "tool_result", tool_use_id: u.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
      if (r.isError) path.push({ step: `${u.name} を断った`, detail: r.content });
      done ||= !!r.done;
    }
    if (done) break;
    messages.push({ role: "user", content: outs });
  }
  return result;
}
