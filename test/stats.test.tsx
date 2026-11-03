// 実稼働の数字(設計書 11章): 数えるための記録(追記のみ)から数える。テスト用の店舗は数えない。データはすべて架空
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/index";
import { recordCount } from "../src/lib/counts";
import { ensureBoard, markDone, markNeedsRecheck } from "../src/report/board";
import { loadStats } from "../src/routes/stats";
import { demoEnv } from "./helpers";

let proxy: Awaited<ReturnType<typeof demoEnv>>;
beforeAll(async () => {
  proxy = await demoEnv();
  // ボードの完了は報告を指すので、架空の報告を1件置く(channel = seed なので、報告の件数には入らない)
  await db()
    .prepare("INSERT OR IGNORE INTO reports (id, store_id, sender_ref, sent_at, received_at, channel, channel_ref, message_ref) VALUES ('r_stats', 'tenjin', 'U_DEMO_AOI', '2027-03-01T09:00:00Z', '2027-03-01T09:00:00Z', 'seed', 'C_DEMO_TENJIN', 'm_stats')")
    .run();
});
afterAll(async () => {
  await proxy?.dispose();
});
const db = () => proxy.env.DB;

describe("実稼働の数字", () => {
  it("要確認になった箇所を1件と数え(重ねて汚れが見えても1件)、あとの報告で完了したことを数える", async () => {
    const before = await loadStats(db());
    await ensureBoard(db(), "tenjin", "2027-03-01");
    await markNeedsRecheck(db(), "tenjin", "2027-03-01", [{ area: "tenjin_toilet", what: "架空の紙くず" }], "r_stats");
    await markNeedsRecheck(db(), "tenjin", "2027-03-01", [{ area: "tenjin_toilet", what: "架空の紙くず(まだ)" }], "r_stats");
    let s = await loadStats(db());
    expect(s.recheck.flagged - before.recheck.flagged).toBe(1);
    expect(s.recheck.open - before.recheck.open).toBe(1);
    await markDone(db(), "tenjin", "2027-03-01", ["tenjin_toilet"], "r_stats");
    s = await loadStats(db());
    expect(s.recheck.report - before.recheck.report).toBe(1);
    expect(s.recheck.open - before.recheck.open).toBe(0);
  });

  it("要確認を残したまま完了にする(keepRecheck)ときは、完了と数えない", async () => {
    const before = await loadStats(db());
    await markNeedsRecheck(db(), "tenjin", "2027-03-01", [{ area: "tenjin_trash", what: "架空のゴミ" }], "r_stats");
    await markDone(db(), "tenjin", "2027-03-01", ["tenjin_trash"], "r_stats", { keepRecheck: true });
    const s = await loadStats(db());
    expect(s.recheck.report - before.recheck.report).toBe(0);
    expect(s.recheck.open - before.recheck.open).toBe(1);
  });

  it("引き継ぎ帳の結果を数える。テスト用の店舗の出来事は数えない", async () => {
    // 印を立ててから「前」を取る(ほかのテストが残した薬院店の分が、前後で数え方が変わらないように)
    await db().prepare("UPDATE stores SET accepts_operator_posts = 1 WHERE id = 'yakuin'").run();
    try {
      const before = await loadStats(db());
      await recordCount(db(), { kind: "handoff_answered", store_id: "tenjin", ref: "kn_x" });
      await recordCount(db(), { kind: "handoff_asked", store_id: null, ref: "kn_y" }); // DM の質問(店舗なし)も数える
      await recordCount(db(), { kind: "handoff_answered", store_id: "yakuin", ref: "kn_z" });
      const s = await loadStats(db());
      expect(s.handoff.answered - before.handoff.answered).toBe(1);
      expect(s.handoff.asked - before.handoff.asked).toBe(1);
    } finally {
      await db().prepare("UPDATE stores SET accepts_operator_posts = 0 WHERE id = 'yakuin'").run();
    }
  });

  it("数えるための記録は追記のみ(消せない・書き換えられない)", async () => {
    await expect(db().prepare("DELETE FROM count_events").run()).rejects.toThrow(/追記のみ/);
    await expect(db().prepare("UPDATE count_events SET kind = 'handoff_asked'").run()).rejects.toThrow(/追記のみ/);
  });

  it("GET /stats: 件数だけの日本語ページ", async () => {
    const res = await app.request("/stats", {}, proxy.env);
    expect(res.status).toBe(200);
    const html = await res.text();
    for (const t of ["実稼働の数字", "写真で要確認", "本人が直した(写真で確認)", "出典つきで答えた質問", "入室したのに報告なし", "テスト用の店舗は数えません"]) expect(html).toContain(t);
  });
});
