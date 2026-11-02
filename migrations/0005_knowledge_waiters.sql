-- オーナー確認中の質問を、あとから同じように聞いた人(設計書 5-5「オーナーに一度だけ聞く」)
-- オーナーには二度聞かないが、答えが来たら、待っていた人のスレッドにも返す。追記のみ
CREATE TABLE knowledge_waiters (
  id            TEXT PRIMARY KEY,
  knowledge_id  TEXT NOT NULL REFERENCES knowledge(id),
  staff_id      TEXT REFERENCES staff(id),
  channel_ref   TEXT NOT NULL,   -- 質問が来た場所
  message_ref   TEXT NOT NULL,   -- 質問のメッセージ(返事はこのスレッドに)
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (channel_ref, message_ref)
);
