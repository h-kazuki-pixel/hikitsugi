// 備品切れ(報告から)。オーナールール3「備品切れは、ダッシュボードに出すだけでいい。通知はいらない」(実店舗 11/4)
//
// 発注はこれまでどおり発注リクエストフォームで受ける(Notion。設計書 10章のとおり読み書きしない)。
// ここは、報告の写真や文から拾った備品切れを並べて、フォームの発注と見比べるための一覧。通知はしない

export type SupplyRow = { id: string; sent_at: string; supplies_out: string; who: string | null };

const DAYS = 7;

// 直近7日の報告のうち、備品切れがあったもの(最新の版で見る。聞き返しで直った品目はそちらが出る)
export const SUPPLIES_QUERY = `
  SELECT r.id, r.sent_at, r.supplies_out, coalesce(p.display_name, s.display_name) AS who
    FROM reports_current r
    LEFT JOIN staff p ON p.id = r.performer_staff_id
    LEFT JOIN staff s ON s.slack_user_id = r.sender_ref
   WHERE r.store_id = ? AND r.sent_at >= ? AND r.supplies_out IS NOT NULL AND r.supplies_out <> '[]'
   ORDER BY r.sent_at DESC
   LIMIT 20`;

export const suppliesSince = (now: Date = new Date()) => new Date(now.getTime() - DAYS * 24 * 60 * 60 * 1000).toISOString();

// 「11/4 18:25」(JST)
function jstLabel(iso: string): string {
  const d = new Date(Date.parse(iso) + 9 * 60 * 60 * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function items(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
  } catch {
    return [];
  }
}

export function SuppliesSection(props: { rows: SupplyRow[] }) {
  const rows = props.rows.map((r) => ({ ...r, items: items(r.supplies_out) })).filter((r) => r.items.length > 0);
  return (
    <section class="card" aria-labelledby="supplies-title">
      <h2 id="supplies-title">
        備品切れ(報告から) <span class="meta" style="display:inline">直近{DAYS}日</span>
      </h2>
      <p class="meta">発注はこれまでどおり発注リクエストフォームから。ここは見比べるための一覧で、通知はしません。</p>
      {rows.length === 0 ? (
        <p class="empty">直近{DAYS}日の報告に、備品切れはありません。</p>
      ) : (
        <ul class="rules">
          {rows.map((r) => (
            <li>
              <p class="rule-q">
                {jstLabel(r.sent_at)} {r.who ? `${r.who}さんの報告` : "報告"}
              </p>
              <p class="rule-text">{r.items.join("、")}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
