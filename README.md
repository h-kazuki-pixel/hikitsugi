# hikitsugi

無人施設の清掃・来店管理。報告を記録するだけでなく、入室との突き合わせ・ルール照合・声かけの下書きを Claude のエージェントが行い、現場の知識と判断を次のスタッフが受け継げる形に残す。

設計は [docs/設計書.md](docs/設計書.md) と [docs/仕様.md](docs/仕様.md)。

## 開発での Claude Code の使い分け

- フック: コミット前の実データ検査(下記)
- サブエージェント: [.claude/agents/judge-reviewer.md](.claude/agents/judge-reviewer.md)。ハッカソンの審査員役として、審査基準(インパクト30 / デモ25 / Claudeの活用25 / 深さと実行20)でリポジトリと README を読み、弱点を指摘する。読み取り専用(Read / Grep / Glob のみ)で、ファイルは書き換えない。区切りごとに呼んで見直す
- Skills: 場面の seed づくりと過去の質問の流し直し(必要になった時点で `.claude/skills/` に作る)

## コミット前の実データ検査(Claude Code フック)

公開リポジトリに実データ(APIキー・トークン・メールアドレス・電話番号・Slack のユーザーID・第三者の実名)を入れないため、Claude Code が `git commit` を実行する前に差分を検査し、見つかればコミットを止める。

- 設定: [.claude/settings.json](.claude/settings.json) の `PreToolUse` フック(Bash)
- 検査: [scripts/check-commit.mjs](scripts/check-commit.mjs)。コミットされる差分の追加行だけを見る。`git commit -a` や `git add … && git commit` のときは未ステージの変更と未追跡ファイルも見る。見つかった値は伏せて表示する
- コミットメッセージ: `-m`(ヒアドキュメントを含む)と `-F` / `--file` の中身も同じ規則で検査する
- 追加の語: `private/denylist.txt`(.gitignore 済み、コミットしない)に1行1語で書くと、その語も検査する(大文字小文字は区別しない、`#` で始まる行はコメント)。第三者の実名や会員情報を入れる
- 架空データの書き方: メールは `@example.com`、Slack ユーザーID は `U_DEMO_01` のように `_` を入れる
- 手で走らせる: `node scripts/check-commit.mjs`(ステージ済みの差分を検査)
- テスト: `node --test scripts/check-commit.test.mjs`
