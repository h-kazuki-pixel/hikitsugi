-- 聞き返し(仕様 4章「確信度が低いときはスタッフに1回だけ聞き返す。スレッドに返す」)
--
-- 1報告につき1回だけ(UNIQUE)。聞いた問いと、問いを載せたボットの返事の ts を残す。
-- スタッフがそのスレッドで答えたら、答えから作った構造化を report_versions に版2として積む
-- (basis = 'staff_reply'、basis_ref = 答えのメッセージ ts)。答えはここに書かない(追記のみ)
CREATE TABLE clarifications (
  id          TEXT PRIMARY KEY,
  report_id   TEXT NOT NULL UNIQUE REFERENCES reports(id),
  question    TEXT NOT NULL,
  asked_ref   TEXT,                                 -- 問いを載せたボットの返事の ts(取れなければ NULL)
  asked_at    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TRIGGER clarifications_no_update
BEFORE UPDATE ON clarifications
BEGIN
  SELECT RAISE(ABORT, 'clarifications は追記のみ: 上書きできません');
END;

CREATE TRIGGER clarifications_no_delete
BEFORE DELETE ON clarifications
BEGIN
  SELECT RAISE(ABORT, 'clarifications は追記のみ: 削除できません');
END;
