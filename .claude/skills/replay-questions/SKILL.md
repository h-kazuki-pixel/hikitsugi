---
name: replay-questions
description: 過去のスタッフの質問を時系列で流し直し、引き継ぎ帳が「代表を呼ばずに出典つきで返せた件数」「出典なしの回答(目標0)」「趣旨の一致率」を出す。実データは private/ に置き、公開するのは件数と割合だけ。README の数字を更新するときに使う。
---

# 過去の質問の流し直し

設計書 5-5「過去の質問の流し直し」の手順。実装は `src/replay/replay.ts`、入口は `scripts/replay/run.ts`。

## 守ること

- 実名・実際のやり取りを含む CSV は **`private/` にだけ置く**(.gitignore 済み)。`scripts/replay/sample.csv` は架空データで、形式の見本
- 標準出力の集計(件数と割合)だけを README・台本に転記する。`private/replay-items.json`(1件ごとの結果)はコミットしない
- 数字を丸めない。「代表を呼ばずに返せた N件(うち営業時間外 M件)/ 出典なし 0件 / 趣旨の一致率 X%」をそのまま書く。一致率は Claude の判定なので「オーナーが抜き取りで確認」の一文を添える

## CSV の形式(ヘッダ必須)

| 列 | 内容 |
|---|---|
| id | 一意の ID |
| asked_at | 質問の時刻(JST `2026-09-13 22:10`、または ISO) |
| question | 質問の本文 |
| answered_at | 人が答えた時刻(空なら答えなし) |
| answered_by | 答えた人(呼び名。実名は書かない) |
| answer | 当時の実際の答え |
| kind | place / procedure / judgment |
| off_hours | 営業時間外なら 1 |
| holiday | 休日(土日祝・運営の休業日)なら 1。省略すると 0 |
| reusable | 帳に積む答え(再利用できる答え)なら 1。「その場の対応」「答えなし」は 0。列ごと省略すると、答えのある行はすべて積む |

各質問の時点で帳にあるのは、それより前の `reusable = 1` の答えだけ。`answered_at` が分からないときは質問の時刻を入れる(厳密に前の答えだけが使われる)。

## 手順

実データの元は2つ。どちらも `private/` に置く(.gitignore 済み。コミットしない)。
- `private/staff_questions_v2.csv`: 過去の質問 114件(列: 分類, 出所, 日時, 曜日区分, スタッフ, 返信まで(分), メッセージ)
- `private/staff_answers_v1.csv`: 当時の答え(列: 元の行, 出所, 質問日時, 回答した人(役割), 回答本文, 種類, 備考)。「元の行」は v2 の行番号(見出しが1行目)

1. 結ぶ: `npm run replay:join private/staff_questions_v2.csv private/staff_answers_v1.csv`
   - `private/questions.csv`(上の形式)を書く。出力先は private/ の中しか選べない
   - 画面の件数を確かめる(v1・v2 では questions 114 / joined 114 / reusable 44 / situational 67 / no_answer 3 / holiday 40 / off_hours 56 / date_differs 1)
   - 決めごと: 帳に積むのは「再利用できる答え」だけ。答えの時刻は質問の時刻で近似する(実際の回答時刻で確かめて、未来の答えが見える組は 0件)。日時は答えの CSV を使う。休日 = 曜日区分「休日」、営業時間外 = 「休日」+「平日18時以降」
2. 流す: `npm run replay private/questions.csv`(環境変数 `ANTHROPIC_API_KEY` が要る)
   - 本番と同じ引き継ぎ帳のエージェント(claude-opus-5-5)で1件ずつ回る。趣旨の判定は claude-sonnet-5-5
   - 各時点では、それより前の再利用できる答えだけを知識として持つ
3. 標準出力の JSON を読む(件数だけ):
   - `answered_with_source`(出典つきで返せた)/ `handed_to_human`(人に回した)/ `answered_without_source`(出典なし。0 であること。コードが文を組むので構造上 0。0 でなければ不具合)
   - `holiday`(休日)と `off_hours`(営業時間外)の内訳: `total` / `answered_with_source` / `handed_to_human` / `answered_without_source`
   - 趣旨の一致: 返せたもののうち、その質問の当時の答えが再利用できる答えのものだけを判定する。`judged` / `match` / `partial` / `mismatch` / `match_rate`(match / judged)
   - `situational_at_the_time`: 返せたもののうち、当時は個別対応(その場の対応)だったもの。判定しない
   - `no_answer_at_the_time`: 返せたもののうち、当時は答えがなかったもの。判定しない
4. `private/replay-items.json`(1件ごとの id と結果。本文は入らない)から `mismatch` と `partial` を5件ほど抜き取り、オーナーが目で確かめる
5. README「数字」と台本に転記する。書き方: 「過去の質問 N件を流し直すと、代表を呼ばずに出典つきで返せたのは X件(うち休日 H件、営業時間外 Y件)。出典なしの回答は 0件。当時の答えが再利用できるものだった J件のうち、趣旨が合ったのは M件(Claude の判定、オーナーが抜き取りで確認)。答えの時刻は質問の時刻で近似した」。例文を出すときは、暗証番号・鍵の操作・ロッカー番号が入っていないものに限る

## 架空データで動作確認

`ANTHROPIC_API_KEY=... npm run replay scripts/replay/sample.csv`(12件)。テストは `test/replay.test.ts`(Claude なしで回る)。
