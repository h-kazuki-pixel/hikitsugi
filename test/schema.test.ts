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
const run = (sql: string, ...binds: unknown[]) => db().prepare(sql).bind(...binds).run();

describe("seed", () => {
  it("架空の2店舗・清掃箇所6つ・スタッフ4名(+運営2名)・知識10件(回答つき)・ルール5件", async () => {
    const row = await db()
      .prepare(
        `SELECT (SELECT count(*) FROM stores) AS stores, (SELECT count(*) FROM areas) AS areas,
                (SELECT count(*) FROM staff WHERE role = 'staff') AS staff, (SELECT count(*) FROM staff) AS people,
                (SELECT count(*) FROM knowledge WHERE status = 'answered' AND question_ref LIKE 'seed:%') AS knowledge,
                (SELECT count(*) FROM knowledge_answers WHERE answer_ref LIKE 'seed:%') AS answers,
                (SELECT count(*) FROM rules WHERE status = 'active' AND origin = 'interview') AS rules`,
      )
      .first();
    expect(row).toEqual({ stores: 2, areas: 6, staff: 4, people: 6, knowledge: 10, answers: 10, rules: 5 });
    const types = await db().prepare("SELECT id, cleaning_type FROM stores ORDER BY id").all();
    expect(types.results).toEqual([
      { id: "tenjin", cleaning_type: "daily" },
      { id: "yakuin", cleaning_type: "weekly" },
    ]);
  });

  it("報告の義務は運営全体の設定として1行だけ持つ(日曜起算・週4日・5分・120分)", async () => {
    const org = await db()
      .prepare("SELECT week_start, required_days_per_week, areas_per_visit, merge_window_minutes, unreported_after_minutes FROM org_settings")
      .all();
    expect(org.results).toEqual([
      { week_start: 0, required_days_per_week: 4, areas_per_visit: 2, merge_window_minutes: 5, unreported_after_minutes: 120 },
    ]);
    await expect(run("INSERT INTO org_settings (id) VALUES (2)")).rejects.toThrow();
  });

  it("出典の時刻は JST の分まで UTC で入る(9/14 9:05 JST の回答)", async () => {
    const k = await db().prepare("SELECT answer, answered_at FROM knowledge_current WHERE id = 'kn_tenjin_heater'").first();
    expect(k).toEqual({ answer: "25度までは自由に上げていい。それ以上にしたいときは一声かけて。", answered_at: "2026-09-14T00:05:00Z" });
  });

  it("オーナー・副担当は報告義務の対象にできない", async () => {
    await expect(run("UPDATE staff SET is_obligated = 1 WHERE id = 'staff_owner'")).rejects.toThrow();
  });
});

describe("報告: 原本は追記のみ、構造化は版を積む", () => {
  const insertReport = (id: string, text: string) =>
    run(
      `INSERT INTO reports (id, store_id, sender_ref, sender_staff_id, sent_at, received_at, raw_text, channel, channel_ref, message_ref)
       VALUES (?, 'tenjin', 'U_DEMO_AOI', 'staff_aoi', '2026-11-04T09:25:00Z', '2026-11-04T09:25:02Z', ?, 'slack', 'C_DEMO_TENJIN', ?)`,
      id,
      text,
      `ts_${id}`,
    );
  const insertVersion = (reportId: string, version: number, supplies: string[], basis: string) =>
    run(
      `INSERT INTO report_versions (id, report_id, version, performer_staff_id, areas, supplies_out, basis)
       VALUES (?, ?, ?, 'staff_aoi', '["tenjin_toilet","tenjin_trash"]', ?, ?)`,
      `${reportId}_v${version}`,
      reportId,
      version,
      JSON.stringify(supplies),
      basis,
    );

  it("原本の中身の上書きと削除はできない", async () => {
    await insertReport("r_overwrite", "トイレ終わりました");
    await expect(run("UPDATE reports SET raw_text = '書き換え' WHERE id = 'r_overwrite'")).rejects.toThrow(/追記のみ/);
    await expect(run("UPDATE reports SET sent_at = '2026-11-05T00:00:00Z' WHERE id = 'r_overwrite'")).rejects.toThrow(/追記のみ/);
    await expect(run("DELETE FROM reports WHERE id = 'r_overwrite'")).rejects.toThrow(/追記のみ/);
  });

  it("聞き返しで確定した備品切れは版2として積み、今の姿は版2になる(版1も残る)", async () => {
    await insertReport("r_paper", "トイレとゴミ終わりました(写真)");
    await insertVersion("r_paper", 1, [], "structuring");
    // 「トイレットペーパーが残り1つに見えますが、合ってますか?」→「合ってます」
    await insertVersion("r_paper", 2, ["トイレットペーパー"], "staff_reply");
    const cur = await db().prepare("SELECT version, supplies_out, raw_text FROM reports_current WHERE id = 'r_paper'").first();
    expect(cur).toEqual({ version: 2, supplies_out: '["トイレットペーパー"]', raw_text: "トイレとゴミ終わりました(写真)" });
    const n = await db().prepare("SELECT count(*) AS n FROM report_versions WHERE report_id = 'r_paper'").first();
    expect(n).toEqual({ n: 2 });
    await expect(run("UPDATE report_versions SET supplies_out = '[]' WHERE id = 'r_paper_v1'")).rejects.toThrow(/追記のみ/);
    await expect(run("DELETE FROM report_versions WHERE id = 'r_paper_v2'")).rejects.toThrow(/追記のみ/);
    await expect(insertVersion("r_paper", 2, [], "owner_fix")).rejects.toThrow(); // 同じ版番号は積めない
  });

  it("二重送信の畳み込みは、元を残して参照で一度だけ結べる", async () => {
    await insertReport("r_first", "トイレとゴミ");
    await insertReport("r_second", "トイレとゴミ(送り直し)");
    await run("UPDATE reports SET merged_into_report_id = 'r_first' WHERE id = 'r_second'");
    await expect(run("UPDATE reports SET merged_into_report_id = NULL WHERE id = 'r_second'")).rejects.toThrow(/追記のみ/);
    const n = await db().prepare("SELECT count(*) AS n FROM reports WHERE id IN ('r_first', 'r_second')").first();
    expect(n).toEqual({ n: 2 });
  });

  it("Slack の ts はチャンネルの中でだけ一意として扱う", async () => {
    const insert = (id: string, channelRef: string) =>
      run(
        `INSERT INTO reports (id, store_id, sender_ref, sent_at, received_at, channel, channel_ref, message_ref)
         VALUES (?, 'tenjin', 'U_DEMO_MIO', '2026-11-04T10:00:00Z', '2026-11-04T10:00:01Z', 'slack', ?, '1762250400.000100')`,
        id,
        channelRef,
      );
    await insert("r_ts_a", "C_DEMO_TENJIN");
    await insert("r_ts_b", "C_DEMO_YAKUIN"); // 別のチャンネルなら同じ ts でもよい
    await expect(insert("r_ts_c", "C_DEMO_TENJIN")).rejects.toThrow(); // 同じチャンネルの同じ ts は Slack の再送
  });
});

describe("引き継ぎ帳: 回答は追記のみ、出典は必須", () => {
  it("回答がないのに回答済みにはできない", async () => {
    await expect(
      run("INSERT INTO knowledge (id, question, asked_at, status) VALUES ('k_x', '席に財布が置きっぱなしだけど、どうすればいい?', '2026-11-07T03:00:00Z', 'answered')"),
    ).rejects.toThrow(/出典/);
    await run("INSERT INTO knowledge (id, question, asked_at) VALUES ('k_humid', '席に財布が置きっぱなしだけど、どうすればいい?', '2026-11-07T03:00:00Z')");
    await expect(run("UPDATE knowledge SET status = 'answered' WHERE id = 'k_humid'")).rejects.toThrow(/出典/);
  });

  it("出典(誰が・いつ)のない回答は積めない", async () => {
    await expect(run("INSERT INTO knowledge_answers (id, knowledge_id, answer) VALUES ('ka_x', 'k_humid', '置いていい')")).rejects.toThrow();
  });

  it("回答を積むと回答済みになり、答えが変わっても前の回答と出典は残る", async () => {
    await run(
      "INSERT INTO knowledge_answers (id, knowledge_id, answer, answered_by_staff_id, answered_at) VALUES ('ka_h1', 'k_humid', '置いていい。ただし床置きはだめ。', 'staff_owner', '2026-11-08T11:00:00Z')",
    );
    expect(await db().prepare("SELECT status FROM knowledge WHERE id = 'k_humid'").first()).toEqual({ status: "answered" });
    await expect(run("UPDATE knowledge_answers SET answer = '書き換え' WHERE id = 'ka_h1'")).rejects.toThrow(/追記のみ/);
    await expect(run("DELETE FROM knowledge_answers WHERE id = 'ka_h1'")).rejects.toThrow(/追記のみ/);
    await run(
      "INSERT INTO knowledge_answers (id, knowledge_id, answer, answered_by_staff_id, answered_at, replaces_answer_id) VALUES ('ka_h2', 'k_humid', '机の上なら置いていい。', 'staff_owner', '2026-11-15T11:00:00Z', 'ka_h1')",
    );
    const cur = await db().prepare("SELECT answer, answered_at FROM knowledge_current WHERE id = 'k_humid'").first();
    expect(cur).toEqual({ answer: "机の上なら置いていい。", answered_at: "2026-11-15T11:00:00Z" });
    // 流し直し: 11/10 時点の知識は ka_h1
    const asOf = await db()
      .prepare("SELECT answer FROM knowledge_answers WHERE knowledge_id = 'k_humid' AND answered_at <= ? ORDER BY answered_at DESC LIMIT 1")
      .bind("2026-11-10T00:00:00Z")
      .first();
    expect(asOf).toEqual({ answer: "置いていい。ただし床置きはだめ。" });
  });

  it("引き継ぎ帳から生まれるルールは、元の質問と回答を指す", async () => {
    await expect(
      run("INSERT INTO rules (id, rule_no, natural_text, action, origin, status) VALUES ('rule_x', 99, '忘れ物は貴重品なら16番ロッカー、ほかは忘れ物BOX', 'judgment_basis', 'knowledge', 'candidate')"),
    ).rejects.toThrow();
    await run(
      "INSERT INTO rules (id, rule_no, natural_text, action, origin, origin_knowledge_id, origin_answer_id, status) VALUES ('rule_6', 106, '忘れ物は貴重品なら16番ロッカー、ほかは忘れ物BOX', 'judgment_basis', 'knowledge', 'k_humid', 'ka_h1', 'candidate')",
    );
  });
});

describe("その他の約束", () => {
  it("スタッフ以外の解錠は entries に入らない(staff_id は必須)", async () => {
    await expect(
      run("INSERT INTO entries (id, store_id, staff_id, unlocked_at, received_at, source) VALUES ('e_x', 'tenjin', NULL, '2026-11-04T08:40:00Z', '2026-11-04T08:40:01Z', 'webhook')"),
    ).rejects.toThrow();
  });

  it("スタッフ宛ての下書きは承認者なしに送信済みにならない。運営宛ての通知は承認なしでよい", async () => {
    await expect(
      run("INSERT INTO drafts (id, store_id, recipient_type, recipient_staff_id, body, status) VALUES ('d_staff', 'yakuin', 'staff', 'staff_sota', '本文', 'sent')"),
    ).rejects.toThrow();
    await run("INSERT INTO drafts (id, store_id, recipient_type, recipient_staff_id, body, status) VALUES ('d_owner', 'yakuin', 'owner', 'staff_owner', 'トラブルの報告がありました', 'sent')");
  });
});
