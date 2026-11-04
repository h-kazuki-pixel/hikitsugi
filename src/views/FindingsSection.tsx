// 店舗ページの検出事項: 何を見つけたかと、判断経路(どの投稿を読み、どのルールに照らし、ルールはどこから来たか)
// 「見張る」画面にしない: 人を並べて評価せず、起きたことと根拠だけを出す(設計書 2章)

export type FindingRow = {
  id: string;
  kind: string;
  detected_at: string;
  reasoning_path: string; // JSON [{ step, detail, key? }]
  evidence?: string | null; // JSON(報告の送信時刻・入室の解錠時刻など)
  target_name?: string | null; // 対象のスタッフの呼び名
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

function steps(json: string): { step: string; detail: string; key?: boolean }[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? (v as { step: string; detail: string; key?: boolean }[]) : [];
  } catch {
    return [];
  }
}

function evidenceOf(json: string | null | undefined): { sent_at?: string; unlocked_at?: string } {
  try {
    return (JSON.parse(json ?? "{}") as { sent_at?: string; unlocked_at?: string }) ?? {};
  } catch {
    return {};
  }
}

// 見出しは、数秒映るだけで何が起きたかを一行で読めるように(11/4 見直し)
//   ルールに該当 → 「ルール6に該当 — はるとさんの報告(11/4 16:36)」
//   報告が届いていない → 「そうたさんの報告が届いていない(11/4 14:34 に入室)」
export function findingTitle(f: FindingRow): string {
  const e = evidenceOf(f.evidence);
  const name = f.target_name ? `${f.target_name}さん` : null;
  if (f.kind === "rule_match") {
    const rule = steps(f.reasoning_path).find((s) => /^ルール\d+に該当$/.test(s.step))?.step ?? KIND_LABEL.rule_match!;
    return name && e.sent_at ? `${rule} — ${name}の報告(${when(e.sent_at)})` : `${rule}(${when(f.detected_at)})`;
  }
  if (f.kind === "unreported" && name) {
    return `${name}の報告が届いていない${e.unlocked_at ? `(${when(e.unlocked_at)} に入室)` : ""}`;
  }
  return `${KIND_LABEL[f.kind] ?? f.kind}(${when(f.detected_at)})`;
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
              <p class="rule-text">{findingTitle(f)}</p>
              <details open={f.kind === "rule_match" || f.kind === "unreported"}>
                <summary>判断経路</summary>
                <ol class="path">
                  {steps(f.reasoning_path).map((s) => (
                    <li class={s.key ? "key" : undefined}>
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
  SELECT f.id, f.kind, f.detected_at, f.reasoning_path, f.evidence, s.display_name AS target_name
    FROM findings f LEFT JOIN staff s ON s.id = f.target_staff_id
   WHERE f.store_id = ? AND f.status = 'active'
   ORDER BY f.detected_at DESC
   LIMIT 10`;
