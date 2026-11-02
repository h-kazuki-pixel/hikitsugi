// 引き継ぎ帳のエージェント(設計書 5-5。現場エージェントのモデル claude-opus-5-5)
//
// Claude はツールを使って引き継ぎ帳を探し、最後に3つのうち1つを選ぶ:
//   answer_from_source … 人が答えた言葉が質問に当たっている → その回答を出典つきで返す
//   wait_for_owner     … 同じ質問をオーナーに確認中 → 二度聞かずに「確認中」と返す
//   ask_owner          … 当たる答えがない → オーナーに一度だけ聞く
//
// 約束1「出典のない回答は出さない」はプロンプトだけに任せない。
// スタッフに返す文は Claude に書かせず、選ばれた回答の原文と出典をコードが並べる。
// 選ばれた ID が検索で見せた候補にない・回答がないときは、答えずにオーナーに回す。

import type Anthropic from "@anthropic-ai/sdk";
import { searchKnowledge, type KnowledgeHit } from "./search";

export const AGENT_MODEL = "claude-opus-5-5";
const MAX_TURNS = 5;

export type ModelCall = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;

export type Decision =
  | { type: "answer"; hit: KnowledgeHit }
  | { type: "wait"; hit: KnowledgeHit }
  | { type: "ask_owner"; kind: "place" | "procedure" | "judgment" };

export type AgentStep = { tool: string; input: unknown; result: string };

export type AgentRun = {
  decision: Decision;
  steps: AgentStep[]; // 判断経路(呼んだツール)
  usage: { model: string; input_tokens: number; output_tokens: number; turns: number };
};

const KINDS = ["place", "procedure", "judgment"] as const;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_knowledge",
    description:
      "店舗の引き継ぎ帳を探す。人(オーナー・副担当)が過去に実際に答えた質問と回答、出典(誰がいつ)が返る。オーナーが承認した有効なルール(source_type = rule)も返る。答えのない質問(オーナー確認中)も返る。言い換えて何度呼んでもよい",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "探す言葉(質問の言い換えでよい)" } },
      required: ["query"],
    },
  },
  {
    name: "answer_from_source",
    description:
      "検索で見つけた回答済みの知識が、この質問にそのまま当たるときだけ選ぶ。回答の原文と出典がスタッフに返る。少しでも別の話なら選ばない",
    input_schema: {
      type: "object",
      properties: {
        knowledge_id: { type: "string", description: "検索結果の id" },
        why: { type: "string", description: "当たると判断した理由(判断経路に残す。スタッフには送らない)" },
      },
      required: ["knowledge_id", "why"],
    },
  },
  {
    name: "wait_for_owner",
    description: "同じ質問がすでにオーナー確認中(status が pending_owner)のときに選ぶ。オーナーに二度聞かない",
    input_schema: {
      type: "object",
      properties: {
        knowledge_id: { type: "string", description: "確認中の質問の id" },
        why: { type: "string" },
      },
      required: ["knowledge_id", "why"],
    },
  },
  {
    name: "ask_owner",
    description: "引き継ぎ帳に当たる答えがないときに選ぶ。オーナーに一度だけ聞き、答えが来たらスタッフに返して引き継ぎ帳に残す",
    input_schema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: [...KINDS],
          description: "place=どこに何があるか / procedure=どうやるか / judgment=していいか・仕様か・どう対応するか",
        },
        why: { type: "string" },
      },
      required: ["kind", "why"],
    },
  },
];

function system(storeName: string): string {
  return [
    `あなたは無人自習室「${storeName}」の引き継ぎ帳を預かる係です。スタッフから質問が来ました。`,
    "まず search_knowledge で引き継ぎ帳を探し、最後に answer_from_source / wait_for_owner / ask_owner のどれか1つを呼んで終えてください。文章で答えないでください。",
    "",
    "決まりごと:",
    "- 引き継ぎ帳にあるのは、人が実際に答えた言葉だけです。あなたが自分の知識で答えを作ってはいけません",
    "- 回答が質問にそのまま当たるときだけ answer_from_source。似ているが別の物・別の場面の話なら当たらないとみなす(例: 暖房の温度の答えは、加湿器を置いてよいかの答えにならない)",
    "- 迷ったら ask_owner。人に回すのは失敗ではありません。出典のない答えを返すほうが悪い",
    "- 検索は言い換えて2〜3回まで試してよい",
  ].join("\n");
}

function hitForModel(h: KnowledgeHit) {
  return {
    id: h.id,
    source_type: h.source_type,
    ...(h.rule_no ? { rule_no: h.rule_no } : {}),
    question: h.question,
    kind: h.kind,
    status: h.status,
    answer: h.answer,
    source: h.answered_by && h.answered_at ? `${h.answered_by}、${h.answered_at}` : null,
    score: h.score,
  };
}

export type SearchFn = (query: string) => Promise<KnowledgeHit[]>;

// 引き継ぎ帳を D1 から探す(実稼働)。過去の質問の流し直しでは、その時点の知識だけを持つ検索に差し替える
export const d1Search = (db: D1Database, storeId: string | null, asOf?: string): SearchFn => (query) => searchKnowledge(db, storeId, query, { asOf });

export async function runHandoffAgent(
  search: SearchFn,
  input: { storeName: string; senderName: string | null; question: string },
  call: ModelCall,
): Promise<AgentRun> {
  const seen = new Map<string, KnowledgeHit>();
  const steps: AgentStep[] = [];
  const usage = { model: AGENT_MODEL, input_tokens: 0, output_tokens: 0, turns: 0 };
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `質問した人: ${input.senderName ?? "(名簿にない人)"}\n質問: ${input.question}` },
  ];
  const fallback = (why: string): AgentRun => {
    steps.push({ tool: "(コードの既定)", input: null, result: why });
    return { decision: { type: "ask_owner", kind: "judgment" }, steps, usage };
  };

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await call({
      model: AGENT_MODEL,
      max_tokens: 2048,
      system: system(input.storeName),
      tools: TOOLS,
      tool_choice: { type: "auto" },
      messages,
    });
    usage.model = res.model;
    usage.input_tokens += res.usage.input_tokens;
    usage.output_tokens += res.usage.output_tokens;
    usage.turns++;

    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (uses.length === 0) return fallback("ツールを選ばずに終わったので、答えずにオーナーに回す");

    // 終わりの選択があれば、それで決める(同じ応答の中の検索より優先)
    const final = uses.find((u) => u.name !== "search_knowledge");
    if (final) {
      const args = final.input as { knowledge_id?: string; kind?: string; why?: string };
      steps.push({ tool: final.name, input: args, result: "" });
      if (final.name === "answer_from_source") {
        const hit = args.knowledge_id ? seen.get(args.knowledge_id) : undefined;
        if (!hit || hit.status !== "answered" || !hit.answer) {
          return fallback("選ばれた知識が検索結果にないか回答がないので、答えずにオーナーに回す");
        }
        return { decision: { type: "answer", hit }, steps, usage };
      }
      if (final.name === "wait_for_owner") {
        const hit = args.knowledge_id ? seen.get(args.knowledge_id) : undefined;
        if (!hit || hit.status !== "pending_owner") return fallback("確認中の質問が見つからないので、オーナーに聞く");
        return { decision: { type: "wait", hit }, steps, usage };
      }
      const kind = KINDS.includes(args.kind as (typeof KINDS)[number]) ? (args.kind as (typeof KINDS)[number]) : "judgment";
      return { decision: { type: "ask_owner", kind }, steps, usage };
    }

    // 検索を実行して結果を返す
    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const u of uses) {
      const query = String((u.input as { query?: unknown }).query ?? "");
      const hits = await search(query);
      for (const h of hits) seen.set(h.id, h);
      const body = JSON.stringify(hits.map(hitForModel));
      steps.push({ tool: "search_knowledge", input: { query }, result: `${hits.length}件: ${hits.map((h) => h.id).join(", ")}` });
      results.push({ type: "tool_result", tool_use_id: u.id, content: body });
    }
    messages.push({ role: "user", content: results });
  }
  return fallback(`${MAX_TURNS}回で決まらなかったので、答えずにオーナーに回す`);
}
