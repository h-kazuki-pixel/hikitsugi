import { Hono } from "hono";
import type { Env, Job } from "./env";
import { accessGuard } from "./middleware/access-guard";
import { processReportEvent } from "./report/process";
import { claudeResolver } from "./report/clarify";
import { claudeStructurer } from "./report/structure";
import { slackClient } from "./slack/api";
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

  async queue(batch, env) {
    for (const msg of batch.messages) {
      const job = msg.body;
      try {
        if (job.type === "report_event") {
          if (!env.ANTHROPIC_API_KEY || !env.SLACK_BOT_TOKEN) {
            console.error("ANTHROPIC_API_KEY か SLACK_BOT_TOKEN が未設定のため、報告を処理できません");
            msg.ack();
            continue;
          }
          const outcome = await processReportEvent(env.DB, job.event, {
            structure: claudeStructurer(env.ANTHROPIC_API_KEY),
            resolve: claudeResolver(env.ANTHROPIC_API_KEY),
            slack: slackClient(env.SLACK_BOT_TOKEN),
          });
          console.log(JSON.stringify({ job: job.type, id: msg.id, outcome }));
        } else {
          // 現場エージェント(定時)は次の段階で実装する
          console.log(JSON.stringify({ job: job.type, id: msg.id }));
        }
        msg.ack();
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        // 同じ失敗を繰り返さない: 3回で諦めて記録に残す(Claude の 400 のような、やり直しても直らない失敗がある)
        if (msg.attempts >= 3) {
          console.error(`ジョブを諦めました(${job.type}、${msg.attempts}回目): ${reason}`);
          msg.ack();
        } else {
          console.error(`ジョブの処理に失敗しました(${job.type}、${msg.attempts}回目): ${reason}`);
          msg.retry({ delaySeconds: 10 });
        }
      }
    }
  },
} satisfies ExportedHandler<Env, Job>;
