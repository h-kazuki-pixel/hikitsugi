-- 0001_init: 設計書 8章のデータモデル(11テーブル)
--
-- 方針
-- - ID は TEXT(seed で読みやすい固定 ID を使えるように)
-- - 日時は ISO 8601 の TEXT(UTC、末尾 Z)。日付で切るときは JST(仕様 3章「JST で日付を切る」)
-- - 列挙は英語のコードで持ち、画面で日本語にする
-- - 配列・構造は JSON の TEXT
-- - 判定に使う時刻は解錠時刻(entries.unlocked_at)と送信時刻(reports.sent_at)。受信時刻は記録のためだけに持つ

-- 外部キーは D1 が既定で検査する

-- 店舗設定(仕様 1章の7つの塊のうち、店舗に属するもの)
CREATE TABLE stores (
  id                       TEXT PRIMARY KEY,
  -- 塊1 店舗
  name                     TEXT NOT NULL,
  business_type            TEXT NOT NULL DEFAULT '自習室',
  opening_hours            TEXT NOT NULL,                  -- 表示用(例: 24時間 / 7:00-23:00)
  is_unmanned              INTEGER NOT NULL DEFAULT 1 CHECK (is_unmanned IN (0, 1)),
  cleaning_type            TEXT NOT NULL CHECK (cleaning_type IN ('daily', 'weekly')),  -- 毎日の店 / 週次巡回の店
  closed_days              TEXT NOT NULL DEFAULT '{"weekdays":[],"dates":[]}',          -- 休業日カレンダー(JSON)
  closed_day_policy        TEXT,                           -- 休業日の決め方(自然文)
  -- 塊3 スタッフ(報告の義務。人ごとに全店合計で数えるが、設定は店舗ごとに持つ)
  week_start               INTEGER NOT NULL DEFAULT 0 CHECK (week_start BETWEEN 0 AND 6),  -- 0 = 日曜
  required_days_per_week   INTEGER NOT NULL DEFAULT 4,     -- 実施日数で数える
  count_scope              TEXT NOT NULL DEFAULT 'all_stores' CHECK (count_scope IN ('all_stores', 'per_store')),
  areas_per_visit          INTEGER NOT NULL DEFAULT 2,
  attendance_style         TEXT,                           -- 出勤の決め方(シフト / 自由)
  exemption_policy         TEXT,                           -- 免除の制度(試験前など)
  merge_window_minutes     INTEGER NOT NULL DEFAULT 5,     -- 二重送信の畳み込み
  unreported_after_minutes INTEGER NOT NULL DEFAULT 120,   -- 最終入室から何分で未報告とみるか
  -- 塊4 報告の手段
  slack_channel_id         TEXT UNIQUE,                    -- チャンネルが店舗を決める
  photo_required           INTEGER NOT NULL DEFAULT 0 CHECK (photo_required IN (0, 1)),
  -- 塊5 入室記録
  lock_type                TEXT NOT NULL DEFAULT 'none' CHECK (lock_type IN ('remotelock', 'other', 'none')),
  lock_has_staff_ids       INTEGER NOT NULL DEFAULT 0 CHECK (lock_has_staff_ids IN (0, 1)),
  lock_shared_with_members INTEGER NOT NULL DEFAULT 0 CHECK (lock_shared_with_members IN (0, 1)),
  -- 塊7 口調
  tone_sample              TEXT,                           -- 実際に送ったことのある声かけ文
  timezone                 TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- 清掃箇所(塊2)
CREATE TABLE areas (
  id          TEXT PRIMARY KEY,
  store_id    TEXT NOT NULL REFERENCES stores(id),
  name        TEXT NOT NULL,
  frequency   TEXT NOT NULL,                 -- 'daily' / 'weekly:N' / 'on_visit'
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  UNIQUE (store_id, name)
);

-- スタッフ(塊3・塊6)。店舗をまたいで清掃できるので店舗に従属させない
CREATE TABLE staff (
  id             TEXT PRIMARY KEY,
  display_name   TEXT NOT NULL,              -- 呼び名
  aliases        TEXT NOT NULL DEFAULT '[]', -- 別名[](表記ゆれの名寄せ用、JSON)
  slack_user_id  TEXT UNIQUE,
  unlock_id      TEXT UNIQUE,                -- 鍵の解錠ID。これと一致しない解錠は保存しない
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  is_obligated   INTEGER NOT NULL DEFAULT 1 CHECK (is_obligated IN (0, 1)),  -- 報告義務の対象か
  role           TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('staff', 'sub', 'owner')),  -- スタッフ / 副担当 / オーナー
  home_store_id  TEXT REFERENCES stores(id),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- 欠席予定・免除(分母から外す)
CREATE TABLE absences (
  id           TEXT PRIMARY KEY,
  staff_id     TEXT NOT NULL REFERENCES staff(id),
  starts_on    TEXT NOT NULL,                -- JST の日付 YYYY-MM-DD
  ends_on      TEXT NOT NULL,
  reason_type  TEXT NOT NULL CHECK (reason_type IN ('exam', 'absence', 'other')),  -- 試験前 / 欠席 / その他
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK (starts_on <= ends_on)
);

-- 報告(追記のみ。1送信 = 1レコード。畳み込みは別レコードを参照で結ぶ)
CREATE TABLE reports (
  id                    TEXT PRIMARY KEY,
  store_id              TEXT NOT NULL REFERENCES stores(id),  -- チャンネルから決まる
  staff_id              TEXT REFERENCES staff(id),            -- 名寄せできなければ NULL
  sender_ref            TEXT NOT NULL,                        -- チャネル上の送信者ID
  sent_at               TEXT NOT NULL,                        -- 送信時刻 = 実施日時(判定に使う)
  received_at           TEXT NOT NULL,                        -- 受信時刻(記録のみ)
  areas                 TEXT NOT NULL DEFAULT '[]',           -- 清掃箇所[](areas.id)
  supplies_out          TEXT NOT NULL DEFAULT '[]',           -- 備品切れ[](品目)
  trouble               TEXT,                                 -- トラブルの内容(なければ NULL)
  memo                  TEXT,
  raw_text              TEXT NOT NULL DEFAULT '',             -- 元テキスト
  image_ids             TEXT NOT NULL DEFAULT '[]',           -- 画像ID[]
  channel               TEXT NOT NULL CHECK (channel IN ('slack', 'web', 'seed')),
  message_ref           TEXT,                                 -- チャネル上のメッセージID(返事を返す先)
  confidence            REAL,
  merged_into_report_id TEXT REFERENCES reports(id),          -- 畳み込み先(元の送信は残す)
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (channel, message_ref)
);
CREATE INDEX reports_store_sent ON reports (store_id, sent_at);
CREATE INDEX reports_staff_sent ON reports (staff_id, sent_at);

-- 報告は上書きしない(現行で上書き事故が起きたため。仕様 3章)。DB の段階で止める
CREATE TRIGGER reports_no_delete
BEFORE DELETE ON reports
BEGIN
  SELECT RAISE(ABORT, 'reports は追記のみ: 削除できません');
END;

-- 更新は「畳み込み先を一度だけ結ぶ」ことだけを許す
CREATE TRIGGER reports_no_overwrite
BEFORE UPDATE ON reports
WHEN OLD.merged_into_report_id IS NOT NULL
  OR NEW.id IS NOT OLD.id
  OR NEW.store_id IS NOT OLD.store_id
  OR NEW.staff_id IS NOT OLD.staff_id
  OR NEW.sender_ref IS NOT OLD.sender_ref
  OR NEW.sent_at IS NOT OLD.sent_at
  OR NEW.received_at IS NOT OLD.received_at
  OR NEW.areas IS NOT OLD.areas
  OR NEW.supplies_out IS NOT OLD.supplies_out
  OR NEW.trouble IS NOT OLD.trouble
  OR NEW.memo IS NOT OLD.memo
  OR NEW.raw_text IS NOT OLD.raw_text
  OR NEW.image_ids IS NOT OLD.image_ids
  OR NEW.channel IS NOT OLD.channel
  OR NEW.message_ref IS NOT OLD.message_ref
  OR NEW.confidence IS NOT OLD.confidence
  OR NEW.created_at IS NOT OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'reports は追記のみ: 上書きできません');
END;

-- 入室イベント(スタッフの解錠だけ。スタッフ以外は受け口で捨て、ここには入らない)
CREATE TABLE entries (
  id           TEXT PRIMARY KEY,
  store_id     TEXT NOT NULL REFERENCES stores(id),
  staff_id     TEXT NOT NULL REFERENCES staff(id),  -- NOT NULL: スタッフ以外の解錠は保存できない
  unlocked_at  TEXT NOT NULL,                       -- 解錠時刻(判定に使う)
  received_at  TEXT NOT NULL,                       -- 受信時刻(遅延の記録のみ)
  device_ref   TEXT,
  source       TEXT NOT NULL CHECK (source IN ('webhook', 'csv', 'simulated')),  -- 取り込み元
  raw_payload  TEXT,                                -- スタッフの解錠のものだけ
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (staff_id, unlocked_at, store_id)          -- Webhook と CSV で同じ解錠が二重に入らない
);
CREATE INDEX entries_store_unlocked ON entries (store_id, unlocked_at);

-- 日次ボード
CREATE TABLE board_items (
  id                TEXT PRIMARY KEY,
  store_id          TEXT NOT NULL REFERENCES stores(id),
  date              TEXT NOT NULL,                   -- JST の日付 YYYY-MM-DD
  area_id           TEXT NOT NULL REFERENCES areas(id),
  status            TEXT NOT NULL CHECK (status IN ('done', 'pending', 'carried_over', 'no_assignee')),  -- 完了 / 未清掃 / 繰り越し / 対応者不在
  carried_from_date TEXT,
  done_report_id    TEXT REFERENCES reports(id),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (store_id, date, area_id)
);

-- 引き継ぎ帳(rules から参照されるので先に作る)
CREATE TABLE knowledge (
  id                TEXT PRIMARY KEY,
  store_id          TEXT REFERENCES stores(id),      -- NULL = 全店共通
  question          TEXT NOT NULL,
  answer            TEXT,                            -- オーナー確認中は NULL
  kind              TEXT CHECK (kind IN ('place', 'procedure', 'judgment')),  -- 場所 / 手順 / 判断
  asked_by_staff_id TEXT REFERENCES staff(id),
  asked_at          TEXT NOT NULL,
  answered_by_staff_id TEXT REFERENCES staff(id),    -- 出典: 誰が
  answered_at       TEXT,                            -- 出典: いつ
  status            TEXT NOT NULL CHECK (status IN ('answered', 'pending_owner')),  -- 回答済み / オーナー確認中
  derived_rule_id   TEXT,                            -- 派生ルール(rules.id)
  source_ref        TEXT,                            -- 元の質問メッセージなど
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  -- 出典のない回答は持たない
  CHECK (status = 'pending_owner' OR (answer IS NOT NULL AND answered_by_staff_id IS NOT NULL AND answered_at IS NOT NULL))
);

-- オーナールール(面談 seed と、引き継ぎ帳の「判断」から承認で生まれたものが同じ一覧に並ぶ)
CREATE TABLE rules (
  id                  TEXT PRIMARY KEY,
  rule_no             INTEGER NOT NULL UNIQUE,         -- 画面と判断経路に出す番号(ルール6 など)
  store_id            TEXT REFERENCES stores(id),      -- NULL = 全店
  natural_text        TEXT NOT NULL,                   -- 元の自然文(画面にはこれを出す)
  condition           TEXT NOT NULL DEFAULT '{}',      -- 条件(JSON)
  target              TEXT NOT NULL DEFAULT '{}',      -- 対象(JSON)
  action              TEXT NOT NULL CHECK (action IN ('notify', 'draft', 'exclude_from_count', 'merge', 'change_quota', 'judgment_basis')),
  recipient           TEXT CHECK (recipient IN ('owner', 'sub', 'self')),
  urgency             TEXT NOT NULL DEFAULT 'scheduled' CHECK (urgency IN ('immediate', 'scheduled', 'weekly')),  -- 即時 / 定時 / 週次
  origin              TEXT NOT NULL CHECK (origin IN ('interview', 'owner_ui', 'knowledge')),  -- 面談 / 画面で追加 / 引き継ぎ帳
  origin_knowledge_id TEXT REFERENCES knowledge(id),
  status              TEXT NOT NULL CHECK (status IN ('candidate', 'active', 'inactive')),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  activated_at        TEXT,
  CHECK (origin <> 'knowledge' OR origin_knowledge_id IS NOT NULL)
);

-- エージェントの検出
CREATE TABLE findings (
  id               TEXT PRIMARY KEY,
  store_id         TEXT NOT NULL REFERENCES stores(id),
  detected_at      TEXT NOT NULL,
  kind             TEXT NOT NULL,                   -- 未報告 / 未清掃 / トラブル / ルール該当 など
  target_staff_id  TEXT REFERENCES staff(id),
  target_area_id   TEXT REFERENCES areas(id),
  evidence         TEXT NOT NULL DEFAULT '{}',      -- 根拠(どの入室・報告か。解錠時刻・送信時刻)
  rule_ids         TEXT NOT NULL DEFAULT '[]',      -- 該当ルール
  reasoning_path   TEXT NOT NULL DEFAULT '[]',      -- 判断経路(呼んだツールを含む)
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),  -- 有効 / 取り下げ
  withdrawn_at     TEXT,
  withdrawn_reason TEXT
);
CREATE INDEX findings_store_detected ON findings (store_id, detected_at);

-- 下書き(承認を通してだけ送る)
CREATE TABLE drafts (
  id                 TEXT PRIMARY KEY,
  store_id           TEXT NOT NULL REFERENCES stores(id),
  finding_id         TEXT REFERENCES findings(id),
  recipient_type     TEXT NOT NULL CHECK (recipient_type IN ('staff', 'owner', 'sub')),
  recipient_staff_id TEXT REFERENCES staff(id),
  body               TEXT NOT NULL,
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'rejected', 'withdrawn')),  -- 承認待ち / 送信済み / 却下 / 取り下げ
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  decided_at         TEXT,
  approved_by_staff_id TEXT REFERENCES staff(id),
  sent_at            TEXT,
  -- 送信済みには承認者が要る(自動送信しない)
  CHECK (status <> 'sent' OR approved_by_staff_id IS NOT NULL)
);
