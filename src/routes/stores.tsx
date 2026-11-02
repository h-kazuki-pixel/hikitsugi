import { Hono } from "hono";
import type { Env } from "../env";
import { jstDate } from "../lib/time";
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

  return c.html(<StorePage store={store} board={board} today={today} isDemo={c.env.ENVIRONMENT === "demo"} />);
});
