import { Hono } from "hono";
import type { Env } from "../env";

// 撮影用の操作(demo 環境でだけ動く。日程 11/6「撮影用の機能(時刻を進める・場面の再現)」の最小形)
// - 入室を模擬する: 鍵の解錠の代わりに、スタッフの入室を1件記録する(source = simulated)
// - 夜の突き合わせを今動かす: Cron と同じく、キューに積むだけ
// - 朝の定時を今動かす: 同じくキューに積むだけ(7:00 を待たずに朝の要約を確かめる)
export const demo = new Hono<{ Bindings: Env }>();

demo.use("/demo/*", async (c, next) => {
  if (c.env.ENVIRONMENT !== "demo") return c.text("Not Found", 404);
  await next();
});

const storeOk = (id: string) => /^[a-z0-9_-]{1,64}$/.test(id);

demo.post("/demo/stores/:id/entry", async (c) => {
  const storeId = c.req.param("id");
  if (!storeOk(storeId)) return c.text("Not Found", 404);
  const form = await c.req.parseBody();
  const staffId = typeof form.staff === "string" ? form.staff : "";
  const minutesAgo = Math.min(24 * 60, Math.max(0, Number(form.minutes_ago) || 0));
  const staff = await c.env.DB.prepare("SELECT id FROM staff WHERE id = ? AND role = 'staff' AND status = 'active'").bind(staffId).first();
  const store = await c.env.DB.prepare("SELECT id FROM stores WHERE id = ?").bind(storeId).first();
  if (!staff || !store) return c.redirect(`/stores/${storeId}`, 303);

  const unlockedAt = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  await c.env.DB.prepare(
    "INSERT OR IGNORE INTO entries (id, store_id, staff_id, unlocked_at, received_at, source) VALUES (?, ?, ?, ?, ?, 'simulated')",
  )
    .bind(crypto.randomUUID(), storeId, staffId, unlockedAt, new Date().toISOString())
    .run();
  return c.redirect(`/stores/${storeId}?view=demo`, 303);
});

demo.post("/demo/stores/:id/night", async (c) => {
  const storeId = c.req.param("id");
  if (!storeOk(storeId)) return c.text("Not Found", 404);
  await c.env.JOBS.send({ type: "cron", slot: "night", scheduledAt: new Date().toISOString(), storeId });
  return c.redirect(`/stores/${storeId}?view=approvals`, 303);
});

// 朝の定時を今動かす: 朝の要約は全店で1通(オーナー宛て)なので、店を絞らずに積む。Cron と同じくキューに積むだけ
demo.post("/demo/stores/:id/morning", async (c) => {
  const storeId = c.req.param("id");
  if (!storeOk(storeId)) return c.text("Not Found", 404);
  await c.env.JOBS.send({ type: "cron", slot: "morning", scheduledAt: new Date().toISOString() });
  return c.redirect(`/stores/${storeId}?view=demo`, 303);
});
