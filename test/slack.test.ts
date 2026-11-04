// Slack Events API の入口: 署名の検証と url_verification
import { describe, expect, it } from "vitest";
import { toReportEvent, type SlackMessageEvent } from "../src/channels/slack";
import { app } from "../src/index";
import { signSlack, verifySlackRequest } from "../src/slack/verify";

const SECRET = "test-signing-secret-for-demo";
const now = () => Math.floor(Date.now() / 1000);

async function post(body: string, opts: { secret?: string | undefined; ts?: number; sign?: boolean; badSig?: boolean } = {}) {
  const env = { ENVIRONMENT: "demo", SLACK_SIGNING_SECRET: "secret" in opts ? opts.secret : SECRET };
  const ts = String(opts.ts ?? now());
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.sign !== false) {
    headers["X-Slack-Request-Timestamp"] = ts;
    headers["X-Slack-Signature"] = opts.badSig ? "v0=" + "0".repeat(64) : await signSlack(SECRET, ts, body);
  }
  return app.request("/slack/events", { method: "POST", headers, body }, env);
}

const challengeBody = JSON.stringify({ type: "url_verification", token: "x", challenge: "challenge-abc" });
const eventBody = JSON.stringify({ type: "event_callback", event: { type: "message", channel: "C_DEMO_TENJIN", text: "トイレ終わりました" } });

describe("署名の検証", () => {
  it("正しい署名なら通る", async () => {
    const ts = String(now());
    const sig = await signSlack(SECRET, ts, eventBody);
    expect(await verifySlackRequest(SECRET, ts, sig, eventBody)).toEqual({ ok: true });
  });

  it("本文が1文字でも違えば弾く", async () => {
    const ts = String(now());
    const sig = await signSlack(SECRET, ts, eventBody);
    expect(await verifySlackRequest(SECRET, ts, sig, eventBody + " ")).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("5分より古いタイムスタンプはリプレイとして弾く", async () => {
    const ts = String(now() - 301);
    const sig = await signSlack(SECRET, ts, eventBody);
    expect(await verifySlackRequest(SECRET, ts, sig, eventBody)).toEqual({ ok: false, reason: "stale" });
  });

  it("ヘッダーがなければ弾く", async () => {
    expect(await verifySlackRequest(SECRET, undefined, undefined, eventBody)).toEqual({ ok: false, reason: "missing_headers" });
  });
});

describe("POST /slack/events", () => {
  it("url_verification に challenge を返す", async () => {
    const res = await post(challengeBody);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ challenge: "challenge-abc" });
  });

  it("署名が違えば url_verification でも 401", async () => {
    expect((await post(challengeBody, { badSig: true })).status).toBe(401);
    expect((await post(challengeBody, { sign: false })).status).toBe(401);
    expect((await post(challengeBody, { ts: now() - 600 })).status).toBe(401);
  });

  it("署名が正しいイベントにはすぐ 200 を返す", async () => {
    const res = await post(eventBody);
    expect(res.status).toBe(200);
  });

  it("スタッフの投稿は共通の報告イベントにしてキューに積む。再送は積まない", async () => {
    const sent: unknown[] = [];
    const body = JSON.stringify({ type: "event_callback", event: { type: "message", user: "U_DEMO_AOI", channel: "C_DEMO_TENJIN", ts: "1761989100.000100", text: "トイレ終わりました" } });
    const ts = String(now());
    const headers = { "content-type": "application/json", "X-Slack-Request-Timestamp": ts, "X-Slack-Signature": await signSlack(SECRET, ts, body) };
    const env = { ENVIRONMENT: "demo", SLACK_SIGNING_SECRET: SECRET, JOBS: { send: async (m: unknown) => void sent.push(m) } };
    expect((await app.request("/slack/events", { method: "POST", headers, body }, env)).status).toBe(200);
    expect(sent).toMatchObject([{ type: "report_event", event: { senderRef: "U_DEMO_AOI", channelRef: "C_DEMO_TENJIN", messageRef: "1761989100.000100" } }]);
    const retry = await app.request("/slack/events", { method: "POST", headers: { ...headers, "X-Slack-Retry-Num": "1" }, body }, env);
    expect(retry.status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it("署名が違うイベントは 401", async () => {
    expect((await post(eventBody, { badSig: true })).status).toBe(401);
  });

  it("Signing Secret が未設定の間は、url_verification にだけ応答し、イベントは 503 で断る", async () => {
    const ok = await post(challengeBody, { secret: undefined, sign: false });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ challenge: "challenge-abc" });
    expect((await post(eventBody, { secret: undefined, sign: false })).status).toBe(503);
  });
});

// 実店舗の店舗チャンネルはプライベートチャンネル。Slack は message.groups で channel_type: "group" として届ける。
// 報告の処理は共通の報告イベントしか見ない(channel_type で分かれるのは DM かどうかだけ)ので、
// 公開チャンネルと同じイベントになれば、受付・聞き返し・写真・引き継ぎ帳・ルール照合はすべて同じ経路を通る
describe("プライベートチャンネル(message.groups)", () => {
  const photo = { id: "F_DEMO_1", mimetype: "image/jpeg", name: "toilet.jpg", thumb_1024: "https://files.slack.com/demo/toilet.jpg" };
  const cases: [string, SlackMessageEvent][] = [
    ["文だけの報告", { type: "message", user: "U_DEMO_AOI", channel: "C_DEMO_TENJIN", ts: "1761989100.000100", text: "トイレ終わりました" }],
    ["写真つきの報告", { type: "message", subtype: "file_share", user: "U_DEMO_AOI", channel: "C_DEMO_TENJIN", ts: "1761989200.000100", text: "", files: [photo] }],
    ["聞き返しへのスレッド返事", { type: "message", user: "U_DEMO_AOI", channel: "C_DEMO_TENJIN", ts: "1761989300.000100", thread_ts: "1761989100.000100", text: "拾いました" }],
    ["店舗チャンネルでの質問", { type: "message", user: "U_DEMO_MIO", channel: "C_DEMO_TENJIN", ts: "1761989400.000100", text: "席に財布が置きっぱなしだけど、どうすればいい?" }],
  ];
  for (const [name, ev] of cases) {
    it(`${name}: 公開チャンネルと同じ報告イベントになる`, () => {
      const pub = toReportEvent({ ...ev, channel_type: "channel" });
      const priv = toReportEvent({ ...ev, channel_type: "group" });
      expect(pub).not.toBeNull();
      expect(priv).toEqual(pub);
      expect(priv!.isDirect).toBe(false);
    });
  }

  // 現行の清掃完了フォームの通知(Notion のオートメーション)が店舗チャンネルに流れる。bot_id つき・subtype なしで届く
  it("現行フォームの通知(Notion のボットの投稿)は報告として拾わない", () => {
    const notion: SlackMessageEvent = {
      type: "message",
      bot_id: "B_DEMO_NOTION",
      channel: "C_DEMO_TENJIN",
      channel_type: "group",
      ts: "1761989600.000100",
      text: ":broom: 清掃完了 / 実施者: 架空のスタッフ / 清掃箇所: トイレ、ゴミ",
    };
    expect(notion.subtype).toBeUndefined();
    expect(toReportEvent(notion)).toBeNull();
  });

  it("ボットの投稿は、プライベートチャンネルでも無視する", () => {
    expect(toReportEvent({ type: "message", bot_id: "B_DEMO", channel: "C_DEMO_TENJIN", channel_type: "group", ts: "1", text: "受け付けました" })).toBeNull();
  });

  it("プライベートチャンネルの投稿も、署名を確かめてキューに積む", async () => {
    const sent: unknown[] = [];
    const body = JSON.stringify({ type: "event_callback", event: { type: "message", channel_type: "group", user: "U_DEMO_AOI", channel: "C_DEMO_TENJIN", ts: "1761989500.000100", text: "ゴミ出しました" } });
    const ts = String(now());
    const headers = { "content-type": "application/json", "X-Slack-Request-Timestamp": ts, "X-Slack-Signature": await signSlack(SECRET, ts, body) };
    const env = { ENVIRONMENT: "demo", SLACK_SIGNING_SECRET: SECRET, JOBS: { send: async (m: unknown) => void sent.push(m) } };
    expect((await app.request("/slack/events", { method: "POST", headers, body }, env)).status).toBe(200);
    expect(sent).toMatchObject([{ type: "report_event", event: { channelRef: "C_DEMO_TENJIN", isDirect: false } }]);
  });
});
