// 引き継ぎ帳の「判断」の答えから、ルール候補を作る(仕様 2章「ルールの入口は2つ」の2、設計書 5-5 の約束2)
//
// オーナーが答えのない質問に答え、その質問の種別が「判断」なら、Claude が候補の文面を自然文で下書きする。
// 候補は状態「候補」で積むだけ。有効にするのはオーナーの承認だけ(承認なしに有効にはならない)。
// 下書きに失敗しても、オーナーの答えの原文を文面にして候補を作る(答えの記録とスタッフへの返事は止めない)。

import Anthropic from "@anthropic-ai/sdk";
import { recordUsage } from "../lib/usage";
import { STRUCTURE_MODEL } from "../report/structure";

export type RuleDraft = { natural_text: string; usage?: { model: string; input_tokens: number; output_tokens: number } };
export type RuleDrafter = (input: { storeName: string | null; question: string; answer: string }) => Promise<RuleDraft>;

export function claudeRuleDrafter(apiKey: string): RuleDrafter {
  const client = new Anthropic({ apiKey });
  return async (input) => {
    const res = await client.messages.create({
      model: STRUCTURE_MODEL,
      max_tokens: 256,
      system: [
        "無人自習室のオーナーが、スタッフの質問に答えました。この答えを、以後の判断の基準にするルールの文面に下書きしてください。",
        "文章で答えずに、必ず record_rule を1回だけ呼んでください。",
        "- 文面はオーナーの答えの趣旨だけを、短い自然文(30字以内)にする。答えにない条件や例外を足さない",
        "- 例: 質問「加湿器って置いていい?」答え「置いていい。ただし床置きはだめ」→「加湿器は机上のみ可」",
      ].join("\n"),
      tools: [
        {
          name: "record_rule",
          description: "ルール候補の文面を記録する",
          input_schema: {
            type: "object",
            properties: { natural_text: { type: "string", description: "ルールの文面(30字以内の自然文)" } },
            required: ["natural_text"],
          },
        },
      ],
      tool_choice: { type: "auto" },
      messages: [
        { role: "user", content: `店舗: ${input.storeName ?? "全店"}\n質問: ${input.question}\n答え: ${input.answer}` },
      ],
    });
    const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const text = String((block?.input as { natural_text?: unknown } | undefined)?.natural_text ?? "").trim();
    if (!text) throw new Error("ルール候補の文面が返りませんでした");
    return { natural_text: text.slice(0, 60), usage: { model: res.model, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens } };
  };
}

export type CandidateResult = { ruleId: string; ruleNo: number; naturalText: string } | null;

export async function createRuleCandidate(
  db: D1Database,
  deps: { draftRule: RuleDrafter; newId: () => string },
  k: { id: string; store_id: string | null; store_name: string | null; question: string; kind: string | null },
  answer: { id: string; text: string },
): Promise<CandidateResult> {
  if (k.kind !== "judgment") return null;
  // 同じ質問から候補を二度作らない(答え直しのときは、オーナーが画面で選び直す)
  const exists = await db.prepare("SELECT 1 FROM rules WHERE origin_knowledge_id = ?").bind(k.id).first();
  if (exists) return null;

  let naturalText: string;
  try {
    const d = await deps.draftRule({ storeName: k.store_name, question: k.question, answer: answer.text });
    naturalText = d.natural_text;
    if (d.usage) await recordUsage(db, { kind: "rule_draft", ...d.usage, store_id: k.store_id });
  } catch (err) {
    console.error(`ルール候補の下書きに失敗したので、答えの原文を文面にします: ${err instanceof Error ? err.message : String(err)}`);
    naturalText = answer.text;
  }

  const ruleId = deps.newId();
  const row = await db
    .prepare(
      `INSERT INTO rules (id, rule_no, store_id, natural_text, condition, target, action, recipient, urgency,
                          origin, origin_knowledge_id, origin_answer_id, status)
       VALUES (?, (SELECT coalesce(max(rule_no), 0) + 1 FROM rules), ?, ?, '{}', ?, 'judgment_basis', NULL, 'immediate',
               'knowledge', ?, ?, 'candidate')
       RETURNING rule_no`,
    )
    .bind(ruleId, k.store_id, naturalText, JSON.stringify(k.store_id ? { store: k.store_id } : { scope: "all_stores" }), k.id, answer.id)
    .first<{ rule_no: number }>();
  return { ruleId, ruleNo: row!.rule_no, naturalText };
}
