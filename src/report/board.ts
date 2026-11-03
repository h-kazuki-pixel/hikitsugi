// 日次ボード(設計書 6章: 完了 / 未清掃 / 繰り越し / 対応者不在)

import { recordCount } from "../lib/counts";
//
// その日のボードは、朝の定時か、その日最初の報告が届いた時点で、店舗の清掃箇所から作る(何度呼んでも同じ)。
// 報告が届いたら、構造化で判定した箇所を「完了」にする。完了にした報告(畳み込み先)を結んでおく。

export async function ensureBoard(db: D1Database, storeId: string, date: string): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO board_items (id, store_id, date, area_id, status)
       SELECT ? || ':' || id, store_id, ?, id, 'pending'
         FROM areas WHERE store_id = ? AND active = 1`,
    )
    .bind(`${storeId}:${date}`, date, storeId)
    .run();
}

// 清掃後の写真に汚れ・ゴミが残っている箇所は「完了」にせず「要確認」で止める(理由を残す)。
// その日すでに完了の箇所でも要確認に戻す(ボードは今の店の状態を映す。11/3 実機: 先の報告で完了 → 後の写真に紙くず → 完了のままだった)。
// 報告の原本と版は上書きしないので、先の報告の記録は残る
export async function markNeedsRecheck(db: D1Database, storeId: string, date: string, items: { area: string; what: string }[], reportId: string): Promise<number> {
  let n = 0;
  for (const it of items) {
    // 数えるのは、新しく要確認になったときだけ(もとから要確認の箇所に、汚れが残った写真が重なっても1件)
    const before = await db
      .prepare("SELECT status FROM board_items WHERE store_id = ? AND date = ? AND area_id = ?")
      .bind(storeId, date, it.area)
      .first<{ status: string }>();
    const res = await db
      .prepare(
        `UPDATE board_items
            SET status = 'needs_recheck', done_report_id = ?, recheck_note = ?, done_basis = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
          WHERE store_id = ? AND date = ? AND area_id = ?`,
      )
      .bind(reportId, it.what, storeId, date, it.area)
      .run();
    n += res.meta.changes ?? 0;
    if ((res.meta.changes ?? 0) > 0 && before?.status !== "needs_recheck") {
      await recordCount(db, { kind: "recheck_flagged", store_id: storeId, board_date: date, area_id: it.area, ref: reportId });
    }
  }
  return n;
}

export async function markDone(
  db: D1Database,
  storeId: string,
  date: string,
  areaIds: string[],
  reportId: string,
  opts: { keepRecheck?: boolean } = {},
): Promise<number> {
  if (areaIds.length === 0) return 0;
  const placeholders = areaIds.map(() => "?").join(", ");
  // 要確認の箇所が、あとの報告で完了になったら数える(keepRecheck のときは要確認を触らない)
  const rechecked = opts.keepRecheck
    ? []
    : (
        await db
          .prepare(`SELECT area_id FROM board_items WHERE store_id = ? AND date = ? AND status = 'needs_recheck' AND area_id IN (${placeholders})`)
          .bind(storeId, date, ...areaIds)
          .all<{ area_id: string }>()
      ).results;
  const res = await db
    .prepare(
      `UPDATE board_items
          SET status = 'done', done_report_id = ?, recheck_note = NULL, done_basis = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE store_id = ? AND date = ? AND status <> 'done'${opts.keepRecheck ? " AND status <> 'needs_recheck'" : ""} AND area_id IN (${placeholders})`,
    )
    .bind(reportId, storeId, date, ...areaIds)
    .run();
  for (const r of rechecked) await recordCount(db, { kind: "recheck_cleared", store_id: storeId, board_date: date, area_id: r.area_id, basis: "report", ref: reportId });
  return res.meta.changes ?? 0;
}

// 版が積まれたあと(聞き返しの答えなど)に、畳み込み先の報告が完了にしている箇所を最新の版に合わせ直す。
// 畳み込みでまとめた送信すべての最新の版の箇所を合わせたものが「この報告で完了」の箇所。
// 外れた箇所は未清掃に戻す(ほかの報告が完了にした箇所には触らない)。
export async function resyncBoard(db: D1Database, storeId: string, date: string, rootReportId: string): Promise<void> {
  const { results } = await db
    .prepare("SELECT areas FROM reports_current WHERE id = ? OR merged_into_report_id = ?")
    .bind(rootReportId, rootReportId)
    .all<{ areas: string | null }>();
  const areas = [...new Set(results.flatMap((r) => JSON.parse(r.areas ?? "[]") as string[]))];

  await ensureBoard(db, storeId, date);
  const placeholders = areas.map(() => "?").join(", ");
  await db
    .prepare(
      `UPDATE board_items
          SET status = 'pending', done_report_id = NULL, recheck_note = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE store_id = ? AND date = ? AND done_report_id = ? AND status = 'done'${areas.length ? ` AND area_id NOT IN (${placeholders})` : ""}`,
    )
    .bind(storeId, date, rootReportId, ...areas)
    .run();
  // 要確認は版を積み直しただけでは完了にしない(完了にするのは、拾ったと分かったときだけ)
  await markDone(db, storeId, date, areas, rootReportId, { keepRecheck: true });
}

// 朝の繰り越し(仕様 5章「朝: 前日の未清掃を繰り越し、今日のボードを生成」)
// 毎日の箇所で前日に完了しなかったものを、今日のボードで「繰り越し」にする。いつからの繰り越しかを残す。
// 「毎日(N日空いても可)」の箇所は、N+1日続けて完了しなかったときだけ繰り越す(実店舗の西新店。11/4 オーナーの判断)。
// 何度呼んでも同じ(今日の行が未清掃のときだけ変える)。前日のボードがなければ(動かし始めた日)繰り越さない。
export async function carryOver(db: D1Database, storeId: string, date: string, yesterday: string): Promise<number> {
  await ensureBoard(db, storeId, date);
  const res = await db
    .prepare(
      `UPDATE board_items AS t
          SET status = 'carried_over',
              carried_from_date = (SELECT coalesce(y.carried_from_date, y.date) FROM board_items y
                                    WHERE y.store_id = t.store_id AND y.date = ? AND y.area_id = t.area_id),
              updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE t.store_id = ? AND t.date = ? AND t.status = 'pending'
          AND t.area_id IN (SELECT id FROM areas WHERE store_id = ? AND active = 1 AND frequency = 'daily')
          AND EXISTS (SELECT 1 FROM board_items y
                       WHERE y.store_id = t.store_id AND y.date = ? AND y.area_id = t.area_id
                         AND y.status IN ('pending', 'carried_over', 'needs_recheck'))`,
    )
    .bind(yesterday, storeId, date, storeId, yesterday)
    .run();
  // 「毎日(N日空いても可)」の箇所(frequency = 'daily_gap:N'): 前日までの N+1日、続けて完了しなかったら繰り越す。
  // その日数分のボードがそろっていなければ(動かし始めたばかり)繰り越さない。いつからかは、空きの最初の日
  const gap = await db
    .prepare(
      `UPDATE board_items AS t
          SET status = 'carried_over',
              carried_from_date = coalesce(
                (SELECT y.carried_from_date FROM board_items y WHERE y.store_id = t.store_id AND y.date = ? AND y.area_id = t.area_id),
                (SELECT date(?, '-' || CAST(substr(a.frequency, 11) AS INTEGER) || ' days') FROM areas a WHERE a.id = t.area_id)),
              updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE t.store_id = ? AND t.date = ? AND t.status = 'pending'
          AND t.area_id IN (SELECT id FROM areas WHERE store_id = ? AND active = 1 AND frequency LIKE 'daily_gap:%')
          AND (SELECT count(*) FROM board_items y
                WHERE y.store_id = t.store_id AND y.area_id = t.area_id
                  AND y.date <= ? AND y.status IN ('pending', 'carried_over', 'needs_recheck')
                  AND y.date >= (SELECT date(?, '-' || CAST(substr(a.frequency, 11) AS INTEGER) || ' days') FROM areas a WHERE a.id = t.area_id))
              = (SELECT CAST(substr(a.frequency, 11) AS INTEGER) + 1 FROM areas a WHERE a.id = t.area_id)`,
    )
    .bind(yesterday, yesterday, storeId, date, storeId, yesterday, yesterday)
    .run();
  return (res.meta.changes ?? 0) + (gap.meta.changes ?? 0);
}
