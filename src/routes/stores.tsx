import { Hono } from "hono";
import type { Env } from "../env";
import { jstDate } from "../lib/time";
import { recordUsage } from "../lib/usage";
import { claudeRuleStructurer, type RuleStructurer } from "../rules/structure";
import { DRAFTS_QUERY, SENT_DRAFT_QUERY, type DraftRow, type SentRow } from "../views/DraftsSection";
import { FINDINGS_QUERY, type FindingRow } from "../views/FindingsSection";
import { RULES_QUERY, type RuleRow, type StoreOption } from "../views/RulesSection";
import { parseScopeChoice, scopeOf, scopeStatements, scopeStoresSql } from "../rules/scope";
import { SUPPLIES_QUERY, suppliesSince, type SupplyRow } from "../views/SuppliesSection";
import { NotFoundPage, pickView, StoreListPage, StorePage, type BoardRow, type StoreRow } from "../views/StorePage";

export const stores = new Hono<{ Bindings: Env }>();

// ルールの構造化に使う Claude(テストでは差し替える)
export const ruleDeps: { structurer: (apiKey: string) => RuleStructurer } = { structurer: claudeRuleStructurer };

const ID = /^[A-Za-z0-9_-]{1,64}$/;

stores.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT id, name, cleaning_type FROM stores ORDER BY name").all<
    Pick<StoreRow, "id" | "name" | "cleaning_type">
  >();
  return c.html(<StoreListPage stores={results} isDemo={c.env.ENVIRONMENT === "demo"} />);
});

// 店舗ページ。?view= で区画を選ぶ(board | approvals | findings | rules | supplies | demo)。省略時は承認待ちがあれば approvals、なければ board
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

  const { results: rules } = await c.env.DB.prepare(RULES_QUERY).bind(id, id).all<RuleRow>();
  const { results: allStores } = await c.env.DB.prepare("SELECT id, name FROM stores ORDER BY name").all<StoreOption>();
  const { results: findings } = await c.env.DB.prepare(FINDINGS_QUERY).bind(id).all<FindingRow>();
  const { results: drafts } = await c.env.DB.prepare(DRAFTS_QUERY).bind(id).all<DraftRow>();
  const { results: supplies } = await c.env.DB.prepare(SUPPLIES_QUERY).bind(id, suppliesSince()).all<SupplyRow>();
  const owner = await c.env.DB.prepare("SELECT display_name FROM staff WHERE role = 'owner' AND status = 'active' LIMIT 1").first<{ display_name: string }>();
  const isDemo = c.env.ENVIRONMENT === "demo";
  const demoStaff = isDemo
    ? (await c.env.DB.prepare("SELECT id, display_name FROM staff WHERE role = 'staff' AND status = 'active' ORDER BY display_name").all<{ id: string; display_name: string }>()).results
    : [];

  const hasApprovals = drafts.length + rules.filter((r) => r.status === "candidate").length > 0;
  const view = pickView(c.req.query("view"), hasApprovals, isDemo);
  const selected = c.req.query("id");
  const sentId = c.req.query("sent");
  // 承認した直後の「送信済み」の行とトースト(読むだけ。DB は変えない)
  const sent = view === "approvals" && sentId && ID.test(sentId) ? await c.env.DB.prepare(SENT_DRAFT_QUERY).bind(sentId, id).first<SentRow>() : null;

  return c.html(
    <StorePage
      store={store}
      board={board}
      today={today}
      isDemo={isDemo}
      view={view}
      rules={rules}
      findings={findings}
      drafts={drafts}
      supplies={supplies}
      demoStaff={demoStaff}
      ownerName={owner?.display_name ?? null}
      selectedFindingId={selected && ID.test(selected) ? selected : null}
      sent={sent}
      allStores={allStores}
    />,
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
  if (!text || !c.env.ANTHROPIC_API_KEY) return c.redirect(`/stores/${id}?view=rules`, 303);

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
  return c.redirect(`/stores/${id}?view=approvals`, 303);
});

const storeIds = async (db: D1Database) => (await db.prepare("SELECT id FROM stores").all<{ id: string }>()).results.map((s) => s.id);

// ルール候補の承認・却下(承認の一押し)。有効にするのはここだけ(仕様 2章「承認なしに有効にはならない」)
// 承認のときに適用する店を選ぶ(checkbox name="stores"。"all" か店の id)。どの店にもチェックがない承認は受けない
// production ではオーナー画面ごと Cloudflare Access の背後にある
stores.post("/rules/:id/:decision{approve|reject}", async (c) => {
  const id = c.req.param("id");
  const decision = c.req.param("decision");
  const form = await c.req.parseBody({ all: true });
  const store = typeof form.store === "string" && /^[a-z0-9_-]{1,64}$/.test(form.store) ? form.store : null;
  if (!ID.test(id)) return c.html(<NotFoundPage />, 404);
  const back = (view: string) => c.redirect(store ? `/stores/${store}?view=${view}` : "/", 303);

  if (decision === "reject") {
    const res = await c.env.DB.prepare("UPDATE rules SET status = 'inactive' WHERE id = ? AND status = 'candidate'").bind(id).run();
    console.log(JSON.stringify({ rule: id, decision, changed: res.meta.changes ?? 0 }));
    return back("approvals");
  }

  const scope = parseScopeChoice(form.stores, await storeIds(c.env.DB));
  if (!scope) {
    console.log(JSON.stringify({ rule: id, decision, changed: 0, reason: "no_store_selected" }));
    return back("approvals");
  }
  const candidate = await c.env.DB.prepare("SELECT id FROM rules WHERE id = ? AND status = 'candidate'").bind(id).first();
  if (!candidate) return back("approvals");
  await c.env.DB.batch([
    ...scopeStatements(c.env.DB, id, scope),
    c.env.DB.prepare("UPDATE rules SET status = 'active', activated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ? AND status = 'candidate'").bind(id),
  ]);
  console.log(JSON.stringify({ rule: id, decision, changed: 1, scope }));
  // 承認したらルール一覧(有効になったのが見える)
  return back("rules");
});

// 有効なルールの適用する店を、あとから変える(ルール一覧の「適用する店を変える」)。前後を JSON でログに残す
stores.post("/rules/:id/stores", async (c) => {
  const id = c.req.param("id");
  const form = await c.req.parseBody({ all: true });
  const store = typeof form.store === "string" && /^[a-z0-9_-]{1,64}$/.test(form.store) ? form.store : null;
  if (!ID.test(id)) return c.html(<NotFoundPage />, 404);
  const back = () => c.redirect(store ? `/stores/${store}?view=rules` : "/", 303);

  const before = await c.env.DB.prepare(`SELECT store_id, ${scopeStoresSql("r")} AS scope_store_ids FROM rules r WHERE r.id = ? AND r.status = 'active'`)
    .bind(id)
    .first<{ store_id: string | null; scope_store_ids: string | null }>();
  if (!before) return back();
  const scope = parseScopeChoice(form.stores, await storeIds(c.env.DB));
  if (!scope) {
    console.log(JSON.stringify({ rule: id, scope_change: "rejected", reason: "no_store_selected" }));
    return back();
  }
  await c.env.DB.batch(scopeStatements(c.env.DB, id, scope));
  console.log(JSON.stringify({ rule: id, scope_change: "ok", before: scopeOf(before), after: scope }));
  return back();
});
