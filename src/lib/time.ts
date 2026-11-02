// 日付は JST で切る(仕様 3章)。Workers の実行環境は UTC なので、オフセットを足して計算する
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

export type JstDate = { iso: string; weekday: number; label: string };

export function jstDate(now: Date = new Date()): JstDate {
  const d = new Date(now.getTime() + JST_OFFSET_MS);
  const iso = d.toISOString().slice(0, 10);
  const weekday = d.getUTCDay();
  const label = `${d.getUTCMonth() + 1}月${d.getUTCDate()}日(${WEEKDAYS[weekday]})`;
  return { iso, weekday, label };
}
