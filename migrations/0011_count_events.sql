-- 実稼働の数字を数えるための記録(設計書 11章「これから残る証拠」)。追記のみ。本文は持たない
--
-- ボードは今の店の状態を映すので、状態を上書きする(要確認 → 完了)。それだと「写真で要確認になって、本人が直した件数」が
-- あとから数えられない。引き継ぎ帳が出典つきで答えたかも、ログにしか残っていなかった。そこで出来事を1行ずつ積む
--   recheck_flagged  … 清掃後の写真に汚れが見えて、箇所が要確認になった
--   recheck_cleared  … 要確認の箇所が完了になった(basis: photo = 写真で確認 / staff_word = 本人の申告 / report = あとの報告)
--   handoff_answered … 引き継ぎ帳が出典つきで答えた
--   handoff_waited   … 同じ質問をオーナーに確認中だったので、重ねて聞かずに待った
--   handoff_asked    … 答えがなかったので、オーナーに一度聞いた
CREATE TABLE count_events (
  id          TEXT PRIMARY KEY,
  at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  kind        TEXT NOT NULL CHECK (kind IN ('recheck_flagged', 'recheck_cleared', 'handoff_answered', 'handoff_waited', 'handoff_asked')),
  store_id    TEXT REFERENCES stores(id),
  board_date  TEXT,                -- 要確認: ボードの日付
  area_id     TEXT,                -- 要確認: 箇所
  basis       TEXT CHECK (basis IS NULL OR basis IN ('photo', 'staff_word', 'report')),
  ref         TEXT                 -- 要確認: 報告の id / 引き継ぎ帳: 知識の id
);
CREATE INDEX count_events_kind_at ON count_events (kind, at);

CREATE TRIGGER count_events_no_update
BEFORE UPDATE ON count_events
BEGIN
  SELECT RAISE(ABORT, 'count_events は追記のみ: 上書きできません');
END;

CREATE TRIGGER count_events_no_delete
BEFORE DELETE ON count_events
BEGIN
  SELECT RAISE(ABORT, 'count_events は追記のみ: 削除できません');
END;
