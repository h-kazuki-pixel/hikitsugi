#!/usr/bin/env python3
"""デモ用ワークスペースに残ったボット自身の投稿を消す(Actions の clean-demo-slack から動かす)。

対象の順: #天神店 → #薬院店 → ボットとスタッフ・オーナーの DM(CHANNELS_ONLY=1 なら DM は飛ばす)。
各チャンネルで、スレッドの中のボットの返信 → ボットの投稿(スレッドの親を含む)の順に chat.delete する。
ボット以外(スタッフ・オーナー)の投稿・返信には触れない。D1 には触らない。

環境変数:
  SLACK_BOT_TOKEN  demo のボットトークン(必須)
  DEMO_SLACK_IDS   「名前=ID」を1行に1つ(tenjin=C… yakuin=C… owner=U… aoi=U… など。形は scripts/ci/apply-demo-slack-ids.mjs)
  CHANNELS_ONLY    1 なら DM を飛ばす

ログは公開なので、本文・ID は出さず、件数だけ出す。
必要なスコープ: channels:history, im:history, im:write, chat:write(demo のマニフェストにある)
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

TOKEN = os.environ.get("SLACK_BOT_TOKEN")
if not TOKEN:
    raise SystemExit("SLACK_BOT_TOKEN を設定してください")

CHANNELS = [("tenjin", "#天神店"), ("yakuin", "#薬院店")]
PEOPLE = [("owner", "オーナー"), ("sub", "副担当"), ("aoi", "あおい"), ("haruto", "はると"), ("mio", "みお"), ("sota", "そうた")]


def parse_ids(raw):
    ids = {}
    for line in (raw or "").splitlines():
        m = re.match(r"^\s*([a-z]+)\s*=\s*([A-Z0-9]+)\s*$", line)
        if m:
            ids[m.group(1)] = m.group(2)
    return ids


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
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:  # レート制限。指定秒数待って再試行
                time.sleep(int(e.headers.get("Retry-After", "5")))
                continue
            raise


class SlackError(Exception):
    pass


def need(method, **params):
    body = api(method, **params)
    if not body.get("ok"):
        raise SlackError(f"{method}: {body.get('error')}")
    return body


def paged(method, key, **params):
    cursor = None
    while True:
        p = dict(params, limit=200)
        if cursor:
            p["cursor"] = cursor
        body = need(method, **p)
        yield from body.get(key, [])
        cursor = body.get("response_metadata", {}).get("next_cursor")
        if not cursor:
            break


ids = parse_ids(os.environ.get("DEMO_SLACK_IDS"))
if os.environ.get("GITHUB_ACTIONS") == "true":
    for v in ids.values():
        print(f"::add-mask::{v}")

me = need("auth.test")
bot_user = me["user_id"]
bot_id = me.get("bot_id")


def is_bot(m):
    return m.get("user") == bot_user or (bot_id is not None and m.get("bot_id") == bot_id)


def collect(channel):
    """消す順(スレッドの返信 → 親)に並べた (ts, 種別) と、残すボット以外の件数"""
    order, seen, kept = [], set(), 0
    for m in paged("conversations.history", "messages", channel=channel):
        if m.get("reply_count"):
            for r in paged("conversations.replies", "messages", channel=channel, ts=m["ts"]):
                if r["ts"] == m["ts"]:
                    continue
                if is_bot(r):
                    if r["ts"] not in seen:
                        seen.add(r["ts"])
                        order.append((r["ts"], "返信"))
                else:
                    kept += 1
        if is_bot(m):
            if m["ts"] not in seen:
                seen.add(m["ts"])
                order.append((m["ts"], "投稿"))
        elif m.get("subtype") != "tombstone":
            kept += 1
    return order, kept


def clean(label, channel):
    order, kept = collect(channel)
    done = {"返信": 0, "投稿": 0}
    failed = []
    for ts, kind in order:
        body = api("chat.delete", channel=channel, ts=ts)
        if body.get("ok") or body.get("error") == "message_not_found":
            done[kind] += 1
        else:
            failed.append(body.get("error"))
        time.sleep(1.2)
    print(f"{label}: ボットの返信 {done['返信']} 件・投稿 {done['投稿']} 件を消しました(ボット以外の投稿・返信 {kept} 件は残しました)")
    if failed:
        print(f"::warning::{label}: {len(failed)} 件を消せませんでした({', '.join(sorted(set(failed)))})")
    return done["返信"] + done["投稿"], len(failed)


targets = []
for key, label in CHANNELS:
    if ids.get(key):
        targets.append((label, ids[key]))
    else:
        print(f"::warning::DEMO_SLACK_IDS に {key}=C… の行がないので {label} は飛ばしました")
if os.environ.get("CHANNELS_ONLY") != "1":
    for key, label in PEOPLE:
        if ids.get(key):
            targets.append((f"{label}との DM", ("dm", ids[key])))

total, total_failed, errors = 0, 0, 0
for label, ch in targets:
    try:
        if isinstance(ch, tuple):
            # 既にある DM ならその ID が返る(相手には何も送らない)
            ch = need("conversations.open", users=ch[1])["channel"]["id"]
        n, f = clean(label, ch)
        total += n
        total_failed += f
    except SlackError as e:
        errors += 1
        print(f"::error::{label}: 読めませんでした({e})")

print(f"合計: ボットの投稿・返信 {total} 件を消しました" + (f"(消せなかったもの {total_failed} 件)" if total_failed else ""))
if errors or total_failed:
    sys.exit(1)
