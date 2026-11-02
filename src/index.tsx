import { Hono } from "hono";
import type { Env, Job } from "./env";
import { accessGuard } from "./middleware/access-guard";
import { slack } from "./routes/slack";
import { stores } from "./routes/stores";
import { NotFoundPage } from "./views/StorePage";

export const app = new Hono<{ Bindings: Env }>();

// production ではオーナー画面を Cloudflare Access の背後に置く(Webhook は除く)。demo では何もしない
app.use("*", accessGuard);
app.route("/", slack);
app.route("/", stores);
app.notFound((c) => c.html(<NotFoundPage />, 404));

// Cron は判断をしない。キューに積むだけ(設計書 7章)
function slotOf(cron: string): "morning" | "night" {
  return cron === "0 22 * * *" ? "morning" : "night";
}

export default {
  fetch: app.fetch,

  async scheduled(event, env) {
    await env.JOBS.send({
      type: "cron",
      slot: slotOf(event.cron),
      scheduledAt: new Date(event.scheduledTime).toISOString(),
    });
  },

  async queue(batch, _env) {
    for (const msg of batch.messages) {
      // 現場エージェントは次の段階で実装する。今は受け取ったことだけ記録して確認応答する
      console.log(JSON.stringify({ job: msg.body, id: msg.id }));
      msg.ack();
    }
  },
} satisfies ExportedHandler<Env, Job>;
