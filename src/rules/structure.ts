// オーナーが自然文で足すルールの構造化(仕様 2章「構造(Claude が変換して保存する)」「ルールの入口は2つ」の1)
//
// オーナーが店舗ページの「ルールを足す」に自然文を書く → Claude(claude-sonnet-5-5)が
// 条件・対象・動作・宛先・緊急度に変換する → 状態「候補」で積み、読み取った内容を画面に出す →
// オーナーが確かめて承認したら有効。自然文はそのまま残し、画面にはこれを出す(書き換えない)。

import Anthropic from "@anthropic-ai/sdk";
import { STRUCTURE_MODEL } from "../report/structure";

export const ACTIONS = ["notify", "draft", "exclude_from_count", "merge", "change_quota", "judgment_basis"] as const;
export const RECIPIENTS = ["owner", "sub", "self"] as const;
export const URGENCIES = ["immediate", "scheduled", "weekly"] as const;

export const ACTION_LABEL: Record<(typeof ACTIONS)[number], string> = {
  notify: "知らせる",
  draft: "下書きを作る",
  exclude_from_count: "回数に数えない",
  merge: "1件に畳む",
  change_quota: "義務回数を変える",
  judgment_basis: "判断の基準にする",
};
export const RECIPIENT_LABEL: Record<(typeof RECIPIENTS)[number], string> = { owner: "オーナー", sub: "副担当", self: "本人" };
export const URGENCY_LABEL: Record<(typeof URGENCIES)[number], string> = { immediate: "即時", scheduled: "定時", weekly: "週次" };

export type StructuredRule = {
  condition: Record<string, unknown>;
  target: Record<string, unknown>;
  action: (typeof ACTIONS)[number];
  recipient: (typeof RECIPIENTS)[number] | null;
  urgency: (typeof URGENCIES)[number];
  reading: string; // 読み取った内容(オーナーが確かめる一文)
  unclear: string | null; // 読み取れなかった点(あれば画面に出す)
  usage?: { model: string; input_tokens: number; output_tokens: number };
};

export type RuleStructurer = (input: { storeName: string; text: string }) => Promise<StructuredRule>;

const TOOL: Anthropic.Tool = {
  name: "record_rule",
  description: "オーナーの自然文のルールを、条件・対象・動作・宛先・緊急度に変換して記録する",
  input_schema: {
    type: "object",
    properties: {
      condition: {
        type: "object",
        description:
          "何が起きたら。キーの例: report.trouble / report.supplies_out / entry_without_report_minutes / weekly_days_below_quota.weeks_in_a_row / closed_day。自然文にない条件を足さない",
      },
      target: { type: "object", description: "誰・どこ。例: { role: 'staff' } / { store: 'tenjin' } / { scope: 'all_stores' } / { area: 'トイレ' }" },
      action: {
        type: "string",
        enum: [...ACTIONS],
        description: "notify=知らせる / draft=声かけの下書きを作る / exclude_from_count=回数に数えない / merge=1件に畳む / change_quota=義務回数を変える / judgment_basis=判断の基準にする(写真・報告の検出とスタッフへの答えで参照)",
      },
      recipient: { type: ["string", "null"], enum: [...RECIPIENTS, null], description: "宛先。知らせる・下書き以外は null" },
      urgency: { type: "string", enum: [...URGENCIES], description: "即時 / 定時(朝と夜)/ 週次。自然文になければ定時" },
      reading: { type: "string", description: "読み取った内容を、オーナーが確かめられる一文で(例: 「トイレの報告がない日が2日続いたら、副担当に朝の定時で知らせる」)" },
      unclear: { type: ["string", "null"], description: "自然文から決められなかった点(あれば1文)。推測で埋めずにここに書く" },
    },
    required: ["condition", "target", "action", "recipient", "urgency", "reading", "unclear"],
  },
};

export function claudeRuleStructurer(apiKey: string): RuleStructurer {
  const client = new Anthropic({ apiKey });
  return async (input) => {
    const res = await client.messages.create({
      model: STRUCTURE_MODEL,
      max_tokens: 1024,
      system: [
        `無人自習室「${input.storeName}」のオーナーが、運営のルールを自然文で書きました。record_rule で構造に変換してください。`,
        "文章で答えずに、必ず record_rule を1回だけ呼んでください。",
        "- 自然文にない条件・例外・宛先を足さない。決められない点は unclear に書く",
        "- スタッフに直接送る動作はない。スタッフへの声かけは draft(オーナーが承認してから送る)",
      ].join("\n"),
      tools: [TOOL],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: input.text }],
    });
    const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!block) throw new Error("ルールの構造化の結果が返りませんでした");
    return { ...normalizeRule(block.input as Partial<StructuredRule>), usage: { model: res.model, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens } };
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function normalizeRule(raw: Partial<StructuredRule>): StructuredRule {
  const action = ACTIONS.includes(raw.action as (typeof ACTIONS)[number]) ? (raw.action as StructuredRule["action"]) : "notify";
  const recipient = RECIPIENTS.includes(raw.recipient as (typeof RECIPIENTS)[number]) ? (raw.recipient as StructuredRule["recipient"]) : null;
  return {
    condition: isObj(raw.condition) ? raw.condition : {},
    target: isObj(raw.target) ? raw.target : {},
    action,
    // 知らせる・下書きは宛先が要る。読み取れなければオーナー宛てにしておく(運営側なので害がない)
    recipient: action === "notify" || action === "draft" ? (recipient ?? "owner") : recipient,
    urgency: URGENCIES.includes(raw.urgency as (typeof URGENCIES)[number]) ? (raw.urgency as StructuredRule["urgency"]) : "scheduled",
    reading: (raw.reading ?? "").trim(),
    unclear: raw.unclear?.trim() || null,
  };
}
