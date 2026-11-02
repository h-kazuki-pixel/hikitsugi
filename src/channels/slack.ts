// Slack アダプタ: Events API の message イベント → 共通の報告イベント(仕様 1-2)
//
// - ボット由来の投稿は弾く(自分の返事を報告として拾わない)
// - 編集・削除・参加などのシステム投稿は弾く。届くのは普通の投稿・写真つき投稿・スレッドからの転送だけ
// - 写真は message の files に入って届く(file_shared イベントは同じ写真の通知なので使わない)
// - 送信時刻は ts から作る(受信時刻では判定しない)

import type { ReportEvent, ReportImage } from "./report-event";

type SlackFile = {
  id?: string;
  mimetype?: string;
  name?: string;
  url_private_download?: string;
  url_private?: string;
  thumb_1024?: string;
  thumb_720?: string;
};

export type SlackMessageEvent = {
  type?: string;
  subtype?: string;
  bot_id?: string;
  user?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  channel?: string;
  channel_type?: string;
  files?: SlackFile[];
};

const ACCEPTED_SUBTYPES = new Set([undefined, "file_share", "thread_broadcast"]);

export function slackTsToIso(ts: string): string {
  const ms = Math.round(Number(ts) * 1000);
  return new Date(ms).toISOString();
}

// 写真は縮小版を優先する(Claude に送る大きさを抑え、判定には十分な解像度)
function toImage(f: SlackFile): ReportImage | null {
  if (!f.id || !f.mimetype?.startsWith("image/")) return null;
  const url = f.thumb_1024 ?? f.thumb_720 ?? f.url_private_download ?? f.url_private;
  if (!url) return null;
  return { id: f.id, url, mimetype: f.mimetype, name: f.name };
}

export function toReportEvent(event: SlackMessageEvent | undefined): ReportEvent | null {
  if (!event || event.type !== "message") return null;
  if (event.bot_id || event.subtype === "bot_message") return null;
  if (!ACCEPTED_SUBTYPES.has(event.subtype)) return null;
  if (!event.user || !event.ts || !event.channel) return null;

  const images = (event.files ?? []).map(toImage).filter((x): x is ReportImage => x !== null);
  const text = (event.text ?? "").trim();
  if (!text && images.length === 0) return null;

  const isReplyInThread = !!event.thread_ts && event.thread_ts !== event.ts;
  return {
    channel: "slack",
    senderRef: event.user,
    text,
    images,
    sentAt: slackTsToIso(event.ts),
    channelRef: event.channel,
    messageRef: event.ts,
    threadRef: event.thread_ts ?? event.ts,
    isReplyInThread,
    isDirect: event.channel_type === "im",
  };
}
