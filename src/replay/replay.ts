// 過去の質問の流し直し(設計書 5-5)
//
// 引き継ぎ帳を空の状態から始め、過去の質問を時系列で流す。各質問の時点では、それより前に
// 人が実際に答えた内容のうち、再利用できる答えだけを知識として持たせる(未来の答えを知らない。
// 「今から行きます」のようなその場の対応は積まない)。本番と同じエージェント
// (runHandoffAgent)と同じ守り(スタッフへの文はコードが組む)で、各質問を3つに分ける:
//   出典つきで返せた / 人に回した / 出典なしで答えてしまった(構造上 0 のはず。検算する)
// 返せたものは、当時の実際の答えと趣旨が合っているかを Claude が判定する(オーナーが抜き取りで確かめる)。
// あわせて「帳に答えがあったはずか」を別に判定する(その時点の帳を全部見せて、そのまま答えになるものがあるか)。
// これで、返せなかった理由を「帳になかった / 探して出てこなかった / 出てきたが選ばなかった」に分けられる。
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
// その時点の帳(再利用できる答え)の中に、この質問のそのままの答えがあるか。あればその id、なければ null
export type AnswerableJudge = (input: { question: string; book: { id: string; question: string; answer: string }[] }) => Promise<{ id: string | null }>;

export type ReplayItem = {
  id: string;
  outcome: "answered_with_source" | "handed_to_human" | "answered_without_source";
  source_id: string | null; // 返した知識(過去の質問の id)
  verdict: Verdict | null; // 当時の答えが再利用できる答えのときだけ判定する
  // その質問に当時あった答えの種類: 再利用できる答え / その場の対応(「今から行きます」など)/ 答えなし
  at_the_time: "reusable" | "situational" | "none";
  // 帳に答えがあったはずか(AnswerableJudge の判定。測っていなければ undefined)。id は答えになるはずだった知識
  answerable?: { id: string | null };
  shown_ids: string[]; // エージェントが検索で見た知識の id(本文は持たない)
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
  holiday: Breakdown; // 休日に来た質問
  off_hours: Breakdown; // 営業時間外(休日 + 平日夜)に来た質問
  judged: number; // 返せたもののうち、当時の答えが再利用できる答えで、趣旨を判定したもの
  match: number;
  partial: number;
  mismatch: number;
  match_rate: number | null; // match / judged
  situational_at_the_time: number; // 返せたもののうち、当時は個別対応(その場の対応)だったもの。判定しない
  no_answer_at_the_time: number; // 返せたもののうち、当時は答えがなかったもの。判定しない
  answerable: AnswerableSummary | null; // 帳に答えがあったはずの件数(測ったときだけ)
  tokens: { input: number; output: number };
};

export type AnswerableSummary = {
  total: number; // 帳に答えがあったはずの質問
  answered_with_source: number; // そのうち出典つきで返せた
  answered_same_source: number; // そのうち、判定と同じ知識を返した
  missed_not_shown: number; // 人に回した。答えになる知識が検索の候補に出ていなかった(探し方)
  missed_shown: number; // 人に回した。候補には出ていたが選ばなかった(慎重すぎ)
  answered_but_not_answerable: number; // 帳に答えがないはずなのに返した
  holiday: { total: number; answered_with_source: number };
  off_hours: { total: number; answered_with_source: number };
};

export type Breakdown = { total: number; answered_with_source: number; handed_to_human: number; answered_without_source: number };

// その時点(asOf)の帳: それより前に人が答えた、再利用できる答え
export function bookAt(past: PastQuestion[], asOf: string): PastQuestion[] {
  return past.filter((p) => p.reusable && p.asked_at < asOf && p.answer && p.answered_at && p.answered_at < asOf);
}

// その時点(asOf)までに人が答えた内容だけの検索
export function asOfSearch(past: PastQuestion[], asOf: string) {
  return async (query: string): Promise<KnowledgeHit[]> =>
    bookAt(past, asOf)
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
  deps: { call: ModelCall; judge: Judge; answerable?: AnswerableJudge; onItem?: (item: ReplayItem, i: number) => void },
): Promise<{ items: ReplayItem[]; summary: ReplaySummary }> {
  const past = [...rows].sort((a, b) => a.asked_at.localeCompare(b.asked_at));
  const items: ReplayItem[] = [];
  for (const [i, q] of past.entries()) {
    const base = asOfSearch(past, q.asked_at);
    const shown = new Set<string>();
    const search = async (query: string) => {
      const hits = await base(query);
      for (const h of hits) shown.add(h.id);
      return hits;
    };
    const run = await runHandoffAgent(search, { storeName: "店舗", senderName: "スタッフ", question: q.question }, deps.call);
    const at_the_time: ReplayItem["at_the_time"] = !q.answer ? "none" : q.reusable ? "reusable" : "situational";
    let answerable: ReplayItem["answerable"];
    if (deps.answerable) {
      const book = bookAt(past, q.asked_at);
      if (book.length === 0) answerable = { id: null };
      else {
        const got = await deps.answerable({ question: q.question, book: book.map((b) => ({ id: b.id, question: b.question, answer: b.answer! })) });
        answerable = { id: got.id && book.some((b) => b.id === got.id) ? got.id : null };
      }
    }
    const extra = { at_the_time, ...(answerable ? { answerable } : {}), shown_ids: [...shown], off_hours: q.off_hours, holiday: q.holiday };
    let item: ReplayItem;
    if (run.decision.type === "answer") {
      const hit = run.decision.hit;
      // 検算: 返した文が、その時点で人が答えた言葉そのものか(コードが組むので必ずそうなるはず)
      const known = past.find((p) => p.id === hit.id && p.reusable && p.answered_at && p.answered_at < q.asked_at);
      const sourced = !!known && hit.answer === known.answer;
      let verdict: Verdict | null = null;
      if (sourced && at_the_time === "reusable" && q.answer) verdict = (await deps.judge({ question: q.question, returned: answerText(hit), actual: q.answer })).verdict;
      item = {
        id: q.id,
        outcome: sourced ? "answered_with_source" : "answered_without_source",
        source_id: hit.id,
        verdict,
        ...extra,
        tokens: { input: run.usage.input_tokens, output: run.usage.output_tokens },
      };
    } else {
      // wait(同じ質問を確認中)はこの流し直しでは起きない(過去の答えはすべて揃っている)が、出たら人に回したと数える
      item = { id: q.id, outcome: "handed_to_human", source_id: null, verdict: null, ...extra, tokens: { input: run.usage.input_tokens, output: run.usage.output_tokens } };
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
  const breakdown = (f: (i: ReplayItem) => boolean): Breakdown => ({
    total: count(f),
    answered_with_source: count((i) => f(i) && i.outcome === "answered_with_source"),
    handed_to_human: count((i) => f(i) && i.outcome === "handed_to_human"),
    answered_without_source: count((i) => f(i) && i.outcome === "answered_without_source"),
  });
  return {
    total: items.length,
    answered_with_source: count((i) => i.outcome === "answered_with_source"),
    answered_with_source_off_hours: count((i) => i.outcome === "answered_with_source" && i.off_hours),
    handed_to_human: count((i) => i.outcome === "handed_to_human"),
    answered_without_source: count((i) => i.outcome === "answered_without_source"),
    holiday: breakdown((i) => i.holiday),
    off_hours: breakdown((i) => i.off_hours),
    judged,
    match,
    partial: count((i) => i.verdict === "partial"),
    mismatch: count((i) => i.verdict === "mismatch"),
    match_rate: judged ? Math.round((match / judged) * 1000) / 1000 : null,
    situational_at_the_time: count((i) => i.outcome === "answered_with_source" && i.at_the_time === "situational"),
    no_answer_at_the_time: count((i) => i.outcome === "answered_with_source" && i.at_the_time === "none"),
    answerable: items.some((i) => i.answerable) ? summarizeAnswerable(items) : null,
    tokens: items.reduce((t, i) => ({ input: t.input + i.tokens.input, output: t.output + i.tokens.output }), { input: 0, output: 0 }),
  };
}

function summarizeAnswerable(items: ReplayItem[]): AnswerableSummary {
  const yes = items.filter((i) => i.answerable?.id);
  const answered = (i: ReplayItem) => i.outcome === "answered_with_source";
  const missed = yes.filter((i) => i.outcome === "handed_to_human");
  return {
    total: yes.length,
    answered_with_source: yes.filter(answered).length,
    answered_same_source: yes.filter((i) => answered(i) && i.source_id === i.answerable!.id).length,
    missed_not_shown: missed.filter((i) => !i.shown_ids.includes(i.answerable!.id!)).length,
    missed_shown: missed.filter((i) => i.shown_ids.includes(i.answerable!.id!)).length,
    answered_but_not_answerable: items.filter((i) => i.answerable && !i.answerable.id && answered(i)).length,
    holiday: { total: yes.filter((i) => i.holiday).length, answered_with_source: yes.filter((i) => i.holiday && answered(i)).length },
    off_hours: { total: yes.filter((i) => i.off_hours).length, answered_with_source: yes.filter((i) => i.off_hours && answered(i)).length },
  };
}

// 帳に答えがあったはずかを Claude(claude-sonnet-5-5)が判定する。その時点の帳を全部見せる
export function claudeAnswerable(create: (p: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>): AnswerableJudge {
  return async ({ question, book }) => {
    const res = await create({
      model: "claude-sonnet-5-5",
      max_tokens: 400,
      system: [
        "無人自習室のスタッフの質問と、その時点で引き継ぎ帳にあった過去の答え(人が実際に答えた言葉)の一覧を見ます。",
        "一覧の中に、この質問にそのまま答えになるもの(その答えを読めば、スタッフが次に取る行動が決まるもの)があるかを判定し、record_answerable を1回だけ呼んでください。文章で答えないでください。",
        "- 似た話題でも、別の物・別の場面の答えは当たらない",
        "- 前後のやり取りがないと何を聞いているか分からない質問(「どうしましょうか」だけ等)は、当たるものなしとする",
        "- 当たるものが複数あれば、一番そのまま答えになるもの1つ",
      ].join("\n"),
      tools: [
        {
          name: "record_answerable",
          description: "判定を記録する",
          input_schema: {
            type: "object",
            properties: {
              id: { type: "string", description: "そのまま答えになる過去の答えの id。なければ空文字" },
              reason: { type: "string" },
            },
            required: ["id", "reason"],
          },
        },
      ],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: `質問: ${question}\n\n引き継ぎ帳:\n${JSON.stringify(book)}` }],
    });
    const b = res.content.find((x): x is Anthropic.ToolUseBlock => x.type === "tool_use");
    const id = String((b?.input as { id?: unknown } | undefined)?.id ?? "").trim();
    return { id: id || null };
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
  const [head, ...body] = parseCsvRows(text);
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

// CSV を行と欄に分ける(引用符・欄の中のカンマと改行に対応。空行は飛ばす)
export function parseCsvRows(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
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
  return rows;
}
