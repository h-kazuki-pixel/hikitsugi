-- ボードに「要確認」を足す(11/3 の実機: 清掃後の写真に紙くずと汚れが写っていたのに「完了」になった)
--
-- 清掃報告は受け取る(原本と版は積む)が、写真に汚れ・ゴミが残っている箇所は「完了」にせず「要確認」で止める。
-- 本人がスレッドで「拾いました」と答えたら(版2)完了にする。SQLite の CHECK は変えられないので作り直す
CREATE TABLE board_items_new (
  id                TEXT PRIMARY KEY,
  store_id          TEXT NOT NULL REFERENCES stores(id),
  date              TEXT NOT NULL,
  area_id           TEXT NOT NULL REFERENCES areas(id),
  status            TEXT NOT NULL CHECK (status IN ('done', 'pending', 'carried_over', 'no_assignee', 'needs_recheck')),  -- 完了 / 未清掃 / 繰り越し / 対応者不在 / 要確認
  carried_from_date TEXT,
  done_report_id    TEXT REFERENCES reports(id),
  recheck_note      TEXT,                           -- 要確認の理由(写真で見えたこと)
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (store_id, date, area_id)
);
INSERT INTO board_items_new (id, store_id, date, area_id, status, carried_from_date, done_report_id, updated_at)
  SELECT id, store_id, date, area_id, status, carried_from_date, done_report_id, updated_at FROM board_items;
DROP TABLE board_items;
ALTER TABLE board_items_new RENAME TO board_items;
