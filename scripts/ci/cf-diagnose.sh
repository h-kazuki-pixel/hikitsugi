#!/usr/bin/env bash
# Cloudflare の API トークンとアカウントで、デプロイに要る操作ができるかを確かめる。
#
# デプロイの前に走らせ、できないときは「何が足りないか」を日本語で出して止める。
# Actions のログは公開リポジトリでは誰でも読めるので、トークン・アカウント名・他のアカウントID は出さない。
#
# 使い方: CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… scripts/ci/cf-diagnose.sh demo|production
# CF_API で API の URL を差し替えられる(テスト用)。
set -uo pipefail

ENV_NAME="${1:?環境名(demo / production)を渡してください}"
API="${CF_API:-https://api.cloudflare.com/client/v4}"
ACC="${CLOUDFLARE_ACCOUNT_ID:?}"
TOKEN="${CLOUDFLARE_API_TOKEN:?}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

read -r DB_NAME DB_ID QUEUE < <(python3 - "$ROOT/wrangler.toml" "$ENV_NAME" <<'PY'
import sys, tomllib
env = tomllib.load(open(sys.argv[1], "rb"))["env"][sys.argv[2]]
db = env["d1_databases"][0]
print(db["database_name"], db["database_id"], env["queues"]["producers"][0]["queue"])
PY
)

problems=()
lines=()
ok()   { lines+=("| $1 | OK | $2 |"); }
ng()   { lines+=("| $1 | **NG** | $2 |"); problems+=("$3"); }

# GET して "HTTP状態 本文" を返す
call() {
  local body status
  body=$(curl -sS -w $'\n%{http_code}' -H "Authorization: Bearer $TOKEN" "$API$1" 2>/dev/null) || body=$'{}\n000'
  status="${body##*$'\n'}"
  printf '%s\n%s' "$status" "${body%$'\n'*}"
}
status_of() { printf '%s' "$1" | head -1; }
json_of()   { printf '%s' "$1" | tail -n +2; }
errors_of() { json_of "$1" | jq -r '[.errors[]? | "\(.code): \(.message)"] | join(" / ")' 2>/dev/null; }

# 1. トークンが有効か(ユーザーのトークンとアカウントのトークンの両方を試す)
r=$(call "/user/tokens/verify")
if [ "$(json_of "$r" | jq -r '.result.status // empty' 2>/dev/null)" = "active" ]; then
  ok "トークン" "有効(ユーザーのトークン)"
else
  r2=$(call "/accounts/$ACC/tokens/verify")
  if [ "$(json_of "$r2" | jq -r '.result.status // empty' 2>/dev/null)" = "active" ]; then
    ok "トークン" "有効(アカウントのトークン)"
  else
    ng "トークン" "無効($(errors_of "$r"))" \
      "API トークンが無効です(期限切れ・削除済み・値の貼り間違い)。Cloudflare の My Profile → API Tokens で確かめ、作り直したら GitHub の CLOUDFLARE_API_TOKEN を登録し直してください。"
  fi
fi

# 2. 登録したアカウントID がトークンから見えるか
r=$(call "/accounts?per_page=50")
count=$(json_of "$r" | jq -r '.result | length' 2>/dev/null || echo 0)
if json_of "$r" | jq -e --arg a "$ACC" '.result[]? | select(.id == $a)' >/dev/null 2>&1; then
  ok "アカウント" "トークンから見えるアカウント ${count} 件のうちに、CLOUDFLARE_ACCOUNT_ID がある"
else
  ng "アカウント" "トークンから見えるアカウント ${count} 件のうちに、CLOUDFLARE_ACCOUNT_ID がない" \
    "CLOUDFLARE_ACCOUNT_ID のアカウントに、このトークンが届いていません。トークンの「Account Resources」をそのアカウントにするか、CLOUDFLARE_ACCOUNT_ID を D1 を作ったアカウントの ID にしてください(Workers & Pages の画面右側の Account ID)。"
fi

# 3. D1 の一覧が読めるか、目当ての D1 があるか、ID が合っているか
r=$(call "/accounts/$ACC/d1/database?per_page=100")
if [ "$(json_of "$r" | jq -r '.success' 2>/dev/null)" = "true" ]; then
  found_id=$(json_of "$r" | jq -r --arg n "$DB_NAME" '.result[]? | select(.name == $n) | .uuid' | head -1)
  if [ -z "$found_id" ]; then
    ng "D1" "一覧は読めるが $DB_NAME がない" \
      "このアカウントに D1「$DB_NAME」がありません。D1 を別のアカウントに作った可能性があります。CLOUDFLARE_ACCOUNT_ID を D1 を作ったアカウントの ID にしてください。"
  elif [ "$found_id" != "$DB_ID" ]; then
    ng "D1" "$DB_NAME はあるが、ID が wrangler.toml と違う(実際: $found_id)" \
      "wrangler.toml の $ENV_NAME の database_id を $found_id に直してください。"
  else
    ok "D1" "$DB_NAME があり、ID も一致"
  fi
else
  ng "D1" "一覧を読めない(HTTP $(status_of "$r") / $(errors_of "$r"))" \
    "トークンに D1 の権限がありません。トークンの Permissions に「Account / D1 / Edit」を足してください。"
fi

# 4. Workers のスクリプトを扱えるか
r=$(call "/accounts/$ACC/workers/scripts")
if [ "$(json_of "$r" | jq -r '.success' 2>/dev/null)" = "true" ]; then
  ok "Workers" "スクリプトの一覧を読める"
else
  ng "Workers" "読めない(HTTP $(status_of "$r") / $(errors_of "$r"))" \
    "トークンに Workers の権限がありません。Permissions に「Account / Workers Scripts / Edit」を足してください。"
fi

# 5. Queues を扱えるか、目当てのキューがあるか
r=$(call "/accounts/$ACC/queues?per_page=100")
if [ "$(json_of "$r" | jq -r '.success' 2>/dev/null)" = "true" ]; then
  if json_of "$r" | jq -e --arg q "$QUEUE" '.result[]? | select(.queue_name == $q)' >/dev/null 2>&1; then
    ok "Queues" "$QUEUE がある"
  else
    ng "Queues" "一覧は読めるが $QUEUE がない" \
      "このアカウントにキュー「$QUEUE」がありません。ダッシュボードで作るか、名前を確かめてください。"
  fi
else
  ng "Queues" "読めない(HTTP $(status_of "$r") / $(errors_of "$r"))" \
    "トークンに Queues の権限がありません。Permissions に「Account / Queues / Edit」を足してください。"
fi

{
  echo "### Cloudflare の確認($ENV_NAME)"
  echo ""
  echo "| 項目 | 結果 | 詳しく |"
  echo "|---|---|---|"
  printf '%s\n' "${lines[@]}"
  if [ "${#problems[@]}" -gt 0 ]; then
    echo ""
    echo "#### 直すこと"
    printf -- '- %s\n' "${problems[@]}"
  fi
} | tee -a "$SUMMARY"

if [ "${#problems[@]}" -gt 0 ]; then
  for p in "${problems[@]}"; do echo "::error::$p"; done
  exit 1
fi
