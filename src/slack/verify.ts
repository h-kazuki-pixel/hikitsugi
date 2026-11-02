// Slack からのリクエストの署名を確かめる(Signing Secret による HMAC-SHA256)。
// https://api.slack.com/authentication/verifying-requests-from-slack
//
// - 署名の元は `v0:{X-Slack-Request-Timestamp}:{生の本文}`。JSON にパースする前の本文で計算する
// - タイムスタンプが5分より古い(または未来すぎる)ものはリプレイとみなして弾く
// - 比較は長さと中身を一定時間で行う

const MAX_SKEW_SEC = 60 * 5;

export type SlackVerifyResult = { ok: true } | { ok: false; reason: "missing_headers" | "stale" | "bad_signature" };

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function signSlack(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`v0:${timestamp}:${body}`));
  return `v0=${toHex(mac)}`;
}

export async function verifySlackRequest(
  secret: string,
  timestamp: string | undefined,
  signature: string | undefined,
  body: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<SlackVerifyResult> {
  if (!timestamp || !signature) return { ok: false, reason: "missing_headers" };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > MAX_SKEW_SEC) return { ok: false, reason: "stale" };
  const expected = await signSlack(secret, timestamp, body);
  return timingSafeEqual(expected, signature) ? { ok: true } : { ok: false, reason: "bad_signature" };
}
