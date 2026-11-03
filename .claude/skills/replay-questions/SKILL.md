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

1. `private/questions.csv` を上の形式で用意する(09 の分析の元データから。報告・雑談は除外済みのもの)
2. 実行: `ANTHROPIC_API_KEY=... npm run replay private/questions.csv`
   - 本番と同じ引き継ぎ帳のエージェント(claude-opus-5-5)で1件ずつ回る。114件で数分
   - 各時点では、それより前に人が答えた内容だけを知識として持つ
3. 標準出力の JSON を読む:
   - `answered_with_source` / `answered_with_source_off_hours` / `handed_to_human`
   - `holiday`(休日の内訳: `total` / `answered_with_source` / `handed_to_human` / `answered_without_source`)
   - `answered_without_source` が 0 であること(コードが文を組むので構造上 0。0 でなければ不具合)
   - `match_rate`(match / judged)、`partial`、`mismatch`
4. `private/replay-items.json` から `mismatch` と `partial` を5件ほど抜き取り、オーナーが目で確かめる
5. README「数字」と台本に転記する。書き方: 「過去の質問 N件を流し直すと、代表を呼ばずに出典つきで返せたのは X件(うち営業時間外 Y件)。出典なしの回答は 0件。返せたものの趣旨の一致率は Z%(Claude の判定、オーナーが抜き取りで確認)」

## 架空データで動作確認

`ANTHROPIC_API_KEY=... npm run replay scripts/replay/sample.csv`(12件)。テストは `test/replay.test.ts`(Claude なしで回る)。
