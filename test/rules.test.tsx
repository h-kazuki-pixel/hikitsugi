// オーナーが自然文でルールを足す → Claude が構造化 → 読み取りを見て承認 → 有効(仕様 2章)
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/index";
import { ruleDeps } from "../src/routes/stores";
import { normalizeRule } from "../src/rules/structure";
import { demoEnv } from "./helpers";

let proxy: Awaited<ReturnType<typeof demoEnv>>;
beforeAll(async () => {
  proxy = await demoEnv();
});
afterAll(async () => {
  await proxy?.dispose();
});
const env = () => ({ ...proxy.env, ANTHROPIC_API_KEY: "test-key" });
const form = (body: Record<string, string>) => ({
  method: "POST",
  body: new URLSearchParams(body),
  headers: { "content-type": "application/x-www-form-urlencoded" },
});

describe("ルールの構造化の整え方", () => {
  it("知らない動作は「知らせる」、知らせる・下書きで宛先がなければオーナー、緊急度がなければ定時", () => {
    expect(normalizeRule({ action: "send_to_staff" as never, condition: [] as never, reading: " 読み " })).toEqual({
      condition: {},
      target: {},
      action: "notify",
      recipient: "owner",
      urgency: "scheduled",
      reading: "読み",
      unclear: null,
    });
    expect(normalizeRule({ action: "exclude_from_count", recipient: null, urgency: "weekly" })).toMatchObject({ recipient: null, urgency: "weekly" });
  });
});

describe("POST /stores/:id/rules", () => {
  it("自然文はそのまま残し、読み取りと構造を候補として出す。承認するまで有効にならない", async () => {
    const seen: { storeName: string; text: string }[] = [];
    ruleDeps.structurer = () => async (input) => {
      seen.push(input);
      return normalizeRule({
        condition: { area_unreported_days: { area: "トイレ", days_in_a_row: 2 } },
        target: { store: "tenjin", area: "トイレ" },
        action: "notify",
        recipient: "sub",
        urgency: "scheduled",
        reading: "天神店のトイレの報告がない日が2日続いたら、副担当に定時で知らせる",
        unclear: null,
      });
    };
    const res = await app.request("/stores/tenjin/rules", form({ text: "トイレの報告がない日が2日続いたら、副担当に知らせて" }), env());
    expect(res.status).toBe(303);
    expect(seen).toEqual([{ storeName: "サンプル自習室 天神店", text: "トイレの報告がない日が2日続いたら、副担当に知らせて" }]);

    const r = await proxy.env.DB.prepare("SELECT id, store_id, natural_text, action, recipient, urgency, origin, status, condition FROM rules WHERE origin = 'owner_ui'").first<{ id: string }>();
    expect(r).toMatchObject({
      store_id: "tenjin",
      natural_text: "トイレの報告がない日が2日続いたら、副担当に知らせて",
      action: "notify",
      recipient: "sub",
      urgency: "scheduled",
      status: "candidate",
      condition: '{"area_unreported_days":{"area":"トイレ","days_in_a_row":2}}',
    });

    let html = await (await app.request("/stores/tenjin", {}, env())).text();
    expect(html).toContain("この読み取りで有効にしますか");
    expect(html).toContain("天神店のトイレの報告がない日が2日続いたら、副担当に定時で知らせる");
    expect(html).toContain("知らせる / 宛先: 副担当 / 定時");

    await app.request(`/rules/${r!.id}/approve`, form({ store: "tenjin" }), env());
    html = await (await app.request("/stores/tenjin", {}, env())).text();
    expect(html).not.toContain("この読み取りで有効にしますか");
    expect(html).toContain("「トイレの報告がない日が2日続いたら、副担当に知らせて」");
    expect(html).toContain("由来: オーナーが追加");
  });

  it("空の文・知らない店舗は受け付けない", async () => {
    ruleDeps.structurer = () => async () => {
      throw new Error("呼ばれないはず");
    };
    expect((await app.request("/stores/tenjin/rules", form({ text: "  " }), env())).status).toBe(303);
    expect((await app.request("/stores/nowhere/rules", form({ text: "x" }), env())).status).toBe(404);
  });
});
