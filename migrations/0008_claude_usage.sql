-- 製品の中の Claude 呼び出しの消費(README の数字と、実店舗の毎日の消費を見るため)
-- 本文・写真は入れない。種類・モデル・トークン数・写真の枚数だけ
CREATE TABLE claude_usage (
  id            TEXT PRIMARY KEY,
  at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  kind          TEXT NOT NULL,   -- structure / rule_check / recheck_photo / clarify_answer / handoff_agent / night_check / rule_draft / rule_structure
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  turns         INTEGER NOT NULL DEFAULT 1,  -- ツール使用ループの往復数(エージェント)
  images        INTEGER NOT NULL DEFAULT 0,
  store_id      TEXT
);
CREATE INDEX claude_usage_kind_at ON claude_usage (kind, at);
