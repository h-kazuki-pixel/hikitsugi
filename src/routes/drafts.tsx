import { Hono } from "hono";
import type { Env } from "../env";
import { slackClient, type SlackClient } from "../slack/api";
import { NotFoundPage } from "../views/StorePage";

// 下書きの承認(設計書 5-4)。スタッフに話しかけるのは、ここでオーナーが押したときだけ
// production ではオーナー画面ごと Cloudflare Access の背後にある
export const drafts = new Hono<{ Bindings: Env }>();

// Slack(テストでは差し替える)
export const draftDeps: { slack: (token: string) => SlackClient } = { slack: slackClient };

// 操作した区画(承認待ち)に戻る。承認して送れたときは &sent=<id> を付け、送信済みの行とトーストを出す(読むだけ)
const back = (store: unknown, sentId?: string) =>
  typeof store === "string" && /^[a-z0-9_-]{1,64}$/.test(store) ? `/stores/${store}?view=approvals${sentId ? `&sent=${sentId}` : ""}` : "/";

drafts.post("/drafts/:id/:decision{send|reject}", async (c) => {
  const id = c.req.param("id");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return c.html(<NotFoundPage />, 404);
  const form = await c.req.parseBody();
  const now = new Date().toISOString();

  const d = await c.env.DB.prepare(
    `SELECT d.id, d.body, d.recipient_type, s.slack_user_id
       FROM drafts d LEFT JOIN staff s ON s.id = d.recipient_staff_id
      WHERE d.id = ? AND d.status = 'pending'`,
  )
    .bind(id)
    .first<{ id: string; body: string; recipient_type: string; slack_user_id: string | null }>();
  if (!d) return c.redirect(back(form.store), 303); // 取り下げ済み・決定済みなら何もしない

  if (c.req.param("decision") === "reject") {
    await c.env.DB.prepare("UPDATE drafts SET status = 'rejected', decided_at = ? WHERE id = ? AND status = 'pending'").bind(now, id).run();
    return c.redirect(back(form.store), 303);
  }

  // 承認者はオーナー(production は Access で守られた画面からしか押せない)
  const owner = await c.env.DB.prepare("SELECT id FROM staff WHERE role = 'owner' AND status = 'active' LIMIT 1").first<{ id: string }>();
  if (!owner || !d.slack_user_id || !c.env.SLACK_BOT_TOKEN) {
    console.error("下書きを送れません: オーナー・宛先の Slack ID・SLACK_BOT_TOKEN のどれかがありません");
    return c.redirect(back(form.store), 303);
  }
  const res = await draftDeps.slack(c.env.SLACK_BOT_TOKEN).postMessage(d.slack_user_id, d.body);
  if (!res.ok) return c.redirect(back(form.store), 303);
  await c.env.DB.prepare(
    "UPDATE drafts SET status = 'sent', decided_at = ?, approved_by_staff_id = ?, sent_at = ? WHERE id = ? AND status = 'pending'",
  )
    .bind(now, owner.id, now, id)
    .run();
  return c.redirect(back(form.store, id), 303);
});
