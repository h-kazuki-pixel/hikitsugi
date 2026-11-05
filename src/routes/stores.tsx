import { Hono } from "hono";
import type { Env } from "../env";
import { jstDate } from "../lib/time";
import { recordUsage } from "../lib/usage";
import { claudeRuleStructurer, type RuleStructurer } from "../rules/structure";
import { DRAFTS_QUERY, SENT_DRAFT_QUERY, type DraftRow, type SentRow } from "../views/DraftsSection";
import { FINDINGS_QUERY, type FindingRow } from "../views/FindingsSection";
import { RULES_QUERY, type RuleRow } from "../views/RulesSection";
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

  const { results: rules } = await c.env.DB.prepare(RULES_QUERY).bind(id).all<RuleRow>();
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

// ルール候補の承認・却下(承認の一押し)。有効にするのはここだけ(仕様 2章「承認なしに有効にはならない」)
// production ではオーナー画面ごと Cloudflare Access の背後にある
stores.post("/rules/:id/:decision{approve|reject}", async (c) => {
  const id = c.req.param("id");
  const decision = c.req.param("decision");
  const form = await c.req.parseBody();
  const store = typeof form.store === "string" && /^[a-z0-9_-]{1,64}$/.test(form.store) ? form.store : null;
  if (!ID.test(id)) return c.html(<NotFoundPage />, 404);

  const res =
    decision === "approve"
      ? await c.env.DB.prepare(
          "UPDATE rules SET status = 'active', activated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ? AND status = 'candidate'",
        )
          .bind(id)
          .run()
      : await c.env.DB.prepare("UPDATE rules SET status = 'inactive' WHERE id = ? AND status = 'candidate'").bind(id).run();
  console.log(JSON.stringify({ rule: id, decision, changed: res.meta.changes ?? 0 }));
  // 承認したらルール一覧(有効になったのが見える)、却下したら承認待ちに戻る
  return c.redirect(store ? `/stores/${store}?view=${decision === "approve" ? "rules" : "approvals"}` : "/", 303);
});
