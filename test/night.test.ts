// 夜の突き合わせ(設計書 5-3): エージェントがツールで入室と報告を読み、未報告を見つけ、ルールに照らして声かけ文を下書きする。
// コードの守り(本当に未報告か・下書きのルールか・二重検出)と、承認して送る / 遅れて届いた報告で取り下げる
import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { reasoningNote, runNightCheck } from "../src/agent/night";
import { toReportEvent } from "../src/channels/slack";
import { app } from "../src/index";
import type { ModelCall } from "../src/knowledge/agent";
import { normalizeAnswer } from "../src/report/clarify";
import { processReportEvent } from "../src/report/process";
import { normalize } from "../src/report/structure";
import { draftDeps } from "../src/routes/drafts";
import { demoEnv } from "./helpers";

let proxy: Awaited<ReturnType<typeof demoEnv>>;
beforeAll(async () => {
  proxy = await demoEnv();
});
afterAll(async () => {
  await proxy?.dispose();
});
const db = () => proxy.env.DB;

// JST の時刻 → UTC の ISO
const jst = (date: string, hm: string) => new Date(Date.parse(`${date}T${hm}:00+09:00`)).toISOString();

type Block = Anthropic.ContentBlock;
let n = 0;
const use = (name: string, input: Record<string, unknown> = {}): Block => ({ type: "tool_use", id: `tu_${++n}`, name, input }) as Block;
function scripted(turns: Block[][]) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const call: ModelCall = async (params) => {
    requests.push(structuredClone(params));
    const content = turns.shift();
    if (!content) throw new Error("台本より多く呼ばれた");
    return { id: "m", type: "message", role: "assistant", model: "fake-opus", content, stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 100, output_tokens: 20 } } as unknown as Anthropic.Message;
  };
  return { call, requests };
}

async function entry(id: string, staff: string, unlockedAt: string, store = "tenjin") {
  await db()
    .prepare("INSERT INTO entries (id, store_id, staff_id, unlocked_at, received_at, source) VALUES (?, ?, ?, ?, ?, 'simulated')")
    .bind(id, store, staff, unlockedAt, unlockedAt)
    .run();
}

const D1 = "2026-11-05"; // 木曜
const BODY = "おつかれさま!今日も天神店に来てくれてありがとう。報告がまだ見当たらないので、時間あるときに一言だけもらえると助かります。";

describe("夜の突き合わせ", () => {
  let draftId = "";

  it("報告のない入室だけを、下書きのルールで検出する。間違った呼び出しはコードが断る", async () => {
    await entry("e_aoi", "staff_aoi", jst(D1, "18:00"));
    await entry("e_haruto", "staff_haruto", jst(D1, "18:30"));
    await entry("e_mio", "staff_mio", jst(D1, "20:45"));
    // はるとは入室のあとに報告している
    await db()
      .prepare(
        "INSERT INTO reports (id, store_id, sender_ref, sender_staff_id, sent_at, received_at, channel, channel_ref, message_ref) VALUES ('r_haruto', 'tenjin', 'U_DEMO_HARUTO', 'staff_haruto', ?, ?, 'seed', 'C_DEMO_TENJIN', 'n1')",
      )
      .bind(jst(D1, "19:05"), jst(D1, "19:05"))
      .run();
    await db().prepare("INSERT INTO report_versions (id, report_id, version, areas, basis) VALUES ('rv_haruto', 'r_haruto', 1, '[\"tenjin_toilet\"]', 'seed')").run();

    const model = scripted([
      [use("read_entries"), use("read_reports"), use("read_roster"), use("read_rules")],
      [
        use("draft_nudge", { entry_id: "e_haruto", rule_no: 2, reasoning: "x", body: BODY }),
        use("draft_nudge", { entry_id: "e_mio", rule_no: 2, reasoning: "x", body: BODY }),
        use("draft_nudge", { entry_id: "e_aoi", rule_no: 1, reasoning: "x", body: BODY }),
      ],
      [use("draft_nudge", { entry_id: "e_aoi", rule_no: 2, reasoning: "18:00 に入室して3時間半、報告がない", body: BODY })],
      [use("finish", { summary: "あおいさんの報告が届いていないので、声かけ文を下書きしました" })],
    ]);
    const out = await runNightCheck(
      db(),
      { storeId: "tenjin", storeName: "サンプル自習室 天神店", date: D1, now: jst(D1, "21:30"), toneSample: null },
      { call: model.call, newId: () => `id_${++n}` },
    );

    expect(model.requests[0]!.model).toBe("claude-opus-5-5");
    // 断った理由はツールの結果(is_error)として Claude に返っている
    const rejected = JSON.stringify(model.requests[2]!.messages.at(-1));
    expect(rejected).toContain("はるとさんは 19:05 に報告しています");
    expect(rejected).toContain("入室から45分なので、まだ未報告とはみません");
    expect(rejected).toContain("ルール1は有効な「下書きを作る」ルールではありません");

    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]!.staffId).toBe("staff_aoi");
    expect(out.summary).toContain("あおいさん");
    expect(out.usage).toMatchObject({ turns: 4, input_tokens: 400, output_tokens: 80 });

    const f = await db().prepare("SELECT kind, status, rule_ids, reasoning_path FROM findings WHERE id = ?").bind(out.findings[0]!.findingId).first<{ reasoning_path: string; rule_ids: string }>();
    expect(f).toMatchObject({ kind: "unreported", status: "active", rule_ids: '["rule_2"]' });
    const path = JSON.parse(f!.reasoning_path) as { step: string; detail: string }[];
    expect(path.map((p) => p.step)).toEqual(["入室記録を読む", "報告を読む", "名簿を見る", "ルール一覧を参照", "報告なし", "ルール2に該当", "声かけ文を下書き"]);
    expect(path[4]!.detail).toContain("あおいさん 18:00 に入室 → 210分たっても、そのあとの報告がない");
    expect(path[5]!.detail).toContain("由来: 立ち上げ面談");

    const d = await db().prepare("SELECT id, status, recipient_type, body FROM drafts WHERE finding_id = ?").bind(out.findings[0]!.findingId).first<{ id: string; body: string }>();
    expect(d).toMatchObject({ status: "pending", recipient_type: "staff" });
    expect(d!.body).toBe(`${BODY}\n(デモオーナー)`);
    draftId = d!.id;
  });

  it("同じ入室は二度検出しない", async () => {
    const model = scripted([[use("draft_nudge", { entry_id: "e_aoi", rule_no: 2, reasoning: "x", body: BODY })], [use("finish", { summary: "" })]]);
    const out = await runNightCheck(db(), { storeId: "tenjin", storeName: "天神", date: D1, now: jst(D1, "22:00"), toneSample: null }, { call: model.call, newId: () => `id_${++n}` });
    expect(out.findings).toEqual([]);
    expect(JSON.stringify(model.requests[1]!.messages.at(-1))).toContain("すでに検出済み");
  });

  it("店舗ページに承認待ちの下書きと判断経路が出て、承認すると本人に DM で届く", async () => {
    const html = await (await app.request("/stores/tenjin", {}, proxy.env)).text();
    expect(html).toContain("承認待ちの下書き");
    expect(html).toContain("あおいさんへの声かけ");
    expect(html).toContain("報告が届いていない");
    expect(html).toContain("ルール2に該当");

    const sent: { channel: string; text: string }[] = [];
    draftDeps.slack = () => ({
      async postMessage(channel, text) {
        sent.push({ channel, text });
        return { ok: true, ts: "1.0" };
      },
      async fetchImage() {
        return null;
      },
    });
    const res = await app.request(
      `/drafts/${draftId}/send`,
      { method: "POST", body: new URLSearchParams({ store: "tenjin" }), headers: { "content-type": "application/x-www-form-urlencoded" } },
      { ...proxy.env, SLACK_BOT_TOKEN: "xoxb-test" },
    );
    expect(res.status).toBe(303);
    expect(sent).toEqual([{ channel: "U_DEMO_AOI", text: `${BODY}\n(デモオーナー)` }]);
    expect(await db().prepare("SELECT status, approved_by_staff_id FROM drafts WHERE id = ?").bind(draftId).first()).toEqual({ status: "sent", approved_by_staff_id: "staff_owner" });
  });

  it("遅れて届いた報告で検出を取り下げ、承認前の下書きも消え、取り下げを判断経路に残す", async () => {
    const D2 = "2026-11-06";
    await entry("e_haruto2", "staff_haruto", jst(D2, "17:00"));
    const model = scripted([
      [use("read_entries"), use("read_reports"), use("read_rules")],
      [use("draft_nudge", { entry_id: "e_haruto2", rule_no: 2, reasoning: "報告がない", body: "おつかれさま。報告だけお願いします。" })],
      [use("finish", { summary: "" })],
    ]);
    const out = await runNightCheck(db(), { storeId: "tenjin", storeName: "天神", date: D2, now: jst(D2, "21:30"), toneSample: null }, { call: model.call, newId: () => `id_${++n}` });
    const findingId = out.findings[0]!.findingId;

    // 報告は 19:10 に送られていたが、届いたのは 21:40(Slack の遅れ・キューの再試行)
    const ts = (Date.parse(jst(D2, "19:10")) / 1000).toFixed(6);
    await processReportEvent(db(), toReportEvent({ type: "message", user: "U_DEMO_HARUTO", channel: "C_DEMO_TENJIN", channel_type: "channel", ts, text: "トイレ終わりました" })!, {
      slack: { postMessage: async () => ({ ok: true, ts: "2.0" }), fetchImage: async () => null },
      structure: async (input) => ({ result: normalize({ categories: ["cleaning_report"], areas: ["tenjin_toilet"], reply: "おつかれさま。" }, input.areas.map((a) => a.id)), usage: { model: "t", input_tokens: 1, output_tokens: 1 } }),
      resolve: async (input) => ({ result: normalizeAnswer({}, input.areas.map((a) => a.id)), usage: { model: "t", input_tokens: 1, output_tokens: 1 } }),
      agent: model.call,
      checkRules: async () => ({ result: [], usage: { model: "t", input_tokens: 1, output_tokens: 1 } }),
      draftRule: async () => ({ natural_text: "" }),
    });

    const f = await db().prepare("SELECT status, withdrawn_reason, reasoning_path FROM findings WHERE id = ?").bind(findingId).first<{ status: string; withdrawn_reason: string; reasoning_path: string }>();
    expect(f!.status).toBe("withdrawn");
    expect(f!.withdrawn_reason).toContain("送信 19:10");
    expect((JSON.parse(f!.reasoning_path) as { step: string }[]).at(-1)!.step).toBe("取り下げ");
    expect(await db().prepare("SELECT status FROM drafts WHERE finding_id = ?").bind(findingId).first()).toEqual({ status: "withdrawn" });
  });
});

describe("判断経路に同じことを二度書かない(11/3 実機)", () => {
  it("事実の言い直しは落とし、それ以外の考えは残す", () => {
    expect(reasoningNote("はるとさんは01:23に解錠してから150分たっているのに、それ以降にはるとさんからの報告が1件もないため。", "はると")).toBe("");
    expect(reasoningNote("ほかの店への報告もない。", "はると")).toBe("ほかの店への報告もない。");
    expect(reasoningNote("", "はると")).toBe("");
  });
});

describe("デモの操作(demo 環境だけ)", () => {
  const post = (path: string, body: Record<string, string>) =>
    app.request(path, { method: "POST", body: new URLSearchParams(body), headers: { "content-type": "application/x-www-form-urlencoded" } }, proxy.env);

  it("入室を模擬すると、スタッフの入室が1件 simulated で入る", async () => {
    const res = await post("/demo/stores/yakuin/entry", { staff: "staff_sota", minutes_ago: "150" });
    expect(res.status).toBe(303);
    const e = await db().prepare("SELECT staff_id, source, unlocked_at FROM entries WHERE store_id = 'yakuin' ORDER BY created_at DESC LIMIT 1").first<{ unlocked_at: string }>();
    expect(e).toMatchObject({ staff_id: "staff_sota", source: "simulated" });
    expect(Date.now() - Date.parse(e!.unlocked_at)).toBeGreaterThan(149 * 60_000);
  });

  it("運営の入室は模擬できない。production では動かない(Access の守りか 404 で止まる)", async () => {
    await post("/demo/stores/yakuin/entry", { staff: "staff_owner", minutes_ago: "0" });
    expect(await db().prepare("SELECT count(*) AS n FROM entries WHERE staff_id = 'staff_owner'").first()).toEqual({ n: 0 });
    const res = await app.request("/demo/stores/yakuin/entry", { method: "POST" }, { ...proxy.env, ENVIRONMENT: "production" as const });
    expect([403, 404]).toContain(res.status);
  });

  it("店舗ページにデモの操作が出る", async () => {
    const html = await (await app.request("/stores/tenjin", {}, proxy.env)).text();
    expect(html).toContain("入室を模擬する");
    expect(html).toContain("夜の突き合わせ");
    expect(html).toContain("朝の定時をいま動かす");
    expect(html).toContain('action="/demo/stores/tenjin/morning"');
  });

  it("朝の定時をいま動かすと、キューに積んで店舗ページに戻る。production では動かない", async () => {
    const res = await post("/demo/stores/tenjin/morning", {});
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/stores/tenjin#demo-title");
    const prod = await app.request("/demo/stores/tenjin/morning", { method: "POST" }, { ...proxy.env, ENVIRONMENT: "production" as const });
    expect([403, 404]).toContain(prod.status);
  });
});

// 実店舗では入室の照合を動かさない(11/4 決定)。入室が入らないので、毎晩 Claude を呼ぶ意味がない
describe("その日の入室が0件なら、Claude を呼ばずに終える", () => {
  it("model call は0回。判断経路に理由を残す", async () => {
    let calls = 0;
    const call: ModelCall = async () => {
      calls++;
      throw new Error("呼ばれないはず");
    };
    const out = await runNightCheck(db(), { storeId: "yakuin", storeName: "薬院", date: "2027-05-01", now: jst("2027-05-01", "21:30"), toneSample: null }, { call, newId: () => `id_${++n}` });
    expect(calls).toBe(0);
    expect(out.findings).toEqual([]);
    expect(out.usage.turns).toBe(0);
    expect(out.path).toEqual([{ step: "入室記録を読む", detail: "今日の入室は0件。突き合わせるものがないので終える(Claude は呼ばない)" }]);
  });
});
