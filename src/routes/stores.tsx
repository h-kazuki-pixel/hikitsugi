import { Hono } from "hono";
import type { Env } from "../env";
import { jstDate } from "../lib/time";
import { RULES_QUERY, type RuleRow } from "../views/RulesSection";
import { NotFoundPage, StoreListPage, StorePage, type BoardRow, type StoreRow } from "../views/StorePage";

export const stores = new Hono<{ Bindings: Env }>();

stores.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, name, cleaning_type FROM stores ORDER BY name").all<
    Pick<StoreRow, "id" | "name" | "cleaning_type">
  >();
  return c.html(<StoreListPage stores={results} isDemo={c.env.ENVIRONMENT === "demo"} />);
});

stores.get("/stores/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^[a-z0-9_-]{1,64}$/.test(id)) return c.html(<NotFoundPage />, 404);

  const store = await c.env.DB.prepare(
    "SELECT id, name, cleaning_type, opening_hours, closed_days FROM stores WHERE id = ?",
  )
    .bind(id)
    .first<StoreRow>();
  if (!store) return c.html(<NotFoundPage />, 404);

  const today = jstDate();
  const { results: board } = await c.env.DB.prepare(
    `SELECT a.name AS area_name, b.status
       FROM board_items b JOIN areas a ON a.id = b.area_id
      WHERE b.store_id = ? AND b.date = ?
      ORDER BY a.sort_order`,
  )
    .bind(id, today.iso)
    .all<BoardRow>();

  const { results: rules } = await c.env.DB.prepare(RULES_QUERY).bind(id).all<RuleRow>();

  return c.html(<StorePage store={store} board={board} today={today} isDemo={c.env.ENVIRONMENT === "demo"} rules={rules} />);
});

// ルール候補の承認・却下(承認の一押し)。有効にするのはここだけ(仕様 2章「承認なしに有効にはならない」)
// production ではオーナー画面ごと Cloudflare Access の背後にある
stores.post("/rules/:id/:decision{approve|reject}", async (c) => {
  const id = c.req.param("id");
  const decision = c.req.param("decision");
  const form = await c.req.parseBody();
  const store = typeof form.store === "string" && /^[a-z0-9_-]{1,64}$/.test(form.store) ? form.store : null;
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return c.html(<NotFoundPage />, 404);

  const res =
    decision === "approve"
      ? await c.env.DB.prepare(
          "UPDATE rules SET status = 'active', activated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ? AND status = 'candidate'",
        )
          .bind(id)
          .run()
      : await c.env.DB.prepare("UPDATE rules SET status = 'inactive' WHERE id = ? AND status = 'candidate'").bind(id).run();
  console.log(JSON.stringify({ rule: id, decision, changed: res.meta.changes ?? 0 }));
  return c.redirect(store ? `/stores/${store}#rules-title` : "/", 303);
});
