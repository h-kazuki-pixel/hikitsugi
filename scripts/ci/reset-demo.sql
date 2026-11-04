-- demo の D1 を空にする(撮影のやり直し用。reset-demo ワークフローからだけ流す。production には流さない)
-- 報告・回答は追記のみのトリガーで削除を止めているが、DROP TABLE の暗黙の削除ではトリガーは動かない。
-- 外部キーは最後に確かめる(defer)。マイグレーションの記録も消し、0001 から当て直す
PRAGMA defer_foreign_keys = true;
DROP VIEW IF EXISTS reports_current;
DROP VIEW IF EXISTS knowledge_current;
DROP TABLE IF EXISTS count_events;
DROP TABLE IF EXISTS claude_usage;
DROP TABLE IF EXISTS knowledge_waiters;
DROP TABLE IF EXISTS clarifications;
DROP TABLE IF EXISTS drafts;
DROP TABLE IF EXISTS findings;
DROP TABLE IF EXISTS rules;
DROP TABLE IF EXISTS knowledge_answers;
DROP TABLE IF EXISTS knowledge;
DROP TABLE IF EXISTS board_items;
DROP TABLE IF EXISTS board_items_new;
DROP TABLE IF EXISTS entries;
DROP TABLE IF EXISTS report_versions;
DROP TABLE IF EXISTS reports;
DROP TABLE IF EXISTS absences;
DROP TABLE IF EXISTS staff;
DROP TABLE IF EXISTS areas;
DROP TABLE IF EXISTS stores;
DROP TABLE IF EXISTS org_settings;
DROP TABLE IF EXISTS d1_migrations;
