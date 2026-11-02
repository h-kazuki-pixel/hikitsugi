// Worker が受け取るバインディングと秘密情報。
// 秘密情報は wrangler secret で入る(GitHub Secrets → ワークフロー)。今日の時点では未設定でもよい。

export type Job =
  | { type: "cron"; slot: "morning" | "night"; scheduledAt: string };

export type Env = {
  ENVIRONMENT: "demo" | "production";
  DB: D1Database;
  JOBS: Queue<Job>;
  ANTHROPIC_API_KEY?: string;
  SLACK_SIGNING_SECRET?: string;
  SLACK_BOT_TOKEN?: string;
  ENTRY_WEBHOOK_SECRET?: string;
};
