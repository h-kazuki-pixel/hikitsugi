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
import type { RuleCheckInput, RuleCheckResult } from "../src/report/rulecheck";
import { processReportEvent, type ProcessDeps } from "../src/report/process";
import { normalize, type StructureInput, type StructureResult } from "../src/report/structure";
import type { SlackClient } from "../src/slack/api";
import { app } from "../src/index";
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

function fakes(turns: Block[][], structured: Partial<StructureResult> = { categories: ["question"], areas: [], reply: "" }, ruleCheck: RuleCheckResult = []) {
  const ruleCheckInputs: RuleCheckInput[] = [];
  const posted: { channel: string; text: string; thread?: string; ts: string }[] = [];
  const slack: SlackClient = {
    async postMessage(channel, text, thread) {
      const t = `9${String(++slackTs).padStart(3, "0")}.000100`;
      posted.push({ channel, text, thread, ts: t });
      // ユーザーID 宛ては DM が開く(chat.postMessage の返す channel は D…)
      return { ok: true, ts: t, channel: channel.startsWith("U_") ? `D_${channel.slice(2)}` : channel };
    },
    async fetchImage() {
      return { base64: "aGVsbG8=", mediaType: "image/jpeg" };
    },
  };
  const model = scripted(turns);
  const drafted: { question: string; answer: string }[] = [];
  const structureInputs: StructureInput[] = [];
  const deps: ProcessDeps = {
    slack,
    agent: model.call,
    checkRules: async (input) => {
      ruleCheckInputs.push(input);
      return { result: ruleCheck, usage: { model: "t", input_tokens: 1, output_tokens: 1 } };
    },
    draftRule: async (input) => {
      drafted.push(input);
      return { natural_text: "加湿器は机上のみ可" };
    },
    structure: async (input) => {
      structureInputs.push(input);
      return {
        result: normalize(
          structured,
          input.areas.map((a) => a.id),
          input.rules.map((r) => r.no),
        ),
        usage: { model: "t", input_tokens: 1, output_tokens: 1 },
      };
    },
    resolve: async (input) => ({ result: normalizeAnswer({}, input.areas.map((a) => a.id)), usage: { model: "t", input_tokens: 1, output_tokens: 1 } }),
  };
  return { deps, posted, requests: model.requests, drafted, structureInputs, ruleCheckInputs };
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
    expect(await db().prepare("SELECT staff_id FROM knowledge_waiters WHERE knowledge_id = ?").bind(knowledgeId).all()).toMatchObject({ results: [{ staff_id: "staff_haruto" }] });
  });

  it("オーナーが DM のスレッドで答える → スタッフのスレッドに出典つきで返し、回答を積む", async () => {
    // 11/8(日)21:00 JST
    const sunday = (Date.UTC(2026, 10, 8, 12, 0) / 1000).toFixed(6);
    const { deps, posted, requests, drafted } = fakes([]);
    const ev = toReportEvent({ type: "message", user: "U_DEMO_OWNER", channel: ownerAsk.channel, channel_type: "im", ts: sunday, thread_ts: ownerAsk.ts, text: "加湿器は置いていい。ただし床置きはだめ。" })!;
    const out = await processReportEvent(db(), ev, deps);
    expect(out).toMatchObject({ kind: "owner_answer", knowledgeId, repliedToStaff: true, ruleCandidate: { ruleNo: 6 } });
    expect(requests).toEqual([]); // 答えを積むのに引き継ぎ帳のエージェントは呼ばない
    expect(drafted).toEqual([{ storeName: "サンプル自習室 天神店", question: "加湿器って置いていい?", answer: "加湿器は置いていい。ただし床置きはだめ。" }]);

    expect(posted[0]).toMatchObject({
      channel: "C_DEMO_TENJIN",
      thread: ts(600),
      text: "オーナーから答えが来ました。\n加湿器は置いていい。ただし床置きはだめ。(11/8 デモオーナーの回答)",
    });
    // 確認中に同じことを聞いていたはるとにも返る(オーナーには一度しか聞いていない)
    expect(posted[1]).toMatchObject({ channel: "D_DEMO_HARUTO", thread: ts(900), text: posted[0]!.text });
    expect(posted[2]).toMatchObject({ channel: "D_DEMO_OWNER", thread: ownerAsk.ts });
    expect(posted[2]!.text).toBe(
      "みおさんに返し、引き継ぎ帳に残しました。(同じことを聞いていた1人にも返しました)\n判断の答えなので、ルール候補にしました: ルール6「加湿器は机上のみ可」\n店舗ページで承認すると、次から報告・写真の検出と引き継ぎ帳の答えの基準になります。",
    );

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

describe("判断の答えはルール候補になり、承認でだけ有効になる(約束2)", () => {
  const page = async () => (await app.request("/stores/tenjin", {}, proxy.env)).text();
  const post = (path: string) =>
    app.request(path, { method: "POST", body: new URLSearchParams({ store: "tenjin" }), headers: { "content-type": "application/x-www-form-urlencoded" } }, proxy.env);

  it("候補は店舗ページに元の質問と答えを添えて出る。まだ有効ではない", async () => {
    const r = await db().prepare("SELECT id, status, origin, action, activated_at FROM rules WHERE rule_no = 6").first<{ id: string }>();
    expect(r).toMatchObject({ status: "candidate", origin: "knowledge", action: "judgment_basis", activated_at: null });
    const html = await page();
    expect(html).toContain("この答えをルールにしますか");
    expect(html).toContain("ルール6「加湿器は机上のみ可」");
    expect(html).toContain("加湿器って置いていい?(11/7 みおさん)");
    expect(html).toContain("加湿器は置いていい。ただし床置きはだめ。(11/8 デモオーナー)");
  });

  it("承認するとルール一覧に由来つきで並ぶ(面談のルールと同じ一覧)", async () => {
    const r = (await db().prepare("SELECT id FROM rules WHERE rule_no = 6").first<{ id: string }>())!;
    const res = await post(`/rules/${r.id}/approve`);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/stores/tenjin#rules-title");
    expect(await db().prepare("SELECT status FROM rules WHERE id = ?").bind(r.id).first()).toEqual({ status: "active" });

    const html = await page();
    expect(html).not.toContain("この答えをルールにしますか");
    expect(html).toContain("由来: 引き継ぎ帳(11/7 みおさんの質問、11/8 デモオーナーの回答)");
    expect(html).toContain("由来: 立ち上げ面談");

    // 一度決めたものは押し直しても変わらない
    await post(`/rules/${r.id}/reject`);
    expect(await db().prepare("SELECT status FROM rules WHERE id = ?").bind(r.id).first()).toEqual({ status: "active" });
  });

  it("場所・手順の答えはルール候補にしない", async () => {
    const { deps } = fakes([
      [use("search_knowledge", { query: "延長コード" })],
      [use("ask_owner", { kind: "place", why: "場所の質問" })],
    ]);
    const q = await processReportEvent(db(), toReportEvent(dm({ ts: ts(7000), text: "延長コードってどこにある?" }))!, deps);
    if (q.kind !== "question") throw new Error();
    const k = await db().prepare("SELECT owner_ask_ref, owner_ask_channel_ref FROM knowledge WHERE id = ?").bind(q.knowledgeId).first<{ owner_ask_ref: string; owner_ask_channel_ref: string }>();
    const out = await processReportEvent(
      db(),
      toReportEvent({ type: "message", user: "U_DEMO_OWNER", channel: k!.owner_ask_channel_ref, channel_type: "im", ts: ts(7200), thread_ts: k!.owner_ask_ref, text: "ロッカーの下の段" })!,
      fakes([]).deps,
    );
    expect(out).toMatchObject({ kind: "owner_answer", ruleCandidate: null });
  });
});

describe("翌週の清掃報告: 承認したルールに照らして検出し、判断経路にルールと由来を出す(山場)", () => {
  // 11/12(木)19:30 JST
  const thu = (Date.UTC(2026, 10, 12, 10, 30) / 1000).toFixed(6);

  it("写真から床置きの加湿器を拾い、ルール6の原文と元の質問を判断経路に残し、オーナーに知らせる", async () => {
    const { deps, posted, structureInputs, ruleCheckInputs } = fakes(
      [],
      {
        categories: ["cleaning_report"],
        areas: ["tenjin_floor"],
        confidence: 0.9,
        clarify_question: null,
        reply: "おつかれさま。床・デスク、受け付けました。",
        rule_matches: [
          { rule_no: 99, evidence: "知らないルール" },
          { rule_no: 1, evidence: "判断の基準ではないルール" },
        ],
      },
      // 照合は別の呼び出し(11/3 実機で構造化に混ぜると拾えなかった)
      [{ rule_no: 6, violated: true, evidence: "窓際の床に加湿器が置かれている" }],
    );
    const ev = toReportEvent({
      type: "message",
      subtype: "file_share",
      user: "U_DEMO_HARUTO",
      channel: "C_DEMO_TENJIN",
      channel_type: "channel",
      ts: thu,
      text: "床やりました",
      files: [{ id: "F30", mimetype: "image/jpeg", thumb_1024: "https://files.example/z" }],
    })!;
    const out = await processReportEvent(db(), ev, deps);

    // 照合に渡すのは有効な「判断の基準」のルールだけ(面談の通知ルールは渡さない)
    expect(structureInputs[0]!.rules).toEqual([{ no: 6, text: "加湿器は机上のみ可" }]);
    expect(ruleCheckInputs[0]).toMatchObject({ storeName: "サンプル自習室 天神店", rules: [{ no: 6, text: "加湿器は机上のみ可" }] });
    expect(ruleCheckInputs[0]!.images).toHaveLength(1);
    expect(out).toMatchObject({ kind: "report", ruleFindings: [{ ruleNo: 6 }] });

    // スタッフには受付だけ。ルールの話はしない
    expect(posted.find((p) => p.channel === "C_DEMO_TENJIN")!.text).toBe("おつかれさま。床・デスク、受け付けました。");
    const dmToOwner = posted.find((p) => p.channel === "U_DEMO_OWNER")!;
    expect(dmToOwner.text).toContain("ルール6「加湿器は机上のみ可」に当たりそうな様子がありました(11/7 のスタッフの質問から生まれたルール)");

    if (out.kind !== "report") throw new Error();
    const f = await db().prepare("SELECT kind, rule_ids, reasoning_path FROM findings WHERE id = ?").bind(out.ruleFindings[0]!.findingId).first<{ kind: string; rule_ids: string; reasoning_path: string }>();
    expect(f!.kind).toBe("rule_match");
    const path = JSON.parse(f!.reasoning_path) as { step: string; detail: string }[];
    expect(path.map((p) => p.step)).toEqual(["投稿を受け取る", "写真と本文を読む", "ルール6に該当", "ルールの由来", "見えたこと", "対応"]);
    expect(path[0]!.detail).toBe("はるとさんの投稿(送信 11/12 19:30)");
    expect(path[3]!.detail).toBe("引き継ぎ帳: 11/7 みおさんの質問「加湿器って置いていい?」→ 11/8 デモオーナーの回答「加湿器は置いていい。ただし床置きはだめ。」");

    const html = await (await app.request("/stores/tenjin", {}, proxy.env)).text();
    expect(html).toContain("ルールに該当");
    expect(html).toContain("ルール6に該当");
    expect(html).toContain("11/7 みおさんの質問");
  });
});

describe("有効なルールも出典つきの判断として返す(仕様 2章)", () => {
  it("検索にルールが出て、選ぶとルールの原文と由来を返す", async () => {
    const hits = await searchKnowledge(db(), "tenjin", "加湿器 置いていい");
    const rule = hits.find((h) => h.source_type === "rule" && h.rule_no === 6);
    expect(rule).toMatchObject({ answer: "加湿器は机上のみ可", question: "加湿器って置いていい?", answered_by: "デモオーナー" });

    const { deps, posted } = fakes([
      [use("search_knowledge", { query: "加湿器 机" })],
      [use("answer_from_source", { knowledge_id: rule!.id, why: "承認されたルール" })],
    ]);
    const out = await processReportEvent(db(), toReportEvent(dm({ user: "U_DEMO_MIO", channel: "D_DEMO_MIO", ts: ts(86_400 * 7), text: "加湿器って床に置いてもいい?" }))!, deps);
    expect(out).toMatchObject({ kind: "question", decision: "answer" });
    expect(posted[0]!.text).toBe("ルール6「加湿器は机上のみ可」(11/8 デモオーナーの回答から)");
  });

  it("面談のルールは「立ち上げ面談で決めたこと」として返す", async () => {
    const hits = await searchKnowledge(db(), "yakuin", "薬院店 週何回");
    const r5 = hits.find((h) => h.rule_no === 5)!;
    const { deps, posted } = fakes([
      [use("search_knowledge", { query: "薬院店 回数" })],
      [use("answer_from_source", { knowledge_id: r5.id, why: "回数のルール" })],
    ]);
    await processReportEvent(db(), toReportEvent(dm({ user: "U_DEMO_SOTA", channel: "D_DEMO_SOTA", ts: ts(86_400 * 7 + 60), text: "薬院店って週何回行けばいい?" }))!, deps);
    expect(posted[0]!.text).toBe("ルール5「薬院店は週1回の巡回でいい。天神店は週4回」(立ち上げ面談で決めたこと)");
  });
});

describe("DM に写真が来たら、主な店舗の清掃報告として受け付ける(11/3 実機: 空の質問がオーナーに飛んだ)", () => {
  it("写真つきの DM は報告。本文も写真もない DM は何もしない", async () => {
    const { deps, posted, requests, structureInputs } = fakes([], { categories: ["cleaning_report"], areas: ["tenjin_toilet"], confidence: 0.9, clarify_question: null, leftover: [], reply: "おつかれさま。トイレ、受け付けました。" });
    const ev = toReportEvent(dm({ subtype: "file_share", text: "", ts: ts(86_400 * 9), files: [{ id: "F50", mimetype: "image/jpeg", thumb_1024: "https://files.example/dm" }] }))!;
    const out = await processReportEvent(db(), ev, deps);
    expect(out).toMatchObject({ kind: "report", areas: ["tenjin_toilet"], replied: true });
    expect(structureInputs[0]!.storeName).toBe("サンプル自習室 天神店");
    expect(requests).toEqual([]); // 引き継ぎ帳のエージェントは呼ばない
    expect(posted).toEqual([{ channel: "D_DEMO_AOI", text: "おつかれさま。トイレ、受け付けました。", thread: ts(86_400 * 9), ts: expect.any(String) }]);
    expect(posted.find((p) => p.channel === "U_DEMO_OWNER")).toBeUndefined();

    // 本文も写真もない投稿はアダプタの段階で落ちる(PDF だけなど)
    expect(toReportEvent(dm({ subtype: "file_share", text: "", ts: ts(86_400 * 9 + 60), files: [{ id: "F51", mimetype: "application/pdf" }] }))).toBeNull();
  });
});
