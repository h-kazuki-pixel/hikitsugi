// Worker が受け取るバインディングと秘密情報。
// 秘密情報は wrangler secret で入る(GitHub Secrets → ワークフロー)。今日の時点では未設定でもよい。

import type { ReportEvent } from "./channels/report-event";

export type Job =
  | { type: "cron"; slot: "morning" | "night"; scheduledAt: string; storeId?: string } // storeId: デモの手動実行で1店舗だけ回す
  | { type: "report_event"; event: ReportEvent };

export type Env = {
  ENVIRONMENT: "demo" | "production";
  DB: D1Database;
  JOBS: Queue<Job>;
  ANTHROPIC_API_KEY?: string;
  SLACK_SIGNING_SECRET?: string;
  SLACK_BOT_TOKEN?: string;
  ENTRY_WEBHOOK_SECRET?: string;
  // production のオーナー画面を守る Cloudflare Access の設定(秘密情報と同じ経路で入れる)
  ACCESS_TEAM_DOMAIN?: string; // 例: <チーム名>.cloudflareaccess.com
  ACCESS_AUD?: string; // Access アプリケーションの AUD タグ
};
