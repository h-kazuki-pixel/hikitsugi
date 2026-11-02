// 承認待ちの下書き(設計書 5-4「スタッフ宛ての声かけ・催促は Claude が下書きし、オーナーが一押しで送る。送らない選択もできる」)

export type DraftRow = { id: string; body: string; recipient_name: string | null; created_at: string };

export function DraftsSection(props: { storeId: string; drafts: DraftRow[] }) {
  if (props.drafts.length === 0) return null;
  return (
    <section class="card" aria-labelledby="drafts-title">
      <h2 id="drafts-title">承認待ちの下書き</h2>
      <ul class="rules">
        {props.drafts.map((d) => (
          <li>
            <p class="rule-q">{d.recipient_name ?? "スタッフ"}さんへの声かけ(Slack の DM で届きます)</p>
            <p class="draft-body">{d.body}</p>
            <div class="actions">
              <form method="post" action={`/drafts/${d.id}/send`}>
                <input type="hidden" name="store" value={props.storeId} />
                <button type="submit" class="primary">
                  承認して送る
                </button>
              </form>
              <form method="post" action={`/drafts/${d.id}/reject`}>
                <input type="hidden" name="store" value={props.storeId} />
                <button type="submit">送らない</button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export const DRAFTS_QUERY = `
  SELECT d.id, d.body, s.display_name AS recipient_name, d.created_at
    FROM drafts d LEFT JOIN staff s ON s.id = d.recipient_staff_id
   WHERE d.store_id = ? AND d.status = 'pending'
   ORDER BY d.created_at`;

// デモ用の操作(撮影用。demo 環境でだけ出す): 入室を模擬する / 夜の突き合わせを今動かす
export function DemoPanel(props: { storeId: string; staff: { id: string; display_name: string }[] }) {
  return (
    <section class="card" aria-labelledby="demo-title">
      <h2 id="demo-title">
        デモの操作 <span class="badge demo">demo のみ</span>
      </h2>
      <form method="post" action={`/demo/stores/${props.storeId}/entry`} class="add-rule">
        <label for="demo-staff">入室を模擬する(鍵の解錠の代わり)</label>
        <select id="demo-staff" name="staff">
          {props.staff.map((s) => (
            <option value={s.id}>{s.display_name}</option>
          ))}
        </select>
        <select name="minutes_ago" aria-label="いつ入室したか">
          <option value="0">いま</option>
          <option value="150">2時間半前</option>
        </select>
        <button type="submit">入室を記録する</button>
      </form>
      <form method="post" action={`/demo/stores/${props.storeId}/night`} class="add-rule">
        <label>夜の突き合わせ(ふだんは 21:30 に自動で動く)</label>
        <button type="submit">いま動かす</button>
      </form>
    </section>
  );
}
