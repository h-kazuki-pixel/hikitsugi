// 聞き返しへの答え(仕様 4章、設計書 5-2)
//
// 受付の返事で1つだけ聞いた問いに、報告した本人がスレッドで答えたら、
// 版1と問いと答えから構造化をやり直し、report_versions に版2として積む(basis = staff_reply)。
// 聞き返しは1回だけ: 答えへの返事では問わない。答えた後のスレッドの投稿や、本人以外の返事は扱わない。

import Anthropic from "@anthropic-ai/sdk";
import { STRUCTURE_MODEL, type StructureUsage } from "./structure";

export type ResolveInput = {
  storeName: string;
  areas: { id: string; name: string }[];
  originalText: string;
  imageCount: number;
  current: { areas: string[]; supplies_out: string[]; trouble: string | null; memo: string | null; confidence: number | null };
  question: string;
  answer: string;
  toneSample: string | null;
};

export type ResolveResult = {
  areas: string[];
  supplies_out: string[];
  trouble: string | null;
  memo: string | null;
  confidence: number;
  reply: string;
  leftover_cleared: boolean; // 「拾ってもらえますか」への答えで、片づけたと分かった
};

export type Resolver = (input: ResolveInput) => Promise<{ result: ResolveResult; usage: StructureUsage }>;

function tool(areaIds: string[]): Anthropic.Tool {
  return {
    name: "record_answer",
    description: "聞き返しへのスタッフの答えを反映した、報告の確定版を記録する",
    input_schema: {
      type: "object",
      properties: {
        areas: {
          type: "array",
          items: areaIds.length ? { type: "string", enum: areaIds } : { type: "string" },
          description: "確定した清掃箇所。答えで否定された箇所は外し、答えで分かった箇所は足す。それ以外は今の記録のまま",
        },
        supplies_out: { type: "array", items: { type: "string" }, description: "確定した備品切れ" },
        trouble: { type: ["string", "null"], description: "トラブルの内容。なければ null" },
        memo: { type: ["string", "null"], description: "メモ。なければ null" },
        confidence: { type: "number", minimum: 0, maximum: 1, description: "確定版の確信度。答えで確かめられたら上げる" },
        leftover_cleared: {
          type: "boolean",
          description: "聞き返しが「残っている汚れ・ゴミを拾ってもらえますか」で、答えから片づけたと分かるなら true。片づけていない・分からないなら false",
        },
        reply: {
          type: "string",
          description: "スレッドに返すお礼と、確定した内容を1文で。質問はしない。責めない",
        },
      },
      required: ["areas", "supplies_out", "trouble", "memo", "confidence", "leftover_cleared", "reply"],
    },
  };
}

function system(input: ResolveInput): string {
  const areas = input.areas.map((a) => `- ${a.id}: ${a.name}`).join("\n");
  return [
    `あなたは無人自習室「${input.storeName}」の清掃報告を記録する係です。`,
    "報告に確信が持てない点があったので、スタッフに1つだけ聞き返しました。その答えを反映した確定版を record_answer に記録してください。",
    "文章で答えずに、必ず record_answer を1回だけ呼んでください。",
    "",
    "清掃箇所(この中からだけ選ぶ):",
    areas || "(なし)",
    "",
    "決まりごと:",
    "- 答えで確かめられたことだけを変える。答えに出てこない点は今の記録のまま残す",
    "- 答えが「はい」「合ってます」なら今の記録を確定する",
    "- 聞き返しは1回だけ。reply で重ねて質問しない。答えが曖昧でも、今の記録を残してお礼だけ返す",
    "- reply はスタッフへの返事。短く、責めない。オーナーの口調に寄せる",
    input.toneSample ? `- オーナーの口調の例: 「${input.toneSample}」` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function userText(input: ResolveInput): string {
  const name = (id: string) => input.areas.find((a) => a.id === id)?.name ?? id;
  return [
    `元の報告: ${input.originalText || "(本文なし)"}(写真${input.imageCount}枚)`,
    "今の記録:",
    `- 清掃箇所: ${input.current.areas.map(name).join("、") || "(なし)"}`,
    `- 備品切れ: ${input.current.supplies_out.join("、") || "(なし)"}`,
    `- トラブル: ${input.current.trouble ?? "(なし)"}`,
    `- メモ: ${input.current.memo ?? "(なし)"}`,
    `聞き返した問い: ${input.question}`,
    `スタッフの答え: ${input.answer}`,
  ].join("\n");
}

export function claudeResolver(apiKey: string): Resolver {
  const client = new Anthropic({ apiKey });
  return async (input) => {
    const ids = input.areas.map((a) => a.id);
    const res = await client.messages.create({
      model: STRUCTURE_MODEL,
      max_tokens: 512,
      system: system(input),
      // claude-sonnet-5-5 は tool_choice で特定のツールを強制できない(structure.ts と同じ)
      tools: [tool(ids)],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: userText(input) }],
    });
    const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!block) throw new Error("聞き返しの確定版が返りませんでした");
    return {
      result: normalizeAnswer(block.input as Partial<ResolveResult>, ids),
      usage: { model: res.model, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens },
    };
  };
}

export function normalizeAnswer(raw: Partial<ResolveResult>, areaIds: string[]): ResolveResult {
  const known = new Set(areaIds);
  // 答えへの返事では問わない(聞き返しは1回だけ)。問いの文は落とす
  const sentences = (raw.reply ?? "").trim().match(/[^。！!?？\n]+[。！!?？]?/g) ?? [];
  const reply = sentences.filter((s) => !/[?？]$/.test(s.trim()) && !/教えて/.test(s)).join("").trim();
  return {
    areas: [...new Set((raw.areas ?? []).filter((a) => known.has(a)))],
    supplies_out: (raw.supplies_out ?? []).filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim()),
    trouble: raw.trouble?.trim() || null,
    memo: raw.memo?.trim() || null,
    confidence: typeof raw.confidence === "number" ? Math.min(1, Math.max(0, raw.confidence)) : 0.8,
    leftover_cleared: raw.leftover_cleared === true,
    reply: reply || "ありがとうございます。記録しました。",
  };
}
