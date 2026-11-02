import { Hono } from "hono";
import type { Env } from "../env";
import { jstDate } from "../lib/time";
import { recordUsage } from "../lib/usage";
import { claudeRuleStructurer, type RuleStructurer } from "../rules/structure";
import { DRAFTS_QUERY, type DraftRow } from "../views/DraftsSection";
import { FINDINGS_QUERY, type FindingRow } from "../views/FindingsSection";
import { RULES_QUERY, type RuleRow } from "../views/RulesSection";
import { NotFoundPage, StoreListPage, StorePage, type BoardRow, type StoreRow } from "../views/StorePage";

export const stores = new Hono<{ Bindings: Env }>();

// ルールの構造化に使う Claude(テストでは差し替える)
export const ruleDeps: { structurer: (apiKey: string) => RuleStructurer } = { structurer: claudeRuleStructurer };

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
    `SELECT a.name AS area_name, b.status, b.carried_from_date, b.recheck_note, b.done_basis
       FROM board_items b JOIN areas a ON a.id = b.area_id
      WHERE b.store_id = ? AND b.date = ?
      ORDER BY a.sort_order`,
  )
    .bind(id, today.iso)
    .all<BoardRow>();

  const { results: rules } = await c.env.DB.prepare(RULES_QUERY).bind(id).all<RuleRow>();
  const { results: findings } = await c.env.DB.prepare(FINDINGS_QUERY).bind(id).all<FindingRow>();
  const { results: drafts } = await c.env.DB.prepare(DRAFTS_QUERY).bind(id).all<DraftRow>();
  const isDemo = c.env.ENVIRONMENT === "demo";
  const demoStaff = isDemo
    ? (await c.env.DB.prepare("SELECT id, display_name FROM staff WHERE role = 'staff' AND status = 'active' ORDER BY display_name").all<{ id: string; display_name: string }>()).results
    : [];

  return c.html(
    <StorePage store={store} board={board} today={today} isDemo={isDemo} rules={rules} findings={findings} drafts={drafts} demoStaff={demoStaff} />,
  );
});

// オーナーが自然文でルールを足す → Claude が構造化 → 候補として出す(承認で有効)
stores.post("/stores/:id/rules", async (c) => {
  const id = c.req.param("id");
  if (!/^[a-z0-9_-]{1,64}$/.test(id)) return c.html(<NotFoundPage />, 404);
  const store = await c.env.DB.prepare("SELECT id, name FROM stores WHERE id = ?").bind(id).first<{ id: string; name: string }>();
  if (!store) return c.html(<NotFoundPage />, 404);
  const form = await c.req.parseBody();
  const text = typeof form.text === "string" ? form.text.trim().slice(0, 200) : "";
  if (!text || !c.env.ANTHROPIC_API_KEY) return c.redirect(`/stores/${id}#rules-title`, 303);

  const r = await ruleDeps.structurer(c.env.ANTHROPIC_API_KEY)({ storeName: store.name, text });
  if (r.usage) await recordUsage(c.env.DB, { kind: "rule_structure", ...r.usage, store_id: id });
  const allStores = r.target.scope === "all_stores";
  await c.env.DB.prepare(
    `INSERT INTO rules (id, rule_no, store_id, natural_text, condition, target, action, recipient, urgency, origin, status, reading, unclear)
     VALUES (?, (SELECT coalesce(max(rule_no), 0) + 1 FROM rules), ?, ?, ?, ?, ?, ?, ?, 'owner_ui', 'candidate', ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      allStores ? null : id,
      text,
      JSON.stringify(r.condition),
      JSON.stringify(r.target),
      r.action,
      r.recipient,
      r.urgency,
      r.reading || null,
      r.unclear,
    )
    .run();
  return c.redirect(`/stores/${id}#candidates-title`, 303);
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
