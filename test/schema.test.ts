// データモデルが docs の約束を DB の段階で守っているか
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { demoEnv } from "./helpers";

let proxy: Awaited<ReturnType<typeof demoEnv>>;
beforeAll(async () => {
  proxy = await demoEnv();
});
afterAll(async () => {
  await proxy?.dispose();
});
const db = () => proxy.env.DB;

describe("seed", () => {
  it("架空の2店舗・清掃箇所6つ・スタッフ4名(+運営2名)・知識10件・ルール5件", async () => {
    const row = await db()
      .prepare(
        `SELECT (SELECT count(*) FROM stores) AS stores, (SELECT count(*) FROM areas) AS areas,
                (SELECT count(*) FROM staff WHERE role = 'staff') AS staff, (SELECT count(*) FROM staff) AS people,
                (SELECT count(*) FROM knowledge) AS knowledge, (SELECT count(*) FROM rules WHERE status = 'active') AS rules`,
      )
      .first();
    expect(row).toEqual({ stores: 2, areas: 6, staff: 4, people: 6, knowledge: 10, rules: 5 });
    const types = await db().prepare("SELECT id, cleaning_type FROM stores ORDER BY id").all();
    expect(types.results).toEqual([
      { id: "tenjin", cleaning_type: "daily" },
      { id: "yakuin", cleaning_type: "weekly" },
    ]);
  });

  it("オーナー・副担当は報告義務の対象外", async () => {
    const r = await db().prepare("SELECT count(*) AS n FROM staff WHERE role <> 'staff' AND is_obligated = 1").first();
    expect(r).toEqual({ n: 0 });
  });
});

describe("報告は追記のみ", () => {
  const insert = (id: string, text: string) =>
    db()
      .prepare(
        `INSERT INTO reports (id, store_id, staff_id, sender_ref, sent_at, received_at, raw_text, channel, message_ref)
         VALUES (?, 'tenjin', 'staff_aoi', 'U_DEMO_AOI', '2026-11-04T09:25:00Z', '2026-11-04T09:25:02Z', ?, 'seed', ?)`,
      )
      .bind(id, text, id)
      .run();

  it("中身の上書きと削除はできない", async () => {
    await insert("r_overwrite", "トイレ終わりました");
    await expect(db().prepare("UPDATE reports SET raw_text = '書き換え' WHERE id = 'r_overwrite'").run()).rejects.toThrow(/追記のみ/);
    await expect(db().prepare("UPDATE reports SET sent_at = '2026-11-05T00:00:00Z' WHERE id = 'r_overwrite'").run()).rejects.toThrow(/追記のみ/);
    await expect(db().prepare("DELETE FROM reports WHERE id = 'r_overwrite'").run()).rejects.toThrow(/追記のみ/);
  });

  it("二重送信の畳み込みは、元を残して参照で一度だけ結べる", async () => {
    await insert("r_first", "トイレとゴミ");
    await insert("r_second", "トイレとゴミ(送り直し)");
    await db().prepare("UPDATE reports SET merged_into_report_id = 'r_first' WHERE id = 'r_second'").run();
    await expect(db().prepare("UPDATE reports SET merged_into_report_id = NULL WHERE id = 'r_second'").run()).rejects.toThrow(/追記のみ/);
    const n = await db().prepare("SELECT count(*) AS n FROM reports WHERE id IN ('r_first', 'r_second')").first();
    expect(n).toEqual({ n: 2 });
  });
});

describe("その他の約束", () => {
  it("スタッフ以外の解錠は entries に入らない(staff_id は必須)", async () => {
    await expect(
      db()
        .prepare("INSERT INTO entries (id, store_id, staff_id, unlocked_at, received_at, source) VALUES ('e_x', 'tenjin', NULL, '2026-11-04T08:40:00Z', '2026-11-04T08:40:01Z', 'webhook')")
        .run(),
    ).rejects.toThrow();
  });

  it("出典のない回答済みの知識は入らない", async () => {
    await expect(
      db()
        .prepare("INSERT INTO knowledge (id, question, answer, asked_at, status) VALUES ('k_x', '加湿器って置いていい?', '置いていい', '2026-11-07T03:00:00Z', 'answered')")
        .run(),
    ).rejects.toThrow();
    // オーナー確認中なら回答なしで入る
    await db()
      .prepare("INSERT INTO knowledge (id, question, asked_at, status) VALUES ('k_pending', '加湿器って置いていい?', '2026-11-07T03:00:00Z', 'pending_owner')")
      .run();
  });

  it("下書きは承認者なしに送信済みにならない", async () => {
    await expect(
      db().prepare("INSERT INTO drafts (id, store_id, recipient_type, body, status) VALUES ('d_x', 'yakuin', 'staff', '本文', 'sent')").run(),
    ).rejects.toThrow();
  });

  it("引き継ぎ帳から生まれるルールは、元の知識を指す", async () => {
    await expect(
      db()
        .prepare("INSERT INTO rules (id, rule_no, natural_text, action, origin, status) VALUES ('rule_x', 99, '加湿器は机上のみ可', 'judgment_basis', 'knowledge', 'candidate')")
        .run(),
    ).rejects.toThrow();
  });
});
