import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/index";
import { jstDate } from "../src/lib/time";
import { demoEnv } from "./helpers";

let proxy: Awaited<ReturnType<typeof demoEnv>>;
beforeAll(async () => {
  proxy = await demoEnv();
  // 天神店の今日のボードを空にしてから始める。前のテストファイル(夜の突き合わせ・引き継ぎ帳)が固定日や実際の時刻で報告を入れると、
  // その日が「今日」のときだけボードに行が残り、「今日のボードはまだありません」が通らなくなる(11/6 に実際に起きた)。
  // ボードは今の店の状態を映す表で、報告の原本(追記のみ)ではないので消してよい
  await proxy.env.DB.prepare("DELETE FROM board_items WHERE store_id = 'tenjin' AND date = ?").bind(jstDate().iso).run();
});
afterAll(async () => {
  await proxy?.dispose();
});

const get = (path: string) => app.request(path, {}, proxy.env);

describe("GET /stores/:id", () => {
  it("店舗名と空の今日のボードを、スマホ向けの日本語ページで返す", async () => {
    const res = await get("/stores/tenjin?view=board");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain('<html lang="ja">');
    expect(html).toContain('name="viewport"');
    expect(html).toContain("サンプル自習室 天神店");
    expect(html).toContain("毎日の店");
    expect(html).toContain("今日のボード");
    expect(html).toContain(jstDate().label);
    expect(html).toContain("今日のボードはまだありません");
    expect(html).toContain("デモ環境(架空のデータ)");
    // 区画を分けた枠(25・30): 左のナビに各区画、上のバーにパンくず
    expect(html).toContain('href="/stores/tenjin?view=findings"');
    expect(html).toContain("<b>今日のボード</b>");
  });

  it("週次巡回の店も開ける", async () => {
    const html = await (await get("/stores/yakuin?view=board")).text();
    expect(html).toContain("サンプル自習室 薬院店");
    expect(html).toContain("週次巡回の店");
  });

  it("面談のルール1〜5は全店のルールなので、どちらの店のルール一覧にも出る", async () => {
    for (const store of ["tenjin", "yakuin"]) {
      const html = await (await get(`/stores/${store}?view=rules`)).text();
      for (const no of [1, 2, 3, 4, 5]) expect(html, `${store} のルール${no}`).toContain(`ルール${no}「`);
      expect(html).toContain("ルール5「薬院店は週1回の巡回でいい。天神店は週4回」");
      // 実行まで動くのは「下書きを作る」(2)と「判断の基準にする」だけ。ほかは登録のみと出す(README「限界」)
      expect(html).toContain("登録のみ(まだ実行しない)");
    }
  });

  it("今日のボードに行があれば、箇所と状態を日本語で出す", async () => {
    const today = jstDate().iso;
    await proxy.env.DB.prepare(
      "INSERT INTO board_items (id, store_id, date, area_id, status, done_basis) VALUES ('t_b1', 'tenjin', ?, 'tenjin_toilet', 'pending', NULL), ('t_b2', 'tenjin', ?, 'tenjin_trash', 'carried_over', NULL), ('t_b3', 'tenjin', ?, 'tenjin_drink', 'done', 'staff_word')",
    )
      .bind(today, today, today)
      .run();
    const html = await (await get("/stores/tenjin?view=board")).text();
    expect(html).toMatch(/トイレ<\/span><span class="status pending">未清掃/);
    expect(html).toMatch(/ゴミ置き場<\/span><span class="status carried_over">繰り越し/);
    expect(html).toMatch(/ドリンク周り<\/span><span class="status done">完了(<!-- -->)?\(本人の申告\)/);
    await proxy.env.DB.prepare("DELETE FROM board_items WHERE id IN ('t_b1', 't_b2', 't_b3')").run();
  });

  it("ない店舗は日本語の 404", async () => {
    const res = await get("/stores/nowhere");
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("ページが見つかりません");
    expect((await get("/stores/..%2Fetc")).status).toBe(404);
  });

  it("トップは店舗の一覧", async () => {
    const html = await (await get("/")).text();
    expect(html).toContain('href="/stores/tenjin"');
    expect(html).toContain('href="/stores/yakuin"');
  });
});

describe("jstDate", () => {
  it("UTC 15:00 以降は JST の翌日になる", () => {
    expect(jstDate(new Date("2026-11-02T14:59:00Z")).iso).toBe("2026-11-02");
    expect(jstDate(new Date("2026-11-02T15:00:00Z")).iso).toBe("2026-11-03");
    expect(jstDate(new Date("2026-11-02T15:00:00Z")).label).toBe("11月3日(火)");
  });
});

describe("GET /usage", () => {
  it("種類ごとの回数と1回あたりのトークンを出す(本文は持たない)", async () => {
    await proxy.env.DB.prepare(
      "INSERT INTO claude_usage (id, kind, model, input_tokens, output_tokens, images, truncated) VALUES ('u1', 'structure', 'claude-sonnet-5-5', 1800, 200, 1, 0), ('u2', 'structure', 'claude-sonnet-5-5', 2200, 300, 1, 1), ('u3', 'handoff_agent', 'claude-opus-5-5', 3000, 150, 0, 0)",
    ).run();
    const html = await (await get("/usage")).text();
    expect(html).toContain("報告の構造化(写真・文)");
    expect(html).toMatch(/2回 \/ 1回あたり 入力 2,000・出力 250 トークン(<!-- -->)? \/ 写真 1枚(<!-- -->)? \/ 上限で切れた 1回/);
    expect(html).toContain("引き継ぎ帳");
  });

  it("写真を読む呼び出しは、写真の枚数ごとにも出す(文だけの投稿と混ぜない)", async () => {
    await proxy.env.DB.prepare(
      "INSERT INTO claude_usage (id, kind, model, input_tokens, output_tokens, images, truncated) VALUES ('u4', 'structure', 'claude-sonnet-5-5', 1000, 100, 0, 0), ('u5', 'structure', 'claude-sonnet-5-5', 3500, 400, 2, 0)",
    ).run();
    const html = (await (await get("/usage")).text()).replace(/<!-- -->/g, "");
    expect(html).toContain("写真0枚: 1回 / 1回あたり 入力 1,000・出力 100 トークン");
    expect(html).toContain("写真1枚: 2回 / 1回あたり 入力 2,000・出力 250 トークン");
    expect(html).toContain("写真2枚: 1回 / 1回あたり 入力 3,500・出力 400 トークン");
    expect(html).not.toContain("写真0枚: 1回 / 1回あたり 入力 3,000"); // 引き継ぎ帳(写真を読まない)は枚数ごとに出さない
  });
});

describe("備品切れ(報告から)", () => {
  const db = () => proxy.env.DB;
  const ago = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  beforeAll(async () => {
    // 架空の報告: 1日前に備品切れあり、8日前に備品切れあり(7日より前なので出さない)
    for (const [id, sentAt, supplies] of [
      ["r_sup_new", ago(1), ["架空のトイレットペーパー", "架空の紙コップ"]],
      ["r_sup_old", ago(8), ["架空の古い品目"]],
    ] as const) {
      await db()
        .prepare("INSERT INTO reports (id, store_id, sender_ref, sent_at, received_at, channel, channel_ref, message_ref) VALUES (?, 'yakuin', 'U_DEMO_SOTA', ?, ?, 'seed', 'C_DEMO_YAKUIN', ?)")
        .bind(id, sentAt, sentAt, id)
        .run();
      await db()
        .prepare("INSERT INTO report_versions (id, report_id, version, performer_staff_id, supplies_out, basis) VALUES (?, ?, 1, 'staff_sota', ?, 'structuring')")
        .bind(`${id}_v1`, id, JSON.stringify(supplies))
        .run();
    }
  });

  it("直近7日の報告の備品切れを、品目と報告した人で並べる。通知はしないと書く", async () => {
    const html = await (await app.request("/stores/yakuin?view=supplies", {}, proxy.env)).text();
    expect(html).toContain("備品切れ(報告から)");
    expect(html).toContain("架空のトイレットペーパー、架空の紙コップ");
    expect(html).toContain("そうたさんの報告");
    expect(html).not.toContain("架空の古い品目");
    expect(html).toContain("発注はこれまでどおり発注リクエストフォームから");
  });

  it("なければ、ないと出す", async () => {
    const html = await (await app.request("/stores/tenjin?view=supplies", {}, proxy.env)).text();
    expect(html).toContain("備品切れ(報告から)");
  });
});
