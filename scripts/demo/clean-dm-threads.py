#!/usr/bin/env python3
"""hikitsugi-demo のDMで、親メッセージが削除済みのスレッドに残ったボットの返信を消す。

既定は確認のみ（何も消さない）。実際に消すときは --delete を付ける。
  --all     親が削除されていないスレッドのボット返信も対象にする

環境変数:
  SLACK_BOT_TOKEN  xoxb- で始まるボットトークン（必須）
  SLACK_CHANNEL    D で始まるDMのID（任意）
  SLACK_USER       DMの相手のメンバーID（任意。SLACK_CHANNEL の代わりに、相手からDMを開いて探す）
  どちらも未指定なら、ボットのDMを自動で探す（DMが1件だけのとき）

必要なスコープ: im:history, chat:write
  SLACK_USER を使うなら im:write、自動で探すなら im:read も要る
  （demo のマニフェストには im:read がないので、SLACK_CHANNEL か SLACK_USER を指定する）
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

TOKEN = os.environ.get("SLACK_BOT_TOKEN")
if not TOKEN:
    raise SystemExit("SLACK_BOT_TOKEN を設定してください")
DELETE = "--delete" in sys.argv
ALL = "--all" in sys.argv


def api(method, **params):
    data = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(
        f"https://slack.com/api/{method}",
        data=data,
        headers={"Authorization": f"Bearer {TOKEN}"},
    )
    while True:
        try:
            with urllib.request.urlopen(req) as r:
                body = json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:  # レート制限。指定秒数待って再試行
                time.sleep(int(e.headers.get("Retry-After", "5")))
                continue
            raise
        if not body.get("ok"):
            raise SystemExit(f"{method} 失敗: {body.get('error')}")
        return body


def paged(method, key, **params):
    cursor = None
    while True:
        p = dict(params, limit=200)
        if cursor:
            p["cursor"] = cursor
        body = api(method, **p)
        yield from body.get(key, [])
        cursor = body.get("response_metadata", {}).get("next_cursor")
        if not cursor:
            break


me = api("auth.test")
bot_user = me["user_id"]
bot_id = me.get("bot_id")

channel = os.environ.get("SLACK_CHANNEL")
if not channel and os.environ.get("SLACK_USER"):
    # 既にあるDMならそのIDが返る（新しく話しかけはしない）
    channel = api("conversations.open", users=os.environ["SLACK_USER"])["channel"]["id"]
if not channel:
    ims = list(paged("conversations.list", "channels", types="im"))
    if len(ims) != 1:
        for c in ims:
            print(c["id"], "相手:", c.get("user"))
        raise SystemExit("DMが複数（または0件）あります。SLACK_CHANNEL に対象のIDを指定してください")
    channel = ims[0]["id"]


def is_bot(m):
    return m.get("user") == bot_user or (bot_id is not None and m.get("bot_id") == bot_id)


def is_deleted_parent(m):
    return m.get("subtype") == "tombstone" or m.get("text") == "This message was deleted."


targets, others = [], 0
for m in paged("conversations.history", "messages", channel=channel):
    if not m.get("reply_count"):
        continue
    deleted = is_deleted_parent(m)
    if not (deleted or ALL):
        continue
    for r in paged("conversations.replies", "messages", channel=channel, ts=m["ts"]):
        if r["ts"] == m["ts"]:
            continue
        if is_bot(r):
            targets.append(r)
        elif deleted:
            others += 1

for r in targets:
    print(r["ts"], (r.get("text") or "")[:40].replace("\n", " "))

if DELETE:
    print(f"ボットの返信 {len(targets)} 件を削除します")
    for r in targets:
        api("chat.delete", channel=channel, ts=r["ts"])
        time.sleep(1.2)
    print("完了")
else:
    print(f"ボットの返信 {len(targets)} 件（確認のみ。消すときは --delete を付けて再実行）")

if others:
    print(f"※ 削除済みスレッドにボット以外の返信が {others} 件あります。"
          "これはボットのトークンでは消せないので、Slackアプリで長押し→削除してください")
