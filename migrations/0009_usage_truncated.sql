-- 出力が上限(max_tokens)で切れたか(11/3 実機: 構造化の出力が上限の 1,024 ちょうどで、返事の欄が空になっていた)
ALTER TABLE claude_usage ADD COLUMN truncated INTEGER NOT NULL DEFAULT 0;
