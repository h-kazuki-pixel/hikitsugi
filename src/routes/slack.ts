import { Hono } from "hono";
import type { Env } from "../env";
import { toReportEvent, type SlackMessageEvent } from "../channels/slack";
import { verifySlackRequest } from "../slack/verify";

// Slack Events API の受け口(設計書 7章、仕様 1-2)
//
// 方針: 署名を確かめたらすぐ 200 を返す(Slack は3秒以内に 200 が返らないと再送する)。
// 受信 → 分類 → 構造化 → 畳み込み → ボード更新 → スレッド返事は、共通の報告イベントにしてキューで行う(src/report/process.ts)。
//
// 初回の設定について: Slack はマニフェストからアプリを作った瞬間に Request URL へ url_verification を送るが、
// Signing Secret はアプリを作ったあとでないと手に入らない。そのため SLACK_SIGNING_SECRET が未設定の間だけは、
// url_verification の challenge を返すことだけを許し、それ以外はすべて断る(challenge を返しても何も漏れない)。
// Secret を登録したあとは、url_verification を含むすべてのリクエストで署名を確かめる。

export const slack = new Hono<{ Bindings: Env }>();

type SlackEnvelope = {
  type?: string;
  challenge?: string;
  event?: SlackMessageEvent;
};

function parse(body: string): SlackEnvelope | null {
  try {
    return JSON.parse(body) as SlackEnvelope;
  } catch {
    return null;
  }
}

slack.post("/slack/events", async (c) => {
  const body = await c.req.text();
  const secret = c.env.SLACK_SIGNING_SECRET;

  if (!secret) {
    const payload = parse(body);
    if (payload?.type === "url_verification" && typeof payload.challenge === "string") {
      console.warn("SLACK_SIGNING_SECRET が未設定のため、url_verification にだけ応答しました。Secret を登録してください");
      return c.json({ challenge: payload.challenge });
    }
    console.error("SLACK_SIGNING_SECRET が未設定のため、Slack のイベントを受け付けられません");
    return c.json({ error: "slack_not_configured" }, 503);
  }

  const result = await verifySlackRequest(
    secret,
    c.req.header("X-Slack-Request-Timestamp"),
    c.req.header("X-Slack-Signature"),
    body,
  );
  if (!result.ok) {
    console.warn(`Slack の署名を確かめられませんでした: ${result.reason}`);
    return c.json({ error: "invalid_signature" }, 401);
  }

  const payload = parse(body);
  if (!payload) return c.json({ error: "invalid_json" }, 400);

  if (payload.type === "url_verification") {
    return c.json({ challenge: payload.challenge ?? "" });
  }

  if (payload.type === "event_callback") {
    const retry = c.req.header("X-Slack-Retry-Num") ?? null;
    // Slack の再送は、最初の受信をすでにキューに積んでいるので積まない(重複は処理側でも弾く)
    const event = retry ? null : toReportEvent(payload.event);
    if (event) await c.env.JOBS.send({ type: "report_event", event });
    // 本文はログに出さない
    console.log(JSON.stringify({ slack_event: payload.event?.type ?? "unknown", subtype: payload.event?.subtype ?? null, queued: !!event, retry }));
    return c.body(null, 200);
  }

  return c.body(null, 200);
});
