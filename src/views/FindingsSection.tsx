// 店舗ページの検出事項: 何を見つけたかと、判断経路(どの投稿を読み、どのルールに照らし、ルールはどこから来たか)
// 「見張る」画面にしない: 人を並べて評価せず、起きたことと根拠だけを出す(設計書 2章)

export type FindingRow = {
  id: string;
  kind: string;
  detected_at: string;
  reasoning_path: string; // JSON [{ step, detail }]
};

const KIND_LABEL: Record<string, string> = {
  trouble: "トラブル",
  rule_match: "ルールに該当",
  unreported: "報告が届いていない",
  uncleaned: "未清掃",
};

function when(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hh}:${mm}`;
}

function steps(json: string): { step: string; detail: string }[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? (v as { step: string; detail: string }[]) : [];
  } catch {
    return [];
  }
}

export function FindingsSection(props: { findings: FindingRow[] }) {
  return (
    <section class="card" aria-labelledby="findings-title">
      <h2 id="findings-title">検出事項</h2>
      {props.findings.length === 0 ? (
        <p class="empty">いま知らせることはありません。</p>
      ) : (
        <ul class="rules">
          {props.findings.map((f) => (
            <li>
              <p class="rule-text">
                {KIND_LABEL[f.kind] ?? f.kind} <span class="meta" style="display:inline">{when(f.detected_at)}</span>
              </p>
              <details open={f.kind === "rule_match"}>
                <summary>判断経路</summary>
                <ol class="path">
                  {steps(f.reasoning_path).map((s) => (
                    <li>
                      <strong>{s.step}</strong> {s.detail}
                    </li>
                  ))}
                </ol>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export const FINDINGS_QUERY = `
  SELECT id, kind, detected_at, reasoning_path
    FROM findings
   WHERE store_id = ? AND status = 'active'
   ORDER BY detected_at DESC
   LIMIT 10`;
