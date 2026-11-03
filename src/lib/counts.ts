// 実稼働の数字を数えるための記録(migrations 0011)。本文は持たない。記録に失敗しても本来の処理は止めない

export type CountEvent = {
  kind: "recheck_flagged" | "recheck_cleared" | "handoff_answered" | "handoff_waited" | "handoff_asked";
  store_id?: string | null;
  board_date?: string | null;
  area_id?: string | null;
  basis?: "photo" | "staff_word" | "report" | null;
  ref?: string | null;
};

export async function recordCount(db: D1Database, e: CountEvent): Promise<void> {
  await db
    .prepare("INSERT INTO count_events (id, kind, store_id, board_date, area_id, basis, ref) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), e.kind, e.store_id ?? null, e.board_date ?? null, e.area_id ?? null, e.basis ?? null, e.ref ?? null)
    .run()
    .catch((err: unknown) => console.error(`数えるための記録に失敗しました(${e.kind}): ${err instanceof Error ? err.message : String(err)}`));
}
