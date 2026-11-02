# hikitsugi

**無人自習室のオーナーが、清掃の「判断」と現場の「答え」を自分の頭から取り出し、ツールを持った Claude のエージェントと次のスタッフに受け継ぐ仕組み。**

> 無人自習室を3店舗運営する中で、清掃報告を記録する仕組みは4か月前に自分で作った。それでも、週の回数を数えるのは毎週自分が手でやっている。入室記録との突き合わせは9月末に一度 CSV を渡してやってみたら未報告が10件見つかったが、手間がかかってそれきりになっている。声をかけるのも自分だ。スタッフからの質問は約2年で114件、半分は営業時間外に来て、7割は前に答えたことのある内容で、それを自分が休日でも数分で返している。記録は溜まるが、判断は人のまま、答えは自分の頭の中のまま。この仕組みは、その判断の部分をツールを持ったエージェントに渡し、同時に自分の運営の判断と現場の知識を、次のスタッフが受け継げる形に残す。

Built with Claude: Japan 2026 / テーマ1「あなたにしかない深さを」

## デモ

- **demo(架空の店舗・公開)**: https://hikitsugi-demo.h-kazuki.workers.dev/stores/tenjin
  - 店舗の一覧: https://hikitsugi-demo.h-kazuki.workers.dev/
  - いま見られるのは店舗名と今日のボード(空)まで。中核は「今の状態」の表のとおり実装中
- 店舗・スタッフ・質問はすべて架空(「サンプル自習室 天神店 / 薬院店」)。実店舗のデータは非公開の production 環境にだけある

## 数字(自分の店の、今の不便)

| | |
|---|---|
| 入室したのに報告がない | 9/28 に一度だけ手作業で照合して **10件**。手間がかかり、以後やれていない |
| スタッフからの質問 | 約2年で **114件** |
| そのうち営業時間外 | **49%**(休日 35%、平日夜 14%) |
| そのうち過去に答えたことのある趣旨 | **68%**(空調だけで24件) |
| そのうち「していいか・仕様か」の判断 | **37%**(紙のマニュアルには書けない種類) |
| 今の返信 | 休日でも中央値 **2〜3分**。速いのは解決している証拠ではなく、代表が張りついている証拠 |
| 記録の仕組みだけの限界 | 報告の上書きで、繰り越し **441件** が実は **13件** だった |

## 現行システムとの線引き

> 2026年7月から、Notion フォームと GitHub Actions で清掃報告を記録する仕組みを運用してきた(別リポジトリ・非公開・本ハッカソンの提出物ではない)。4か月やって分かったのは、記録は溜まるが、判断は人のまま、ということだった。週の回数は毎週自分が Claude に数えさせている。入室記録との突き合わせは、9月末に一度 CSV を渡してやってみたら「入室したのに報告がない」が10件見つかったが、手間がかかってそれきりになっている。声をかけるのも自分だ。この仕組みは、その「判断」の部分を、ツールを持ったエージェントに渡すために、基盤からゼロで作り直したものである。既存のコードは一行も含まない。

- 現行は「記録」、今回は「判断(検出・ルール照合・下書き)と引き継ぎ」。基盤も分けた(現行: Notion + Python、今回: Cloudflare Workers + D1 + TypeScript。Notion は使わない)
- 設計(docs/)はキックオフ前に書いた。コードはすべて 2026-11-02 12:00 のキックオフ以降に書いている(コミット履歴のとおり)。現行運用から持ち込んだのは、4か月で実際に起きたことに基づく既定値だけ([docs/07_現行システムとの線引き.md](docs/07_現行システムとの線引き.md))

## 何をするか(ある水曜日)

1. スタッフが店に入る(鍵の解錠が入室として記録される)。清掃を終え、いつもの Slack の店舗チャンネルに写真を送る
2. Claude が写真を見て清掃箇所と備品を拾い、スレッドに返す(「トイレットペーパーが残り1つに見えますが、合ってますか?」)
3. 夜の定時、エージェントが入室と報告を突き合わせる。「19:10 入室、報告なし、2時間経過。ルール2に該当」と判断経路を出し、責めない声かけ文を下書きする。**送るかどうかはオーナーが決める**
4. 休業日にスタッフが「暖房上げていい?」と聞くと、引き継ぎ帳が「25度までは自由(9/14 オーナー回答)」と**出典つきで**答える。答えのない質問は「確認します」と返し、オーナーに一度だけ聞く
5. オーナーの答えが「判断」なら、承認でルールになる。翌週、エージェントの判断経路に「ルール6(◯日のスタッフの質問から)」と出る。**スタッフが聞いた一言が、次からエージェントの判断基準になる**

## 今の状態

正直に書く。中核はこれから作る。

| | 状態 |
|---|---|
| データモデル(報告・入室・ボード・ルール・検出・下書き・引き継ぎ帳) | 実装済み。約束を DB の段階で強制している(下記) |
| 架空の2店舗の seed(仕様 1章の7つの塊) | 実装済み |
| 店舗ページ(店舗名と今日のボード。スマホ優先) | 実装済み(ボードはまだ空) |
| demo / production の分離、production の Access 保護 | 実装済み |
| GitHub Actions でのデプロイ | 実装済み |
| Slack の受け口(報告の受信・分類・スレッド返事) | 実装中 |
| 報告の構造化・写真判定 | 実装中 |
| 入室の受け口(`POST /events/entry`、CSV 取り込み、模擬ボタン) | 実装中 |
| 現場エージェント(ツール使用ループ、判断経路、取り下げ) | 実装中 |
| 承認つきの声かけ下書き | 実装中 |
| 引き継ぎ帳(出典つき回答、ルール候補) | 実装中 |
| 過去の質問114件の流し直し(数字は件数と割合だけ公開) | 実装中 |

### DB の段階で守っている約束

| 約束 | 仕組み |
|---|---|
| 報告は上書きしない | 受け取った原本(`reports`)は削除・更新をトリガーで止める。構造化の結果は版(`report_versions`)として積み、聞き返しで確定したら版2 |
| 出典のない回答は出さない | 引き継ぎ帳の回答(`knowledge_answers`)は「誰が・いつ」が必須で追記のみ。回答がないと「回答済み」にできない |
| スタッフ以外の解錠は保存しない | 入室(`entries`)はスタッフが特定できないと入らない |
| スタッフへの声かけは承認を通す | スタッフ宛ての下書きは承認者なしに「送信済み」にできない |
| ルールの由来が残る | 引き継ぎ帳から生まれたルールは、元の質問と回答を必ず指す |

## 承認を通すもの・通さないもの

- スタッフ宛ての声かけ・催促は、Claude が下書きし、オーナーが一押しで送る。自動では送らない。機械的な催促は関係を壊すので、声をかけるかどうかの判断は人が持つ
- スタッフ宛てに承認なしで送るのは、スタッフが送ってきたもの(報告・質問)へのスレッド返事だけ(受付・聞き返し・引き継ぎ帳の回答・「確認中」)
- オーナー・副担当宛ての通知(答えのない質問の確認、トラブルの即時通知、備品切れの回送、朝の要約)は承認なしで送る。宛先が運営側なので、承認すること自体が成り立たない

## 技術構成

- Cloudflare Workers + Hono(画面は Hono の JSX、スマホ優先)+ D1 + Queues + Cron Triggers
- Webhook(Slack・入室)は署名を確かめてすぐ 200 を返し、処理はキューで行う。Cron もキューに積むだけ
- Claude: Anthropic SDK のツール使用ループを Worker の中に実装する(Agent SDK は Node 前提なので使わない)
- 製品内のモデル(予定)
  - 報告の構造化・写真判定: `claude-sonnet-5-5`。1日に何件も来る定型の読み取りなので、速さと費用を優先する
  - 現場エージェント(引き継ぎ帳を含む): `claude-opus-5-5`。入室・報告・ルール・過去の答えを道具で調べ、多段で判断して経路を残す役なので、判断の質を優先する
- 設計: [docs/設計書.md](docs/設計書.md) / [docs/仕様.md](docs/仕様.md)

## 環境と実店舗データの守り方

- 環境は `demo`(架空データ・公開)と `production`(実店舗)の2つ。Worker・D1・Queues は環境ごとに別。Slack アプリとワークスペースも別にし、撮影に実データが映る事故をアカウントの段階で防ぐ
- production のオーナー画面(Slack と入室の Webhook 以外のすべて)は Cloudflare Access の背後に置く。Worker の側でも `Cf-Access-Jwt-Assertion` ヘッダーの JWT(署名・発行者・AUD・有効期限)を検証し、検証できなければ 403 を返す。設定が入っていないときも 403(通さない側に倒す)。demo では何もしない
- 公開リポジトリには架空データしか入れない(コミット前フックで検査する。下記)

## デプロイ

GitHub Actions で行う。秘密情報はリポジトリにもセッションの環境にも置かず、GitHub Secrets → ワークフロー → `wrangler secret put` で Worker に入れる。

| ワークフロー | いつ動くか | 何をするか |
|---|---|---|
| [test](.github/workflows/test.yml) | PR ごと、デプロイの前 | 型検査とテスト |
| [deploy-demo](.github/workflows/deploy-demo.yml) | main への push(マージ)、手動 | テスト → D1 マイグレーション → 架空の seed → デプロイ → 秘密情報 → 動作確認(`/stores/tenjin` が 200) |
| [deploy-production](.github/workflows/deploy-production.yml) | **手動のみ** | 確認入力 → テスト → D1 マイグレーション → デプロイ → 秘密情報 → 動作確認(ログインなしの `/` が 403、Access の設定後は 302)。Access の設定がなければ初回デプロイとして続ける。seed は流さない |

seed は `INSERT OR IGNORE` なので、何度流しても同じ結果になる(既にある行は上書きしない)。

### 準備(オーナーが行う)

1. Cloudflare ダッシュボードで D1(`hikitsugi-demo` / `hikitsugi-production`)と Queues(`hikitsugi-jobs-demo` / `hikitsugi-jobs-production`)を作る。D1 の ID は [wrangler.toml](wrangler.toml) に書く(済み)
2. Cloudflare の API トークンを作る。権限はアカウントの「Workers スクリプト: 編集」「D1: 編集」「Queues: 編集」「アカウント設定: 読み取り」と、ユーザーの「メンバーシップ: 読み取り」「ユーザーの詳細: 読み取り」
3. GitHub のリポジトリの Secrets に登録する(Settings → Secrets and variables → Actions → Repository secrets)
   - `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`
   - 貼り付けるときに末尾の改行が入りやすい。ワークフローは前後の空白・改行を取り除いて使い、取り除いたときは警告を出す(初回のデプロイはこれで落ちた)
4. Worker の秘密情報は、GitHub の Environment ごとに登録する(Settings → Environments → `demo` / `production` → Environment secrets)。未登録のものは飛ばすので、そろっていなくてもワークフローは落ちない
   - `ANTHROPIC_API_KEY`、`SLACK_SIGNING_SECRET`、`SLACK_BOT_TOKEN`、`ENTRY_WEBHOOK_SECRET`
   - production だけ: `ACCESS_TEAM_DOMAIN`、`ACCESS_AUD`(下の Access の手順で得る)
   - Environment は最初のデプロイで自動で作られる。先に作って Secrets を入れてもよい

### production の公開手順

手順は **初回デプロイ → 403 を確認 → Access を設定 → Secrets を登録 → 再デプロイ**。

初回だけは Cloudflare Access の設定なしでデプロイする。`workers.dev` の URL で Access を有効にするには、Worker が先に存在している必要があるため。Access の設定(`ACCESS_TEAM_DOMAIN` / `ACCESS_AUD`)がない間は、コードが Webhook 以外のすべてに 403 を返すので、実店舗の画面は出ない。

1. **初回デプロイ**: Actions → deploy-production → Run workflow。確認欄に `production` と入れて実行する。Access の設定がないので「初回デプロイ」として続く
2. **403 を確認**: ワークフローの動作確認が「ログインなしの `/` が 403」を確かめる。ブラウザでも production の URL を開き、「このページは開けません」になることを確かめる
3. **Access を設定**(Cloudflare ダッシュボード)
   - Workers & Pages → `hikitsugi-production` → Settings → Domains & Routes の workers.dev の行で Cloudflare Access を有効にする(自分のドメインで公開する場合は、Worker にカスタムドメインを付け、Zero Trust → Access → Applications → Add an application → Self-hosted で登録する)
   - ポリシーを Allow にし、オーナーと副担当のメールアドレスだけを含める
   - Webhook の2つの入口(`/slack/events`、`/events/entry`)は Access を通さない。Slack と鍵はログインできないので、送り手の署名で検証する。同じホスト名でパスを指定したアプリケーションを作り、ポリシーを Bypass(Everyone)にする
   - 設定値を控える。チームのドメインは `<チーム名>.cloudflareaccess.com`(Zero Trust → Settings で確認できる)。AUD は、守るアプリケーションの Overview にある Application Audience (AUD) Tag
4. **Secrets を登録**: GitHub の Environment `production` の Secrets に `ACCESS_TEAM_DOMAIN` と `ACCESS_AUD` を登録する
5. **再デプロイ**: もう一度 deploy-production を実行する。動作確認はログインなしの `/` が 302(Access のログイン画面への転送)になる。ブラウザで開いてログイン画面が出ること、ログイン後に店舗一覧が出ることを確かめる。`/events/entry` がログイン画面にならない(Bypass が効いている)ことも確かめる

そのあと:

- RemoteLOCK の通知先の登録は、`/events/entry` が本番で 200 を返すようになってから行う(docs/07 の5)
- 実店舗の名簿(Slack ID・解錠ID)は実データなのでリポジトリに置かない。入れ方は別途決める

ダッシュボードの項目名は変わることがある。見つからなければ Cloudflare のドキュメント(Workers の workers.dev と Access、Access の Self-hosted applications)を参照する。

## ローカルで動かす

```bash
npm ci
```

```bash
npm run migrate:local && npm run seed:local
```

```bash
npm run dev
```

http://localhost:8787/stores/tenjin を開く。テストは `npm test`、型検査は `npm run typecheck`。

## 開発での Claude Code の使い分け

- フック: コミット前の実データ検査(下記)。実店舗を運営する本人が同じ手で公開リポジトリに書くので、実データの混入を人の注意ではなく仕組みで止める
- サブエージェント: [.claude/agents/judge-reviewer.md](.claude/agents/judge-reviewer.md)。ハッカソンの審査員役として、審査基準(インパクト30 / デモ25 / Claudeの活用25 / 深さと実行20)でリポジトリと README を読み、弱点を指摘する。読み取り専用(Read / Grep / Glob のみ)。区切りごとに呼んで見直す。初回の見直しで、フックが日本語のパスで黙って素通りする不具合、報告の「追記のみ」が聞き返しと両立しない設計、production が無防備になる設定が見つかり、直した
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
