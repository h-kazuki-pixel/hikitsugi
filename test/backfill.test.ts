// 取り込み直し(src/report/backfill.ts): 履歴から取った投稿を、いつもの報告の処理に流す
// - 判定は元の送信時刻(ts)。スレッド返事もオーナーへの DM も送らない。二度流しても1件のまま
// Claude と Slack は差し替える(テストでは外に出ない)。D1 はローカルの seed 入り(架空の薬院店)
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SlackMessageEvent } from "../src/channels/slack";
import { BACKFILL_MAX_WINDOW_SEC, runBackfill } from "../src/report/backfill";
import type { ProcessDeps } from "../src/report/process";
import { normalize, type StructureResult } from "../src/report/structure";
import { slackHistory, type SlackClient } from "../src/slack/api";
import { demoEnv } from "./helpers";

let proxy: Awaited<ReturnType<typeof demoEnv>>;
beforeAll(async () => {
  proxy = await demoEnv();
});
afterAll(async () => {
  await proxy?.dispose();
});
const db = () => proxy.env.DB;

// 2026-10-17(土)7:00 JST = 10/16 22:00 UTC。ほかのテストと日付が重ならないようにする
const T0 = Date.UTC(2026, 9, 16, 22, 0) / 1000;
const at = (min: number) => (T0 + min * 60).toFixed(6);
const iso = (min: number) => new Date((T0 + min * 60) * 1000).toISOString();
const CHANNEL = "C_DEMO_YAKUIN";

const photo = { id: "F_BF1", mimetype: "image/jpeg", thumb_1024: "https://files.example/bf1" };
// conversations.history と同じく新しい順で返す
const HISTORY: SlackMessageEvent[] = [
  { type: "message", user: "U_DEMO_SOTA", text: "ドアノブが壊れてます。トイレ終わりました", ts: at(130) }, // 9:10 報告 + トラブル
  { type: "message", subtype: "thread_broadcast", user: "U_DEMO_SOTA", text: "はい、合ってます", ts: at(50), thread_ts: at(40) }, // スレッドからの転送
  { type: "message", bot_id: "B_DEMO", text: "おつかれさま。受け付けました。", ts: at(45) }, // ボットの投稿
  { type: "message", user: "U_DEMO_SOTA", text: "ゴミも出しました", ts: at(42) }, // 7:42 → 7:40 に畳み込む
  { type: "message", subtype: "file_share", user: "U_DEMO_SOTA", text: "トイレ終わりました", files: [photo], ts: at(40) }, // 7:40
];
const REPORT_TS = [at(40), at(42), at(130)];

function fakes() {
  const posted: { channel: string; text: string; thread?: string }[] = [];
  let structured = 0;
  let historyCalls = 0;
  const slack: SlackClient = {
    async postMessage(channel, text, thread) {
      posted.push({ channel, text, thread });
      return { ok: true, ts: "9.0" };
    },
    async fetchImage() {
      return { base64: "aGVsbG8=", mediaType: "image/jpeg" };
    },
  };
  const deps: ProcessDeps & { history: (c: string, o: string, l: string) => Promise<SlackMessageEvent[]> } = {
    slack,
    history: async (channel, oldest, latest) => {
      historyCalls++;
      expect(channel).toBe(CHANNEL);
      return HISTORY.filter((m) => Number(m.ts) >= Number(oldest) && Number(m.ts) <= Number(latest)).map((m) => ({ ...m }));
    },
    structure: async (input) => {
      structured++;
      const trouble = input.text.includes("壊れ");
      const r: Partial<StructureResult> = {
        categories: trouble ? ["cleaning_report", "request_trouble", "question"] : ["cleaning_report"],
        areas: input.text.includes("ゴミ") ? ["yakuin_trash"] : ["yakuin_toilet"],
        trouble: trouble ? "ドアノブが壊れている" : null,
        confidence: 0.7,
        // 聞き返しがあっても、送らないので記録されない
        clarify_question: "トイレで合ってますか?",
        reply: "おつかれさま。受け付けました。",
      };
      return { result: normalize(r, input.areas.map((a) => a.id)), usage: { model: "test-model", input_tokens: 1, output_tokens: 1 } };
    },
    checkRules: async () => ({ result: [], usage: { model: "t", input_tokens: 1, output_tokens: 1 } }),
    resolve: async () => {
      throw new Error("取り込み直しでは聞き返しの答えを扱わない");
    },
    agent: async () => {
      throw new Error("取り込み直しでは質問を引き継ぎ帳に回さない");
    },
    draftRule: async () => ({ natural_text: "使わない" }),
  };
  return { deps, posted, counts: () => ({ structured, historyCalls }) };
}

const job = { channel: CHANNEL, oldest: at(0), latest: at(180) };

async function rowsFor(tsList: string[]) {
  const { results } = await db()
    .prepare(
      `SELECT id, message_ref, sent_at, received_at, merged_into_report_id FROM reports
        WHERE channel = 'slack' AND channel_ref = ? AND message_ref IN (${tsList.map(() => "?").join(", ")}) ORDER BY sent_at`,
    )
    .bind(CHANNEL, ...tsList)
    .all<{ id: string; message_ref: string; sent_at: string; received_at: string; merged_into_report_id: string | null }>();
  return results;
}

describe("取り込み直し", () => {
  it("履歴の報告を送信時刻で記録し、Slack には何も送らない", async () => {
    // 夜の突き合わせが、7:30 の入室に「報告なし」を出していた(報告が捨てられていたため)
    await db().batch([
      db()
        .prepare(
          `INSERT INTO findings (id, store_id, detected_at, kind, target_staff_id, evidence, rule_ids, reasoning_path)
           VALUES ('f_bf_unreported', 'yakuin', ?, 'unreported', 'staff_sota', ?, '["rule_2"]', '[]')`,
        )
        .bind(iso(14 * 60 + 30), JSON.stringify({ unlocked_at: iso(30) })),
      db()
        .prepare("INSERT INTO drafts (id, store_id, finding_id, recipient_type, recipient_staff_id, body) VALUES ('d_bf_unreported', 'yakuin', 'f_bf_unreported', 'staff', 'staff_sota', '下書き')"),
    ]);

    const { deps, posted, counts } = fakes();
    const out = await runBackfill(db(), job, deps);
    expect(out).toEqual({
      ok: true,
      summary: { fetched: 5, not_message: 1, thread: 1, already: 0, processed: 3, reports: 3, merged: 1, not_report: 0, ignored: 0, over_limit: 0 },
    });
    expect(counts().structured).toBe(3);

    // スレッド返事もオーナーへの DM(トラブルの通知)も送らない
    expect(posted).toEqual([]);

    // 判定は元の送信時刻: sent_at は ts から。受信時刻は記録だけ
    const rows = await rowsFor(REPORT_TS);
    expect(rows.map((r) => r.sent_at)).toEqual([iso(40), iso(42), iso(130)]);
    for (const r of rows) expect(r.received_at > r.sent_at).toBe(true);
    // 7:42 は 7:40 に畳み込む(元の送信も残す)
    expect(rows[1]!.merged_into_report_id).toBe(rows[0]!.id);
    expect(rows[2]!.merged_into_report_id).toBeNull();

    // ボードの日付は送信時刻の JST(10/17)
    const { results: board } = await db()
      .prepare("SELECT area_id, status, done_report_id FROM board_items WHERE store_id = 'yakuin' AND date = '2026-10-17' ORDER BY area_id")
      .all<{ area_id: string; status: string; done_report_id: string }>();
    expect(board).toEqual([
      { area_id: "yakuin_toilet", status: "done", done_report_id: expect.any(String) },
      { area_id: "yakuin_trash", status: "done", done_report_id: rows[0]!.id },
    ]);

    // 聞き返しは送っていないので記録しない
    const clar = await db()
      .prepare(`SELECT COUNT(*) AS n FROM clarifications WHERE report_id IN (${rows.map(() => "?").join(", ")})`)
      .bind(...rows.map((r) => r.id))
      .first<{ n: number }>();
    expect(clar?.n).toBe(0);

    // トラブルは検出事項に残る(オーナーは画面で見る)。質問は引き継ぎ帳に回さない
    const trouble = await db()
      .prepare("SELECT COUNT(*) AS n FROM findings WHERE store_id = 'yakuin' AND kind = 'trouble' AND json_extract(evidence, '$.message_ref') = ?")
      .bind(at(130))
      .first<{ n: number }>();
    expect(trouble?.n).toBe(1);
    const knowledge = await db().prepare("SELECT COUNT(*) AS n FROM knowledge WHERE question_ref = ?").bind(at(130)).first<{ n: number }>();
    expect(knowledge?.n).toBe(0);

    // 入室(7:30)のあとの送信(7:40)なので「報告なし」を取り下げ、判断経路に残す。承認前の下書きも取り下げ
    const f = await db()
      .prepare("SELECT status, withdrawn_reason, reasoning_path FROM findings WHERE id = 'f_bf_unreported'")
      .first<{ status: string; withdrawn_reason: string; reasoning_path: string }>();
    expect(f?.status).toBe("withdrawn");
    expect(f?.withdrawn_reason).toContain("送信 07:40");
    expect(JSON.parse(f!.reasoning_path)).toEqual([expect.objectContaining({ step: "取り下げ" })]);
    const d = await db().prepare("SELECT status FROM drafts WHERE id = 'd_bf_unreported'").first<{ status: string }>();
    expect(d?.status).toBe("withdrawn");
  });

  it("二度流しても1件のまま(Claude にも渡さない)", async () => {
    const { deps, posted, counts } = fakes();
    const out = await runBackfill(db(), job, deps);
    expect(out).toEqual({
      ok: true,
      summary: { fetched: 5, not_message: 1, thread: 1, already: 3, processed: 0, reports: 0, merged: 0, not_report: 0, ignored: 0, over_limit: 0 },
    });
    expect(counts().structured).toBe(0);
    expect(posted).toEqual([]);

    const rows = await rowsFor(REPORT_TS);
    expect(rows.map((r) => r.message_ref)).toEqual(REPORT_TS);
    const trouble = await db()
      .prepare("SELECT COUNT(*) AS n FROM findings WHERE kind = 'trouble' AND json_extract(evidence, '$.message_ref') = ?")
      .bind(at(130))
      .first<{ n: number }>();
    expect(trouble?.n).toBe(1);
  });

  it("時間帯を広げて流し直しても、記録済みの分は増えない", async () => {
    const { deps } = fakes();
    const out = await runBackfill(db(), { channel: CHANNEL, oldest: at(-60), latest: at(600) }, deps);
    expect(out.ok && out.summary).toMatchObject({ already: 3, processed: 0 });
    expect(await rowsFor(REPORT_TS)).toHaveLength(3);
  });

  it("店舗チャンネル以外・形の違う入力・長すぎる時間帯は断る(履歴も取りに行かない)", async () => {
    const { deps, counts } = fakes();
    expect(await runBackfill(db(), { ...job, channel: "C_DEMO_NOWHERE" }, deps)).toEqual({ ok: false, reason: "unknown_channel" });
    expect(await runBackfill(db(), { ...job, channel: "D_DEMO_DM" }, deps)).toEqual({ ok: false, reason: "channel_format" });
    expect(await runBackfill(db(), { ...job, oldest: "2026-11-07" }, deps)).toEqual({ ok: false, reason: "time_format" });
    expect(await runBackfill(db(), { ...job, oldest: job.latest, latest: job.oldest }, deps)).toEqual({ ok: false, reason: "time_order" });
    expect(await runBackfill(db(), { ...job, latest: (Number(job.oldest) + BACKFILL_MAX_WINDOW_SEC + 1).toString() }, deps)).toEqual({
      ok: false,
      reason: "window_too_long",
    });
    expect(counts().historyCalls).toBe(0);
  });
});

describe("conversations.history", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ページをたどり、混んでいたら待って取り直す", async () => {
    const urls: string[] = [];
    const replies = [
      new Response("", { status: 429, headers: { "retry-after": "2" } }),
      Response.json({ ok: true, messages: [{ ts: "2.0" }], response_metadata: { next_cursor: "next" } }),
      Response.json({ ok: true, messages: [{ ts: "1.0" }], response_metadata: { next_cursor: "" } }),
    ];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      return replies.shift()!;
    });
    const waits: number[] = [];
    const got = await slackHistory("test-token", async (ms) => void waits.push(ms))("C_DEMO_YAKUIN", "1", "3");
    expect(got.map((m) => m.ts)).toEqual(["2.0", "1.0"]);
    expect(waits).toEqual([2000]);
    expect(urls).toHaveLength(3);
    const q = new URL(urls[2]!).searchParams;
    expect(Object.fromEntries(q)).toMatchObject({ channel: "C_DEMO_YAKUIN", oldest: "1", latest: "3", inclusive: "true", cursor: "next" });
  });

  it("失敗はエラーの種類だけを伝える", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ ok: false, error: "not_in_channel" }));
    await expect(slackHistory("test-token")("C_DEMO_YAKUIN", "1", "3")).rejects.toThrow("conversations.history に失敗しました: not_in_channel");
  });
});
