import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/index";
import { jstDate } from "../src/lib/time";
import { demoEnv } from "./helpers";

let proxy: Awaited<ReturnType<typeof demoEnv>>;
beforeAll(async () => {
  proxy = await demoEnv();
});
afterAll(async () => {
  await proxy?.dispose();
});

const get = (path: string) => app.request(path, {}, proxy.env);

describe("GET /stores/:id", () => {
  it("店舗名と空の今日のボードを、スマホ向けの日本語ページで返す", async () => {
    const res = await get("/stores/tenjin");
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
    expect(html).toContain("デモ(架空のデータ)");
  });

  it("週次巡回の店も開ける", async () => {
    const html = await (await get("/stores/yakuin")).text();
    expect(html).toContain("サンプル自習室 薬院店");
    expect(html).toContain("週次巡回の店");
  });

  it("今日のボードに行があれば、箇所と状態を日本語で出す", async () => {
    const today = jstDate().iso;
    await proxy.env.DB.prepare(
      "INSERT INTO board_items (id, store_id, date, area_id, status, done_basis) VALUES ('t_b1', 'tenjin', ?, 'tenjin_toilet', 'pending', NULL), ('t_b2', 'tenjin', ?, 'tenjin_trash', 'carried_over', NULL), ('t_b3', 'tenjin', ?, 'tenjin_drink', 'done', 'staff_word')",
    )
      .bind(today, today, today)
      .run();
    const html = await (await get("/stores/tenjin")).text();
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
