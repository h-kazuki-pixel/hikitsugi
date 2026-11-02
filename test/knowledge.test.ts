// 引き継ぎ帳の最小形(設計書 5-5): 出典つきで答える / 知らなければ確認中と返してオーナーに一度だけ聞く /
// オーナーの答えをスタッフに返して積む / 次から出典つきで答える
// Claude(引き継ぎ帳のエージェント)と Slack は差し替える。D1 はローカルの seed 入り
import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toReportEvent, type SlackMessageEvent } from "../src/channels/slack";
import type { ModelCall } from "../src/knowledge/agent";
import { TEXT } from "../src/knowledge/handle";
import { searchKnowledge, similarity } from "../src/knowledge/search";
import { normalizeAnswer } from "../src/report/clarify";
import { processReportEvent, type ProcessDeps } from "../src/report/process";
import { normalize, type StructureResult } from "../src/report/structure";
import type { SlackClient } from "../src/slack/api";
import { demoEnv } from "./helpers";

let proxy: Awaited<ReturnType<typeof demoEnv>>;
beforeAll(async () => {
  proxy = await demoEnv();
});
afterAll(async () => {
  await proxy?.dispose();
});
const db = () => proxy.env.DB;

// 2026-11-07(土)13:00 JST = 04:00 UTC。土曜は運営会社の休業日(seed)
const SAT = Date.UTC(2026, 10, 7, 4, 0) / 1000;
const ts = (offsetSec: number) => (SAT + offsetSec).toFixed(6);

function dm(over: Partial<SlackMessageEvent> = {}): SlackMessageEvent {
  return { type: "message", user: "U_DEMO_AOI", channel: "D_DEMO_AOI", channel_type: "im", ts: ts(0), text: "寒いけど暖房上げていい?", ...over };
}

type Block = Anthropic.ContentBlock;
const use = (name: string, input: Record<string, unknown>, id = `tu_${name}`): Block => ({ type: "tool_use", id, name, input }) as Block;
const said = (text: string): Block => ({ type: "text", text, citations: null }) as Block;

// 決まった順に応答を返す Claude の代わり。受け取ったリクエストも記録する
function scripted(turns: Block[][]) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const call: ModelCall = async (params) => {
    requests.push(structuredClone(params));
    const content = turns.shift();
    if (!content) throw new Error("台本より多く呼ばれた");
    return { id: "msg", type: "message", role: "assistant", model: "fake-opus", content, stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } } as unknown as Anthropic.Message;
  };
  return { call, requests };
}

// Slack の ts はワークスペースの中で重ならないので、差し替えでも通しで数える
let slackTs = 0;

function fakes(turns: Block[][], structured: Partial<StructureResult> = { categories: ["question"], areas: [], reply: "" }) {
  const posted: { channel: string; text: string; thread?: string; ts: string }[] = [];
  const slack: SlackClient = {
    async postMessage(channel, text, thread) {
      const t = `9${String(++slackTs).padStart(3, "0")}.000100`;
      posted.push({ channel, text, thread, ts: t });
      // ユーザーID 宛ては DM が開く(chat.postMessage の返す channel は D…)
      return { ok: true, ts: t, channel: channel.startsWith("U_") ? `D_${channel.slice(2)}` : channel };
    },
    async fetchImage() {
      return null;
    },
  };
  const model = scripted(turns);
  const deps: ProcessDeps = {
    slack,
    agent: model.call,
    structure: async (input) => ({ result: normalize(structured, input.areas.map((a) => a.id)), usage: { model: "t", input_tokens: 1, output_tokens: 1 } }),
    resolve: async (input) => ({ result: normalizeAnswer({}, input.areas.map((a) => a.id)), usage: { model: "t", input_tokens: 1, output_tokens: 1 } }),
  };
  return { deps, posted, requests: model.requests };
}

describe("引き継ぎ帳の検索", () => {
  it("語の重なりで近い質問を上に並べる", async () => {
    expect(similarity("暖房を上げてもいい?", "寒いけど暖房上げていい?")).toBeGreaterThanOrEqual(0.5);
    const hits = await searchKnowledge(db(), "tenjin", "暖房 上げていい");
    expect(hits[0]).toMatchObject({ id: "kn_tenjin_heater", status: "answered", answered_by: "デモオーナー" });
  });

  it("asOf より後に答えられた内容は返さない(過去の質問の流し直し用)", async () => {
    const before = await searchKnowledge(db(), "tenjin", "暖房", { asOf: "2026-09-14T00:00:00Z" });
    expect(before.find((h) => h.id === "kn_tenjin_heater")).toMatchObject({ status: "pending_owner", answer: null });
  });
});

describe("出典つきで答える", () => {
  it("人が答えた回答の原文に出典を添えてスレッドに返す(文は Claude に書かせない)", async () => {
    const { deps, posted, requests } = fakes([
      [use("search_knowledge", { query: "暖房 上げる" })],
      [said("見つかりました"), use("answer_from_source", { knowledge_id: "kn_tenjin_heater", why: "暖房の温度の質問そのもの" })],
    ]);
    const out = await processReportEvent(db(), toReportEvent(dm())!, deps);
    expect(out).toMatchObject({ kind: "question", decision: "answer", knowledgeId: "kn_tenjin_heater", replied: true, ownerAsked: false });
    expect(posted).toEqual([
      { channel: "D_DEMO_AOI", text: "25度までは自由に上げていい。それ以上にしたいときは一声かけて。(9/14 デモオーナーの回答)", thread: ts(0), ts: expect.any(String) },
    ]);
    // 2回目の呼び出しには、検索の結果(出典つき)がツールの結果として渡っている
    const second = JSON.stringify(requests[1]!.messages);
    expect(second).toContain("kn_tenjin_heater");
    expect(requests[0]!.model).toBe("claude-opus-5-5");
  });

  it("検索で見せていない知識を選んでも答えない(約束1: 出典のない回答は出さない)", async () => {
    const { deps, posted } = fakes([[use("answer_from_source", { knowledge_id: "kn_tenjin_heater", why: "たぶん" })]]);
    const out = await processReportEvent(db(), toReportEvent(dm({ ts: ts(30), text: "暖房って何度まで?" }))!, deps);
    expect(out).toMatchObject({ kind: "question", decision: "ask_owner" });
    expect(posted[0]!.text).toBe(`${TEXT.asking}\n${TEXT.closed}`);
  });

  it("ツールを選ばずに文章で答えても、スタッフには送らずオーナーに回す", async () => {
    const { deps, posted } = fakes([[said("25度までなら大丈夫ですよ!")]]);
    const out = await processReportEvent(db(), toReportEvent(dm({ ts: ts(60), text: "暖房つけっぱなしで帰っていい?" }))!, deps);
    expect(out).toMatchObject({ kind: "question", decision: "ask_owner", ownerAsked: true });
    expect(posted.map((p) => p.text).join("\n")).not.toContain("25度までなら");
  });
});

describe("知らない質問 → 確認中 → オーナーに一度だけ → 答えを返して積む → 次から答える", () => {
  let knowledgeId = "";
  let ownerAsk = { channel: "", ts: "" };

  it("店舗チャンネルの質問: 休業日なので遅れると先に返し、オーナーに一度だけ聞く", async () => {
    const { deps, posted } = fakes([
      [use("search_knowledge", { query: "加湿器 置いていい" })],
      [use("ask_owner", { kind: "judgment", why: "加湿器の答えはない。暖房の答えは別の話" })],
    ]);
    const ev = toReportEvent({ type: "message", user: "U_DEMO_MIO", channel: "C_DEMO_TENJIN", channel_type: "channel", ts: ts(600), text: "加湿器って置いていい?" })!;
    const out = await processReportEvent(db(), ev, deps);
    expect(out).toMatchObject({ kind: "not_report", categories: ["question"], question: { kind: "question", decision: "ask_owner", replied: true, ownerAsked: true } });

    expect(posted[0]).toMatchObject({ channel: "C_DEMO_TENJIN", thread: ts(600), text: `${TEXT.asking}\n${TEXT.closed}` });
    expect(posted[1]!.channel).toBe("U_DEMO_OWNER");
    expect(posted[1]!.text).toContain("「加湿器って置いていい?」");
    expect(posted[1]!.text).toContain("みおさん");

    if (out.kind !== "not_report" || out.question?.kind !== "question") throw new Error();
    knowledgeId = out.question.knowledgeId!;
    const k = await db().prepare("SELECT store_id, kind, status, asked_by_staff_id, owner_ask_ref, owner_ask_channel_ref FROM knowledge WHERE id = ?").bind(knowledgeId).first();
    expect(k).toEqual({ store_id: "tenjin", kind: "judgment", status: "pending_owner", asked_by_staff_id: "staff_mio", owner_ask_ref: posted[1]!.ts, owner_ask_channel_ref: "D_DEMO_OWNER" });
    ownerAsk = { channel: "D_DEMO_OWNER", ts: posted[1]!.ts };
  });

  it("同じ質問が確認中なら、オーナーに二度聞かない", async () => {
    const { deps, posted } = fakes([
      [use("search_knowledge", { query: "加湿器" })],
      [use("wait_for_owner", { knowledge_id: knowledgeId, why: "同じ質問を確認中" })],
    ]);
    const out = await processReportEvent(db(), toReportEvent(dm({ user: "U_DEMO_HARUTO", channel: "D_DEMO_HARUTO", ts: ts(900), text: "加湿器持ってきてもいいですか" }))!, deps);
    expect(out).toMatchObject({ kind: "question", decision: "wait", knowledgeId });
    expect(posted).toHaveLength(1);
    expect(posted[0]!.text).toBe(`${TEXT.waiting}\n${TEXT.closed}`);
  });

  it("オーナーが DM のスレッドで答える → スタッフのスレッドに出典つきで返し、回答を積む", async () => {
    // 11/8(日)21:00 JST
    const sunday = (Date.UTC(2026, 10, 8, 12, 0) / 1000).toFixed(6);
    const { deps, posted, requests } = fakes([]);
    const ev = toReportEvent({ type: "message", user: "U_DEMO_OWNER", channel: ownerAsk.channel, channel_type: "im", ts: sunday, thread_ts: ownerAsk.ts, text: "加湿器は置いていい。ただし床置きはだめ。" })!;
    const out = await processReportEvent(db(), ev, deps);
    expect(out).toMatchObject({ kind: "owner_answer", knowledgeId, repliedToStaff: true });
    expect(requests).toEqual([]); // 答えを積むのに Claude は呼ばない

    expect(posted[0]).toMatchObject({
      channel: "C_DEMO_TENJIN",
      thread: ts(600),
      text: "オーナーから答えが来ました。\n加湿器は置いていい。ただし床置きはだめ。(11/8 デモオーナーの回答)",
    });
    expect(posted[1]).toMatchObject({ channel: "D_DEMO_OWNER", thread: ownerAsk.ts, text: "みおさんに返し、引き継ぎ帳に残しました。" });

    const k = await db().prepare("SELECT status FROM knowledge WHERE id = ?").bind(knowledgeId).first();
    expect(k).toEqual({ status: "answered" });
    const a = await db().prepare("SELECT answer, answered_by_staff_id, answered_at, answer_ref FROM knowledge_answers WHERE knowledge_id = ?").bind(knowledgeId).all();
    expect(a.results).toEqual([{ answer: "加湿器は置いていい。ただし床置きはだめ。", answered_by_staff_id: "staff_owner", answered_at: "2026-11-08T12:00:00.000Z", answer_ref: sunday }]);
  });

  it("次からは引き継ぎ帳が出典つきで答える", async () => {
    const { deps, posted } = fakes([
      [use("search_knowledge", { query: "加湿器" })],
      [use("answer_from_source", { knowledge_id: knowledgeId, why: "加湿器を置いてよいかの答え" })],
    ]);
    const out = await processReportEvent(db(), toReportEvent(dm({ user: "U_DEMO_HARUTO", channel: "D_DEMO_HARUTO", ts: ts(86_400 * 2), text: "加湿器って置いていい?" }))!, deps);
    expect(out).toMatchObject({ kind: "question", decision: "answer", knowledgeId });
    expect(posted[0]!.text).toBe("加湿器は置いていい。ただし床置きはだめ。(11/8 デモオーナーの回答)");
  });

  it("問い合わせ以外のスレッドでのオーナーの返事・オーナーからの DM は扱わない", async () => {
    const { deps } = fakes([]);
    expect(await processReportEvent(db(), toReportEvent({ type: "message", user: "U_DEMO_OWNER", channel: "D_DEMO_OWNER", channel_type: "im", ts: ts(5000), thread_ts: "1.000000", text: "了解" })!, deps)).toEqual({
      kind: "ignored",
      reason: "owner_thread_without_question",
    });
    expect(await processReportEvent(db(), toReportEvent({ type: "message", user: "U_DEMO_OWNER", channel: "D_DEMO_OWNER", channel_type: "im", ts: ts(5100), text: "テスト" })!, deps)).toEqual({
      kind: "ignored",
      reason: "operator_post",
    });
    expect(await processReportEvent(db(), toReportEvent(dm({ user: "U_DEMO_NOBODY", ts: ts(5200) }))!, deps)).toEqual({ kind: "ignored", reason: "unknown_sender" });
  });
});
