// 日次ボード(設計書 6章: 完了 / 未清掃 / 繰り越し / 対応者不在)
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

export async function markDone(
  db: D1Database,
  storeId: string,
  date: string,
  areaIds: string[],
  reportId: string,
): Promise<number> {
  if (areaIds.length === 0) return 0;
  const placeholders = areaIds.map(() => "?").join(", ");
  const res = await db
    .prepare(
      `UPDATE board_items
          SET status = 'done', done_report_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE store_id = ? AND date = ? AND status <> 'done' AND area_id IN (${placeholders})`,
    )
    .bind(reportId, storeId, date, ...areaIds)
    .run();
  return res.meta.changes ?? 0;
}
