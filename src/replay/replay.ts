// 過去の質問の流し直し(設計書 5-5)
//
// 引き継ぎ帳を空の状態から始め、過去の質問を時系列で流す。各質問の時点では、それより前に
// 人が実際に答えた内容のうち、再利用できる答えだけを知識として持たせる(未来の答えを知らない。
// 「今から行きます」のようなその場の対応は積まない)。本番と同じエージェント
// (runHandoffAgent)と同じ守り(スタッフへの文はコードが組む)で、各質問を3つに分ける:
//   出典つきで返せた / 人に回した / 出典なしで答えてしまった(構造上 0 のはず。検算する)
// 返せたものは、当時の実際の答えと趣旨が合っているかを Claude が判定する(オーナーが抜き取りで確かめる)。
//
// 実名入りの元データは実店舗用の環境(非公開)でだけ回す。公開するのは件数と割合だけ。
// リポジトリには同じ処理を架空データつきで置く(scripts/replay/sample.csv)。

import type Anthropic from "@anthropic-ai/sdk";
import { runHandoffAgent, type ModelCall } from "../knowledge/agent";
import { answerText, similarity, type KnowledgeHit } from "../knowledge/search";

export type PastQuestion = {
  id: string;
  asked_at: string; // ISO
  question: string;
  answered_at: string | null; // ISO。答えがなければ空
  answered_by: string | null;
  answer: string | null; // 当時の実際の答え
  kind: "place" | "procedure" | "judgment" | null;
  off_hours: boolean; // 営業時間外(土日祝・平日夜など)に来たか
  holiday: boolean; // 休日(土日祝・運営の休業日)に来たか
  // 帳に積む答えか。「その場の対応」(今から行きます、写真を見ての答えなど)と「答えなし」は積まない。
  // 列がなければ、答えのある行はすべて積む(架空の sample.csv の形)
  reusable: boolean;
};

export type Verdict = "match" | "partial" | "mismatch";
export type Judge = (input: { question: string; returned: string; actual: string }) => Promise<{ verdict: Verdict; reason: string }>;

export type ReplayItem = {
  id: string;
  outcome: "answered_with_source" | "handed_to_human" | "answered_without_source";
  source_id: string | null; // 返した知識(過去の質問の id)
  verdict: Verdict | null;
  off_hours: boolean;
  holiday: boolean;
  tokens: { input: number; output: number };
};

export type ReplaySummary = {
  total: number;
  answered_with_source: number;
  answered_with_source_off_hours: number;
  handed_to_human: number;
  answered_without_source: number; // 目標 0
  holiday: { total: number; answered_with_source: number; handed_to_human: number; answered_without_source: number };
  judged: number;
  match: number;
  partial: number;
  mismatch: number;
  match_rate: number | null; // match / judged
  tokens: { input: number; output: number };
};

// その時点(asOf)までに人が答えた内容だけの検索
export function asOfSearch(past: PastQuestion[], asOf: string) {
  return async (query: string): Promise<KnowledgeHit[]> =>
    past
      .filter((p) => p.reusable && p.asked_at < asOf && p.answer && p.answered_at && p.answered_at < asOf)
      .map((p) => ({
        id: p.id,
        source_type: "knowledge" as const,
        question: p.question,
        kind: p.kind,
        status: "answered" as const,
        answer: p.answer,
        answered_by: p.answered_by ?? "運営",
        answered_at: p.answered_at,
        score: Math.round(similarity(query, p.question) * 100) / 100,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10); // 件数が多いので本番(6件)より広めに見せる
}

export async function replay(
  rows: PastQuestion[],
  deps: { call: ModelCall; judge: Judge; onItem?: (item: ReplayItem, i: number) => void },
): Promise<{ items: ReplayItem[]; summary: ReplaySummary }> {
  const past = [...rows].sort((a, b) => a.asked_at.localeCompare(b.asked_at));
  const items: ReplayItem[] = [];
  for (const [i, q] of past.entries()) {
    const search = asOfSearch(past, q.asked_at);
    const run = await runHandoffAgent(search, { storeName: "店舗", senderName: "スタッフ", question: q.question }, deps.call);
    let item: ReplayItem;
    if (run.decision.type === "answer") {
      const hit = run.decision.hit;
      // 検算: 返した文が、その時点で人が答えた言葉そのものか(コードが組むので必ずそうなるはず)
      const known = past.find((p) => p.id === hit.id && p.reusable && p.answered_at && p.answered_at < q.asked_at);
      const sourced = !!known && hit.answer === known.answer;
      let verdict: Verdict | null = null;
      if (sourced && q.answer) verdict = (await deps.judge({ question: q.question, returned: answerText(hit), actual: q.answer })).verdict;
      item = {
        id: q.id,
        outcome: sourced ? "answered_with_source" : "answered_without_source",
        source_id: hit.id,
        verdict,
        off_hours: q.off_hours,
        holiday: q.holiday,
        tokens: { input: run.usage.input_tokens, output: run.usage.output_tokens },
      };
    } else {
      // wait(同じ質問を確認中)はこの流し直しでは起きない(過去の答えはすべて揃っている)が、出たら人に回したと数える
      item = { id: q.id, outcome: "handed_to_human", source_id: null, verdict: null, off_hours: q.off_hours, holiday: q.holiday, tokens: { input: run.usage.input_tokens, output: run.usage.output_tokens } };
    }
    items.push(item);
    deps.onItem?.(item, i);
  }
  return { items, summary: summarize(items) };
}

export function summarize(items: ReplayItem[]): ReplaySummary {
  const count = (f: (i: ReplayItem) => boolean) => items.filter(f).length;
  const judged = count((i) => i.verdict !== null);
  const match = count((i) => i.verdict === "match");
  return {
    total: items.length,
    answered_with_source: count((i) => i.outcome === "answered_with_source"),
    answered_with_source_off_hours: count((i) => i.outcome === "answered_with_source" && i.off_hours),
    handed_to_human: count((i) => i.outcome === "handed_to_human"),
    answered_without_source: count((i) => i.outcome === "answered_without_source"),
    holiday: {
      total: count((i) => i.holiday),
      answered_with_source: count((i) => i.holiday && i.outcome === "answered_with_source"),
      handed_to_human: count((i) => i.holiday && i.outcome === "handed_to_human"),
      answered_without_source: count((i) => i.holiday && i.outcome === "answered_without_source"),
    },
    judged,
    match,
    partial: count((i) => i.verdict === "partial"),
    mismatch: count((i) => i.verdict === "mismatch"),
    match_rate: judged ? Math.round((match / judged) * 1000) / 1000 : null,
    tokens: items.reduce((t, i) => ({ input: t.input + i.tokens.input, output: t.output + i.tokens.output }), { input: 0, output: 0 }),
  };
}

// 趣旨の一致を Claude(claude-sonnet-5-5)が判定する
export function claudeJudge(create: (p: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>): Judge {
  return async (input) => {
    const res = await create({
      model: "claude-sonnet-5-5",
      max_tokens: 300,
      system: [
        "無人自習室のスタッフの質問に対して、過去の答えを引いて返した文と、当時オーナーが実際に返した答えを比べます。",
        "スタッフが取る行動が同じになるかで判定し、record_verdict を1回だけ呼んでください。文章で答えないでください。",
        "match = 同じ行動になる / partial = 大筋は同じだが、当時の答えにある大事な条件が欠けている / mismatch = 違う行動になる、または別の話",
      ].join("\n"),
      tools: [
        {
          name: "record_verdict",
          description: "判定を記録する",
          input_schema: {
            type: "object",
            properties: { verdict: { type: "string", enum: ["match", "partial", "mismatch"] }, reason: { type: "string" } },
            required: ["verdict", "reason"],
          },
        },
      ],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: `質問: ${input.question}\n返した文: ${input.returned}\n当時の答え: ${input.actual}` }],
    });
    const b = res.content.find((x): x is Anthropic.ToolUseBlock => x.type === "tool_use");
    const v = (b?.input ?? {}) as { verdict?: Verdict; reason?: string };
    return { verdict: v.verdict === "match" || v.verdict === "partial" ? v.verdict : "mismatch", reason: v.reason ?? "" };
  };
}

// CSV(ヘッダつき)を読む。列: id, asked_at, question, answered_at, answered_by, answer, kind, off_hours, holiday, reusable
// holiday・reusable は省略できる(holiday は偽、reusable は真とみる)
export function parseCsv(text: string): PastQuestion[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== "")) rows.push(row);

  const [head, ...body] = rows;
  if (!head) return [];
  const idx = (name: string) => head.indexOf(name);
  const get = (r: string[], name: string) => (idx(name) >= 0 ? (r[idx(name)] ?? "").trim() : "");
  const flag = (v: string) => ["1", "true", "yes", "はい"].includes(v.toLowerCase());
  const iso = (v: string) => (v ? new Date(/[zZ+]/.test(v.slice(10)) ? v : `${v.replace(" ", "T")}+09:00`).toISOString() : null);
  return body.map((r) => {
    const kind = get(r, "kind");
    return {
      id: get(r, "id"),
      asked_at: iso(get(r, "asked_at"))!,
      question: get(r, "question"),
      answered_at: iso(get(r, "answered_at")),
      answered_by: get(r, "answered_by") || null,
      answer: get(r, "answer") || null,
      kind: kind === "place" || kind === "procedure" || kind === "judgment" ? kind : null,
      off_hours: flag(get(r, "off_hours")),
      holiday: flag(get(r, "holiday")),
      reusable: idx("reusable") >= 0 ? flag(get(r, "reusable")) : true,
    };
  });
}
