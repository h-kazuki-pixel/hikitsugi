// 過去の質問の流し直し: その時点で人が答えた内容だけで返せるか。出典なしの回答は 0
import type Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ModelCall } from "../src/knowledge/agent";
import { asOfSearch, parseCsv, replay, type Judge } from "../src/replay/replay";

const rows = parseCsv(readFileSync("scripts/replay/sample.csv", "utf8"));

// 決まった振る舞いの Claude の代わり: 質問そのもので探し、一番近い候補が十分近ければ答え、なければ人に回す
const fakeAgent: ModelCall = async (params) => {
  const msg = (content: Anthropic.ContentBlock[]) =>
    ({ id: "m", type: "message", role: "assistant", model: "fake", content, stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 50, output_tokens: 10 } }) as unknown as Anthropic.Message;
  const last = params.messages.at(-1)!;
  if (typeof last.content === "string") {
    const q = last.content.split("質問: ")[1]!;
    return msg([{ type: "tool_use", id: "s", name: "search_knowledge", input: { query: q } } as Anthropic.ContentBlock]);
  }
  const result = (last.content as Anthropic.ToolResultBlockParam[])[0]!;
  const hits = JSON.parse(String(result.content)) as { id: string; score: number }[];
  const top = hits[0];
  return msg([
    top && top.score >= 0.4
      ? ({ type: "tool_use", id: "a", name: "answer_from_source", input: { knowledge_id: top.id, why: "近い" } } as Anthropic.ContentBlock)
      : ({ type: "tool_use", id: "o", name: "ask_owner", input: { kind: "judgment", why: "ない" } } as Anthropic.ContentBlock),
  ]);
};
const judge: Judge = async ({ returned, actual }) => ({ verdict: returned.slice(0, 4) === actual.slice(0, 4) ? "match" : "partial", reason: "" });

describe("CSV", () => {
  it("JST の時刻を ISO にし、営業時間外の印を読む", () => {
    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({ id: "q01", asked_at: "2026-07-16T09:02:00.000Z", kind: "place", off_hours: true });
    expect(parseCsv('id,asked_at,question\nx,2026-01-01 00:00,"カンマ, と ""引用"" を含む"\n')[0]!.question).toBe('カンマ, と "引用" を含む');
  });
});

describe("その時点の知識だけで探す", () => {
  it("まだ答えが出ていない質問(答えた時刻が後)は知識にならない", async () => {
    // q08 は 9/13 22:10 に聞かれ、9/14 09:05 に答えられた。9/14 08:00 の時点では使えない
    const before = await asOfSearch(rows, new Date("2026-09-13T23:00:00Z").toISOString())("暖房上げていい");
    expect(before.find((h) => h.id === "q08")).toBeUndefined();
    const after = await asOfSearch(rows, new Date("2026-09-14T01:00:00Z").toISOString())("暖房上げていい");
    expect(after[0]!.id).toBe("q08");
  });
});

describe("流し直し", () => {
  it("返せたものは出典つき、返せないものは人に回し、出典なしの回答は 0", async () => {
    const { items, summary } = await replay(rows, { call: fakeAgent, judge });
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(by.q01).toMatchObject({ outcome: "handed_to_human" }); // 最初は帳が空
    expect(by.q05).toMatchObject({ outcome: "answered_with_source", source_id: "q01" });
    // 言い回しが離れていると語の重なりは低い(q07 と q04 は 0.35)。当たりの判断は本番では Claude が候補を読んで行う
    expect(by.q07).toMatchObject({ outcome: "handed_to_human" });
    expect(by.q11).toMatchObject({ outcome: "answered_with_source", source_id: "q08" });
    expect(summary.answered_without_source).toBe(0);
    expect(summary.total).toBe(12);
    expect(summary.answered_with_source + summary.handed_to_human).toBe(12);
    expect(summary.answered_with_source_off_hours).toBeLessThanOrEqual(summary.answered_with_source);
    expect(summary.tokens.input).toBeGreaterThan(0);
  });
});

describe("帳に積むのは再利用できる答えだけ / 休日の内訳", () => {
  // 架空の3件: 1件目は「その場の対応」(積まない)、2件目は再利用できる答え、3件目はどちらにも近い質問
  const csv = [
    "id,asked_at,question,answered_at,answered_by,answer,kind,off_hours,holiday,reusable",
    "a1,2026-07-01 10:00,モップの替えはどこ?,2026-07-01 10:00,デモオーナー,今から持っていきます,place,0,0,0",
    "a2,2026-07-02 10:00,掃除機の紙パックはどこ?,2026-07-02 10:00,デモオーナー,流しの下の引き出しの中。,place,0,0,1",
    "a3,2026-07-04 13:00,モップの替えはどこ?,2026-07-04 13:00,デモオーナー,用具棚の上の段。,place,1,1,1",
    "a4,2026-07-05 13:00,掃除機の紙パックはどこ?,,,,place,1,1,",
  ].join("\n");
  const small = parseCsv(csv);

  it("列を読む。reusable の列がなければ積む", () => {
    expect(small.map((r) => [r.reusable, r.holiday])).toEqual([[false, false], [true, false], [true, true], [false, true]]);
    expect(rows.every((r) => r.reusable && !r.holiday)).toBe(true);
  });

  it("その場の対応は知識にならない。休日の内訳を数える", async () => {
    const hits = await asOfSearch(small, small[2]!.asked_at)("モップの替えはどこ?");
    expect(hits.map((h) => h.id)).toEqual(["a2"]);
    const { items, summary } = await replay(small, { call: fakeAgent, judge });
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(by.a3).toMatchObject({ outcome: "handed_to_human" }); // a1 の答えは積んでいない
    expect(by.a4).toMatchObject({ outcome: "answered_with_source", source_id: "a2" });
    expect(summary.holiday).toEqual({ total: 2, answered_with_source: 1, handed_to_human: 1, answered_without_source: 0 });
  });
});
