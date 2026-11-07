// Slack Web API の最小のクライアント(chat.postMessage と、写真の取り出し。取り込み直し用に conversations.history)
// トークンはログに出さない。本文もログに出さない

import type { SlackMessageEvent } from "../channels/slack";

export type SlackClient = {
  postMessage(channel: string, text: string, threadTs?: string): Promise<{ ok: boolean; ts?: string; channel?: string; error?: string }>;
  fetchImage(url: string): Promise<{ base64: string; mediaType: string } | null>;
};

const CLAUDE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const MAX_IMAGE_BYTES = 4_500_000; // Claude の上限(5MB)に余裕をもたせる

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

// チャンネルの過去の投稿(conversations.history)。取り込み直しでだけ使う(src/report/backfill.ts)
// oldest / latest は Slack の ts(秒)。両端を含める。スレッドの中の返事は含まれない(スレッドからの転送は含まれる)
export type HistoryFetcher = (channel: string, oldest: string, latest: string) => Promise<SlackMessageEvent[]>;

export function slackHistory(token: string, wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): HistoryFetcher {
  return async (channel, oldest, latest) => {
    const out: SlackMessageEvent[] = [];
    let cursor = "";
    for (let page = 0, limited = 0; page < 20; ) {
      const q = new URLSearchParams({ channel, oldest, latest, inclusive: "true", limit: "100" });
      if (cursor) q.set("cursor", cursor);
      const res = await fetch(`https://slack.com/api/conversations.history?${q}`, { headers: { authorization: `Bearer ${token}` } });
      // 混んでいたら言われた秒数だけ待って同じページを取り直す(3回まで)
      if (res.status === 429 && limited < 3) {
        limited++;
        await wait(Math.min(60, Number(res.headers.get("retry-after")) || 5) * 1000);
        continue;
      }
      const json = (await res.json().catch(() => ({ ok: false, error: `http_${res.status}` }))) as {
        ok: boolean;
        error?: string;
        messages?: SlackMessageEvent[];
        response_metadata?: { next_cursor?: string };
      };
      // エラーの種類だけ出す(チャンネル ID・本文は出さない)
      if (!json.ok) throw new Error(`conversations.history に失敗しました: ${json.error ?? "unknown"}`);
      out.push(...(json.messages ?? []));
      cursor = json.response_metadata?.next_cursor ?? "";
      if (!cursor) break;
      page++;
    }
    return out;
  };
}

export function slackClient(token: string): SlackClient {
  return {
    async postMessage(channel, text, threadTs) {
      const res = await fetch("https://slack.com/api/chat.postMessage", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ channel, text, thread_ts: threadTs, unfurl_links: false, unfurl_media: false }),
      });
      const json = (await res.json()) as { ok: boolean; ts?: string; channel?: string; error?: string };
      if (!json.ok) console.error(`chat.postMessage に失敗しました: ${json.error}`);
      return json;
    },

    async fetchImage(url) {
      const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) {
        console.error(`Slack の写真を取り出せませんでした: HTTP ${res.status}`);
        return null;
      }
      const mediaType = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
      if (!CLAUDE_IMAGE_TYPES.has(mediaType)) {
        // ログインページ(text/html)が返ったときは files:read の権限かボットトークンを疑う
        console.error(`Slack の写真の形式が扱えません: ${mediaType || "不明"}`);
        return null;
      }
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_IMAGE_BYTES) {
        console.error(`Slack の写真が大きすぎます: ${buf.byteLength} bytes`);
        return null;
      }
      return { base64: toBase64(buf), mediaType };
    },
  };
}
