// 店舗ページの検出事項: 一覧(左 260px)と詳細(右)の2ペイン。詳細には判断経路を見出し行つきの表で出す(30)
// 「見張る」画面にしない: 人を並べて評価せず、起きたことと根拠だけを出す(設計書 2章)
// step と detail の文言は変えない(台本・README がこの文言)。担い手の割り当ては path-roles.ts
import { IconCamera, IconClock, IconUser } from "./icons";
import { roleOf, ROLE_LABEL } from "./path-roles";

export type FindingRow = {
  id: string;
  kind: string;
  detected_at: string;
  reasoning_path: string; // JSON [{ step, detail, key? }]
  evidence?: string | null; // JSON(報告の送信時刻・入室の解錠時刻など)
  target_name?: string | null; // 対象のスタッフの呼び名
  rule_nos?: string | null; // 関係するルールの番号(カンマ区切り。一覧のピル用)
};

const KIND_LABEL: Record<string, string> = {
  trouble: "トラブル",
  rule_match: "ルールに該当",
  unreported: "報告が届いていない",
  uncleaned: "未清掃",
};

const JST = 9 * 60 * 60 * 1000;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function when(iso: string): string {
  const d = new Date(new Date(iso).getTime() + JST);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hh}:${mm}`;
}
function hm(iso: string): string {
  return when(iso).split(" ")[1]!;
}
// 「11/6(金)14:12」
export function whenWithWeekday(iso: string): string {
  const d = new Date(new Date(iso).getTime() + JST);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAYS[d.getUTCDay()]})${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function steps(json: string): { step: string; detail: string; key?: boolean }[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? (v as { step: string; detail: string; key?: boolean }[]) : [];
  } catch {
    return [];
  }
}

type Evidence = { sent_at?: string; unlocked_at?: string; report_id?: string | null };
function evidenceOf(json: string | null | undefined): Evidence {
  try {
    return (JSON.parse(json ?? "{}") as Evidence) ?? {};
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

// 一覧の行の題(時刻は横に別で出すので題からは外す)
function shortTitle(f: FindingRow): string {
  const name = f.target_name ? `${f.target_name}さん` : null;
  if (f.kind === "rule_match") {
    const rule = steps(f.reasoning_path).find((s) => /^ルール\d+に該当$/.test(s.step))?.step ?? KIND_LABEL.rule_match!;
    return name ? `${rule} — ${name}の報告` : rule;
  }
  return findingTitle(f);
}

// 写真の枚数は「投稿を受け取る」の detail(「写真1枚、」)から読む(写真そのものは保存していない)
function photoCount(f: FindingRow): number | null {
  const m = steps(f.reasoning_path)[0]?.detail.match(/写真(\d+)枚/);
  return m ? Number(m[1]) : null;
}

function ruleNos(f: FindingRow): number[] {
  const fromSteps = steps(f.reasoning_path)
    .map((s) => s.step.match(/^ルール(\d+)に該当$/)?.[1])
    .filter((x): x is string => !!x)
    .map(Number);
  const fromRow = (f.rule_nos ?? "").split(",").filter(Boolean).map(Number);
  return [...new Set([...fromSteps, ...fromRow])];
}

const ROLE_CLASS = { ai_tool: "ai", ai: "ai", human: "hu", system: "sys" } as const;

export function FindingsSection(props: { storeId: string; findings: FindingRow[]; selectedId?: string | null }) {
  const sel = props.findings.find((f) => f.id === props.selectedId) ?? props.findings[0] ?? null;
  if (props.findings.length === 0) {
    return (
      <div class="pane">
        <div class="ph">
          <h1>検出事項</h1>
        </div>
        <p class="empty">いま知らせることはありません。</p>
      </div>
    );
  }
  return (
    <div class="body">
      <nav class="list" aria-label="検出の一覧">
        <div class="lh">
          <span>有効な検出 {props.findings.length}件</span>
          <span>新しい順</span>
        </div>
        {props.findings.map((f) => {
          const photos = photoCount(f);
          const e = evidenceOf(f.evidence);
          return (
            <a class={`it${sel && f.id === sel.id ? " on" : ""}`} href={`/stores/${props.storeId}?view=findings&id=${f.id}`} aria-current={sel && f.id === sel.id ? "true" : undefined}>
              <p class="t">{shortTitle(f)}</p>
              <div class="m">
                <span>
                  <IconClock size={13} />
                  {hm(f.kind === "rule_match" && e.sent_at ? e.sent_at : f.detected_at)}
                </span>
                {photos != null && photos > 0 && (
                  <span>
                    <IconCamera size={13} />
                    写真{photos}枚
                  </span>
                )}
                {ruleNos(f).map((no) => (
                  <span class={`pill rule${f.kind === "rule_match" ? " k" : ""}`}>ルール{no}</span>
                ))}
              </div>
            </a>
          );
        })}
      </nav>
      {sel && <FindingDetail f={sel} />}
    </div>
  );
}

export function FindingDetail(props: { f: FindingRow }) {
  const f = props.f;
  const e = evidenceOf(f.evidence);
  const rows = steps(f.reasoning_path);
  const photos = photoCount(f);
  const at = f.kind === "rule_match" && e.sent_at ? e.sent_at : f.kind === "unreported" && e.unlocked_at ? e.unlocked_at : f.detected_at;
  return (
    <article class="det" aria-labelledby="finding-title">
      <h1 id="finding-title">{findingTitle(f)}</h1>
      <div class="meta">
        {f.target_name && (
          <span>
            <IconUser size={14} />
            {f.target_name}さん
          </span>
        )}
        <span>
          <IconClock size={14} />
          {whenWithWeekday(at)}
        </span>
        {photos != null && photos > 0 && (
          <span>
            <IconCamera size={14} />
            写真{photos}枚
          </span>
        )}
      </div>
      <div class="th">
        <h2>判断経路</h2>
        <div class="leg">
          <span>
            <i class="ai" />
            Claude が読んで判断
          </span>
          <span>
            <i class="hu" />
            人の言葉(原文のまま)
          </span>
        </div>
      </div>
      <table class="path">
        <thead>
          <tr>
            <th>#</th>
            <th>担い手</th>
            <th>手順</th>
            <th>内容</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s, i) => {
            const role = roleOf(s.step, s.detail);
            const cls = ROLE_CLASS[role];
            return (
              <tr class={s.key ? "key" : undefined}>
                <td class="no">{i + 1}</td>
                <td class="who">
                  <span class={`pill ${cls}`}>{ROLE_LABEL[role]}</span>
                </td>
                <td class="step">{s.step}</td>
                <td>{role === "system" ? s.detail : <span class={`box ${cls}`}>{s.detail}</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </article>
  );
}

export const FINDINGS_QUERY = `
  SELECT f.id, f.kind, f.detected_at, f.reasoning_path, f.evidence, s.display_name AS target_name,
         (SELECT group_concat(r.rule_no) FROM rules r WHERE instr(f.rule_ids, '"' || r.id || '"') > 0) AS rule_nos
    FROM findings f LEFT JOIN staff s ON s.id = f.target_staff_id
   WHERE f.store_id = ? AND f.status = 'active'
   ORDER BY f.detected_at DESC
   LIMIT 10`;
