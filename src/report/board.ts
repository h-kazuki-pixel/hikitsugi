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
          SET status = 'pending', done_report_id = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE store_id = ? AND date = ? AND done_report_id = ?${areas.length ? ` AND area_id NOT IN (${placeholders})` : ""}`,
    )
    .bind(storeId, date, rootReportId, ...areas)
    .run();
  await markDone(db, storeId, date, areas, rootReportId);
}

// 朝の繰り越し(仕様 5章「朝: 前日の未清掃を繰り越し、今日のボードを生成」)
// 毎日の箇所で前日に完了しなかったものを、今日のボードで「繰り越し」にする。いつからの繰り越しかを残す。
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
                         AND y.status IN ('pending', 'carried_over'))`,
    )
    .bind(yesterday, storeId, date, storeId, yesterday)
    .run();
  return res.meta.changes ?? 0;
}
