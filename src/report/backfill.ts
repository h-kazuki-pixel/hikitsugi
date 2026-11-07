// 取り込み直し(使い捨て): 処理されずに捨てられた店舗チャンネルの投稿を、Slack の履歴から取り直していつもの処理に流す
//
// 11/7 7:00 から、実店舗の Slack トークンを入れ替えている間、キューの処理が SLACK_BOT_TOKEN なしで捨てられた
// (src/index.tsx の「未設定のため、報告を処理できません」)。その間の報告を取り込み直すためだけに作った。
// 動かすのは GitHub Actions の backfill-slack(手動のみ)。Worker のキューに backfill のジョブを1つ積むだけで、
// 履歴の取得・判定・記録はここ(キューの中)で行う。
//
// 守ること
// - 判定は元の送信時刻(Slack の ts)で行う。受信時刻(いま)は reports.received_at に記録だけ残る
// - スタッフへのスレッド返事も、オーナーへの DM も送らない(記録だけ)。Slack への投稿は muted() で必ず止める
//   - 送らないので聞き返しは記録されない(問いが届いていないため)。質問は引き継ぎ帳に回さない(ProcessDeps.backfill)
// - 二度流しても1件のまま: すでに記録がある投稿(報告・検出事項・引き継ぎ帳の質問)は Claude に渡す前に飛ばす。
//   報告は processReportEvent の中でも (channel, channel_ref, message_ref) で弾き、D1 の UNIQUE でも守られる
// - 店舗チャンネルだけ(DM や知らないチャンネルは断る)
// - 本文・チャンネル ID・ユーザー ID はログに出さない。返すのは件数だけ

import { toReportEvent } from "../channels/slack";
import type { HistoryFetcher, SlackClient } from "../slack/api";
import { processReportEvent, type ProcessDeps } from "./process";

export type BackfillJob = {
  type: "backfill";
  channel: string; // 店舗チャンネルの Slack ID
  oldest: string; // 取り直す時間帯の始まり(Unix 秒)
  latest: string; // 終わり(Unix 秒)
  // 古いコード(backfill を知らない Worker)に届いても何もしないための殻:
  // 古い consumer は slot = "night" として storeId(「__backfill__」)の店を探し、見つからないので何もせずに終わる
  slot?: "night";
  storeId?: string;
};

export type BackfillSummary = {
  fetched: number; // 時間帯の中の投稿(履歴が返した数)
  not_message: number; // ボット・システムの投稿、本文も写真もない投稿
  thread: number; // スレッドからの転送(聞き返しへの答えなど。取り込み直しでは扱わない)
  already: number; // すでに記録がある(二度目の実行・トークン入れ替え前後に処理済み)
  processed: number; // いつもの処理に流した
  reports: number; // そのうち清掃報告として記録した
  merged: number; // そのうち前の報告に畳み込んだ
  not_report: number; // 報告ではなかった(トラブルは検出事項に残る)
  ignored: number; // 処理の中で弾かれた(運営の投稿など)
  over_limit: number; // 上限を超えて今回は流さなかった(もう一度流せば続きから)
};

// 1回で流す上限(1件ごとに Claude を呼ぶ。キューの処理時間に収める)
export const BACKFILL_MAX_MESSAGES = 50;
// 時間帯の上限(取り違えで大きな範囲を流さない)
export const BACKFILL_MAX_WINDOW_SEC = 3 * 24 * 60 * 60;

// Slack に何も送らないクライアント(写真の取り出しだけ通す)
export function muted(slack: SlackClient): SlackClient {
  return {
    postMessage: async () => ({ ok: false, error: "backfill_muted" }),
    fetchImage: (url) => slack.fetchImage(url),
  };
}

export function validateBackfillJob(job: Pick<BackfillJob, "channel" | "oldest" | "latest">): string | null {
  if (!/^[CG][A-Z0-9_]{2,}$/.test(job.channel)) return "channel_format"; // 公開・非公開チャンネルだけ(DM は D…)
  const oldest = Number(job.oldest);
  const latest = Number(job.latest);
  if (!/^\d+(\.\d+)?$/.test(job.oldest) || !/^\d+(\.\d+)?$/.test(job.latest)) return "time_format";
  if (!(oldest < latest)) return "time_order";
  if (latest - oldest > BACKFILL_MAX_WINDOW_SEC) return "window_too_long";
  return null;
}

export async function runBackfill(
  db: D1Database,
  job: Pick<BackfillJob, "channel" | "oldest" | "latest">,
  deps: ProcessDeps & { history: HistoryFetcher },
): Promise<{ ok: true; summary: BackfillSummary } | { ok: false; reason: string }> {
  const invalid = validateBackfillJob(job);
  if (invalid) return { ok: false, reason: invalid };
  const store = await db.prepare("SELECT id FROM stores WHERE slack_channel_id = ?").bind(job.channel).first<{ id: string }>();
  if (!store) return { ok: false, reason: "unknown_channel" };

  const messages = await deps.history(job.channel, job.oldest, job.latest);
  // 古い順に流す(5分以内の二重送信の畳み込みは、先の送信が記録されている前提)
  messages.sort((a, b) => Number(a.ts ?? 0) - Number(b.ts ?? 0));

  const s: BackfillSummary = { fetched: messages.length, not_message: 0, thread: 0, already: 0, processed: 0, reports: 0, merged: 0, not_report: 0, ignored: 0, over_limit: 0 };
  const quiet: ProcessDeps = { ...deps, slack: muted(deps.slack), backfill: true };

  for (const m of messages) {
    const ev = toReportEvent({ ...m, type: "message", channel: job.channel, channel_type: "channel" });
    if (!ev) {
      s.not_message++;
      continue;
    }
    if (ev.isReplyInThread) {
      s.thread++;
      continue;
    }
    if (await alreadyRecorded(db, store.id, ev.channel, ev.channelRef, ev.messageRef)) {
      s.already++;
      continue;
    }
    if (s.processed >= BACKFILL_MAX_MESSAGES) {
      s.over_limit++;
      continue;
    }
    s.processed++;
    const out = await processReportEvent(db, ev, quiet);
    if (out.kind === "report") {
      s.reports++;
      if (out.mergedInto) s.merged++;
    } else if (out.kind === "not_report") s.not_report++;
    else if (out.kind === "ignored" && out.reason === "duplicate") s.already++;
    else s.ignored++;
  }
  return { ok: true, summary: s };
}

// この投稿から、すでに何か記録されているか(報告の原本・検出事項・引き継ぎ帳の質問)
async function alreadyRecorded(db: D1Database, storeId: string, channel: string, channelRef: string, messageRef: string): Promise<boolean> {
  const hit = await db
    .prepare(
      `SELECT 1 FROM reports WHERE channel = ? AND channel_ref = ? AND message_ref = ?
       UNION ALL
       SELECT 1 FROM findings WHERE store_id = ? AND json_extract(evidence, '$.message_ref') = ?
       UNION ALL
       SELECT 1 FROM knowledge WHERE question_channel_ref = ? AND question_ref = ?
       LIMIT 1`,
    )
    .bind(channel, channelRef, messageRef, storeId, messageRef, channelRef, messageRef)
    .first();
  return !!hit;
}
