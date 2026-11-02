import { Hono } from "hono";
import type { Env, Job } from "./env";
import { accessGuard } from "./middleware/access-guard";
import { processReportEvent } from "./report/process";
import Anthropic from "@anthropic-ai/sdk";
import { claudeResolver } from "./report/clarify";
import { claudeRuleDrafter } from "./rules/candidate";
import { runMorning } from "./agent/morning";
import { runNightCheck } from "./agent/night";
import { jstDate } from "./lib/time";
import { claudeStructurer } from "./report/structure";
import { slackClient } from "./slack/api";
import { slack } from "./routes/slack";
import { stores } from "./routes/stores";
import { drafts } from "./routes/drafts";
import { demo } from "./routes/demo";
import { NotFoundPage } from "./views/StorePage";

export const app = new Hono<{ Bindings: Env }>();

// production ではオーナー画面を Cloudflare Access の背後に置く(Webhook は除く)。demo では何もしない
app.use("*", accessGuard);
app.route("/", slack);
app.route("/", stores);
app.route("/", drafts);
app.route("/", demo);
app.notFound((c) => c.html(<NotFoundPage />, 404));

// 引き継ぎ帳のエージェントが使う Claude 呼び出し(テストでは差し替える)
function modelCall(apiKey: string) {
  const client = new Anthropic({ apiKey });
  return (params: Anthropic.MessageCreateParamsNonStreaming) => client.messages.create(params);
}

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
            agent: modelCall(env.ANTHROPIC_API_KEY),
            draftRule: claudeRuleDrafter(env.ANTHROPIC_API_KEY),
            slack: slackClient(env.SLACK_BOT_TOKEN),
          });
          console.log(JSON.stringify({ job: job.type, id: msg.id, outcome }));
        } else if (job.slot === "night") {
          if (!env.ANTHROPIC_API_KEY) {
            console.error("ANTHROPIC_API_KEY が未設定のため、夜の突き合わせを行えません");
            msg.ack();
            continue;
          }
          const { results: storeRows } = await env.DB.prepare(
            "SELECT id, name, tone_sample FROM stores WHERE ? IS NULL OR id = ? ORDER BY id",
          )
            .bind(job.storeId ?? null, job.storeId ?? null)
            .all<{ id: string; name: string; tone_sample: string | null }>();
          for (const st of storeRows) {
            const out = await runNightCheck(
              env.DB,
              { storeId: st.id, storeName: st.name, date: jstDate(new Date(job.scheduledAt)).iso, now: job.scheduledAt, toneSample: st.tone_sample },
              { call: modelCall(env.ANTHROPIC_API_KEY), newId: () => crypto.randomUUID() },
            );
            console.log(JSON.stringify({ claude: "night_check", store: st.id, ...out.usage, findings: out.findings.length, steps: out.path.map((p) => p.step) }));
          }
        } else {
          const out = await runMorning(env.DB, job.scheduledAt, { slack: env.SLACK_BOT_TOKEN ? slackClient(env.SLACK_BOT_TOKEN) : null });
          console.log(JSON.stringify({ job: job.type, slot: job.slot, id: msg.id, stores_with_news: out.lines.length, sent: out.sent }));
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
