// 朝の定時(仕様 5章): 前日の未清掃を繰り越し、今日のボードを作り、オーナーに朝の要約を送る。
// 要約はオーナー宛てなので承認なしで送る(設計書 5-4)。知らせることがなければ送らない。
// 判断はしない(数えて並べるだけ)ので Claude は呼ばない。

import { carryOver } from "../report/board";
import type { SlackClient } from "../slack/api";
import { ruleAppliesSql } from "../rules/scope";

const JST = 9 * 60 * 60 * 1000;
const md = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
};

export async function runMorning(db: D1Database, now: string, deps: { slack: SlackClient | null }) {
  const today = new Date(Date.parse(now) + JST).toISOString().slice(0, 10);
  const yesterday = new Date(Date.parse(now) + JST - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { results: stores } = await db.prepare("SELECT id, name FROM stores ORDER BY id").all<{ id: string; name: string }>();

  const lines: string[] = [];
  for (const s of stores) {
    await carryOver(db, s.id, today, yesterday);
    const { results: carried } = await db
      .prepare(
        `SELECT a.name, b.carried_from_date FROM board_items b JOIN areas a ON a.id = b.area_id
          WHERE b.store_id = ? AND b.date = ? AND b.status = 'carried_over' ORDER BY a.sort_order`,
      )
      .bind(s.id, today)
      .all<{ name: string; carried_from_date: string | null }>();
    const counts = await db
      .prepare(
        `SELECT (SELECT count(*) FROM findings WHERE store_id = ? AND status = 'active' AND detected_at >= ?) AS findings,
                (SELECT count(*) FROM drafts WHERE store_id = ? AND status = 'pending') AS drafts,
                (SELECT count(*) FROM rules WHERE ${ruleAppliesSql("rules")} AND status = 'candidate') AS candidates`,
      )
      .bind(s.id, new Date(Date.parse(`${yesterday}T00:00:00Z`) - JST).toISOString(), s.id, s.id, s.id)
      .first<{ findings: number; drafts: number; candidates: number }>();
    const parts: string[] = [];
    if (carried.length) parts.push(`繰り越し: ${carried.map((c) => `${c.name}(${c.carried_from_date ? md(c.carried_from_date) : "?"}から)`).join("、")}`);
    if (counts?.findings) parts.push(`昨日からの検出 ${counts.findings}件`);
    if (counts?.drafts) parts.push(`承認待ちの下書き ${counts.drafts}件`);
    if (counts?.candidates) parts.push(`ルール候補 ${counts.candidates}件`);
    if (parts.length) lines.push(`【${s.name}】${parts.join(" / ")}`);
  }

  let sent = false;
  if (lines.length && deps.slack) {
    const owner = await db
      .prepare("SELECT slack_user_id FROM staff WHERE role = 'owner' AND status = 'active' AND slack_user_id IS NOT NULL LIMIT 1")
      .first<{ slack_user_id: string }>();
    if (owner) sent = (await deps.slack.postMessage(owner.slack_user_id, ["おはようございます。今日の店の様子です。", ...lines].join("\n")).catch(() => ({ ok: false }))).ok;
  }
  return { today, lines, sent };
}
