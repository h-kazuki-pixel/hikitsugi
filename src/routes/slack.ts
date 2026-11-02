import { Hono } from "hono";
import type { Env } from "../env";
import { verifySlackRequest } from "../slack/verify";

// Slack Events API の受け口(設計書 7章、仕様 1-2)
//
// 方針: 署名を確かめたらすぐ 200 を返す(Slack は3秒以内に 200 が返らないと再送する)。
// 受信 → 分類 → 構造化 → スレッド返事 → 畳み込みは次の段階でキューに積んで行う。今は入口だけ。
//
// 初回の設定について: Slack はマニフェストからアプリを作った瞬間に Request URL へ url_verification を送るが、
// Signing Secret はアプリを作ったあとでないと手に入らない。そのため SLACK_SIGNING_SECRET が未設定の間だけは、
// url_verification の challenge を返すことだけを許し、それ以外はすべて断る(challenge を返しても何も漏れない)。
// Secret を登録したあとは、url_verification を含むすべてのリクエストで署名を確かめる。

export const slack = new Hono<{ Bindings: Env }>();

type SlackEnvelope = {
  type?: string;
  challenge?: string;
  event?: { type?: string };
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
    // 次の段階: ここで共通の報告イベントに変換してキューに積む(本文はログに出さない)
    console.log(JSON.stringify({ slack_event: payload.event?.type ?? "unknown", retry: c.req.header("X-Slack-Retry-Num") ?? null }));
    return c.body(null, 200);
  }

  return c.body(null, 200);
});
