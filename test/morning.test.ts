// 朝の定時: 前日の未清掃(毎日の箇所)を繰り越し、オーナーに朝の要約を送る(承認なし。宛先が運営側)
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMorning } from "../src/agent/morning";
import { app } from "../src/index";
import { markDone } from "../src/report/board";
import { demoEnv } from "./helpers";

let proxy: Awaited<ReturnType<typeof demoEnv>>;
beforeAll(async () => {
  proxy = await demoEnv();
});
afterAll(async () => {
  await proxy?.dispose();
});
const db = () => proxy.env.DB;

describe("朝の繰り越し", () => {
  beforeAll(async () => {
    await db()
      .prepare(
        "INSERT INTO reports (id, store_id, sender_ref, sent_at, received_at, channel, channel_ref, message_ref) VALUES ('r_m', 'tenjin', 'U_DEMO_AOI', '2026-12-01T09:00:00Z', '2026-12-01T09:00:00Z', 'seed', 'C_DEMO_TENJIN', 'm1')",
      )
      .run();
  });

  it("前日に終わらなかった毎日の箇所を繰り越し、いつからかを残す。週2回の箇所は繰り越さない", async () => {
    // 動かし始めた日は前日のボードがないので、何も繰り越さない
    const sent: { channel: string; text: string }[] = [];
    const slack = {
      postMessage: async (channel: string, text: string) => (sent.push({ channel, text }), { ok: true }),
      fetchImage: async () => null,
    };
    // 12/1 にトイレとゴミだけ終わった
    await runMorning(db(), "2026-11-30T22:00:00Z", { slack: null }); // 12/1 07:00 JST
    expect(await db().prepare("SELECT count(*) AS n FROM board_items WHERE store_id = 'tenjin' AND date = '2026-12-01' AND status = 'carried_over'").first()).toEqual({ n: 0 });
    await markDone(db(), "tenjin", "2026-12-01", ["tenjin_toilet", "tenjin_trash"], "r_m");

    const out = await runMorning(db(), "2026-12-01T22:00:00Z", { slack }); // 12/2 07:00 JST
    expect(out.today).toBe("2026-12-02");
    const board = await db().prepare("SELECT area_id, status, carried_from_date FROM board_items WHERE store_id = 'tenjin' AND date = '2026-12-02' ORDER BY area_id").all();
    expect(board.results).toEqual([
      { area_id: "tenjin_drink", status: "carried_over", carried_from_date: "2026-12-01" },
      { area_id: "tenjin_floor", status: "pending", carried_from_date: null },
      { area_id: "tenjin_toilet", status: "pending", carried_from_date: null },
      { area_id: "tenjin_trash", status: "pending", carried_from_date: null },
    ]);
    expect(sent[0]!.channel).toBe("U_DEMO_OWNER");
    expect(sent[0]!.text).toContain("【サンプル自習室 天神店】繰り越し: ドリンク周り(12/1から)");

    // 2日続けて終わらなければ、最初の日からの繰り越しのまま
    await runMorning(db(), "2026-12-02T22:00:00Z", { slack: null });
    const d = await db().prepare("SELECT status, carried_from_date FROM board_items WHERE id = 'tenjin:2026-12-03:tenjin_drink'").first();
    expect(d).toEqual({ status: "carried_over", carried_from_date: "2026-12-01" });

    // 何度動いても同じ
    await runMorning(db(), "2026-12-02T22:05:00Z", { slack: null });
    expect(await db().prepare("SELECT count(*) AS n FROM board_items WHERE store_id = 'tenjin' AND date = '2026-12-03'").first()).toEqual({ n: 4 });
  });

  it("繰り越しは報告で完了になる", async () => {
    await markDone(db(), "tenjin", "2026-12-03", ["tenjin_drink"], "r_m");
    const d = await db().prepare("SELECT status FROM board_items WHERE id = 'tenjin:2026-12-03:tenjin_drink'").first();
    expect(d).toEqual({ status: "done" });
  });
});
