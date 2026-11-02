// 写真・本文を、承認済みの「判断の基準」のルールに照らす(設計書 4-1 の山場、仕様 2章「判断時の扱い」)
//
// 11/3 04:18 の実機: 構造化と同じ1回の呼び出しに照合を混ぜていたら、床置きの加湿器の写真が
// 「床の清掃報告」としては読まれたのに、ルール6(床置きは不可)に当たらなかった。
// 照合は別の呼び出しに分け、写真とルールだけを渡して、ルール1件ずつ「反している様子が写っているか」を答えさせる。
// 写真つきの報告で、有効な判断の基準があるときだけ呼ぶ。

import Anthropic from "@anthropic-ai/sdk";
import { STRUCTURE_MODEL, type StructureUsage } from "./structure";

export type RuleCheckInput = {
  storeName: string;
  text: string;
  images: { base64: string; mediaType: string }[];
  rules: { no: number; text: string }[];
};

export type RuleCheckResult = { rule_no: number; violated: boolean; evidence: string }[];

export type RuleChecker = (input: RuleCheckInput) => Promise<{ result: RuleCheckResult; usage: StructureUsage }>;

function tool(ruleNos: number[]): Anthropic.Tool {
  return {
    name: "record_rule_check",
    description: "各ルールについて、写真・本文に反している様子が写っているかを記録する",
    input_schema: {
      type: "object",
      properties: {
        checks: {
          type: "array",
          description: "渡されたルールすべてについて1件ずつ",
          items: {
            type: "object",
            properties: {
              rule_no: { type: "integer", enum: ruleNos },
              violated: { type: "boolean", description: "反している様子が確かに写っている・書かれているなら true。見えない・分からないなら false" },
              evidence: { type: "string", description: "何が写っている・書かれているか(1文。true のときは必ず。人を責める書き方にしない)" },
            },
            required: ["rule_no", "violated", "evidence"],
          },
        },
      },
      required: ["checks"],
    },
  };
}

export function claudeRuleChecker(apiKey: string): RuleChecker {
  const client = new Anthropic({ apiKey });
  return async (input) => {
    const ruleNos = input.rules.map((r) => r.no);
    const content: Anthropic.ContentBlockParam[] = input.images.map((img) => ({
      type: "image",
      source: { type: "base64", media_type: img.mediaType as "image/jpeg", data: img.base64 },
    }));
    content.push({ type: "text", text: `本文: ${input.text || "(本文なし)"}\n写真: ${input.images.length}枚` });
    const res = await client.messages.create({
      model: STRUCTURE_MODEL,
      max_tokens: 1024,
      system: [
        `あなたは無人自習室「${input.storeName}」のオーナーが決めたルールに、スタッフの清掃報告(写真と本文)が反していないかを確かめる係です。`,
        "ルールを1件ずつ見て、反している様子が写真や本文に確かに写っているかを record_rule_check で記録してください。文章で答えず、必ず record_rule_check を1回だけ呼んでください。",
        "",
        "判断の基準(オーナーが承認したルール):",
        ...input.rules.map((r) => `- ルール${r.no}: ${r.text}`),
        "",
        "決まりごと:",
        "- 写真に写っている物の置き場所・状態をよく見る(例: 「床置きは不可」なら、その物が床に置かれているかどうか)",
        "- 見えないこと・写っていないことは false。推測で true にしない",
        "- true のときは、何がどこにどう写っているかを evidence に1文で書く",
      ].join("\n"),
      tools: [tool(ruleNos)],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content }],
    });
    const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const raw = ((block?.input as { checks?: unknown[] } | undefined)?.checks ?? []) as Partial<RuleCheckResult[number]>[];
    return {
      result: normalizeRuleCheck(raw, ruleNos),
      usage: { model: res.model, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens },
    };
  };
}

export function normalizeRuleCheck(raw: Partial<RuleCheckResult[number]>[], ruleNos: number[]): RuleCheckResult {
  const known = new Set(ruleNos);
  return raw
    .filter((c) => c && known.has(Number(c.rule_no)))
    .map((c) => ({ rule_no: Number(c.rule_no), violated: c.violated === true, evidence: String(c.evidence ?? "").trim() }))
    .filter((c) => !c.violated || c.evidence);
}
