// 承認待ち(設計書 5-4): スタッフ宛ての声かけの下書きと、ルール候補を一つのキューに並べる。
// スタッフに届く声かけと、ルールになる答えは、ここでオーナーが押すまで動かない
import { dayLabel } from "../lib/time";
import { ACTION_LABEL, RECIPIENT_LABEL, URGENCY_LABEL } from "../rules/structure";
import { IconCheck, IconClock, IconPlay } from "./icons";
import type { RuleRow } from "./RulesSection";

export type DraftRow = {
  id: string;
  body: string;
  recipient_name: string | null;
  created_at: string;
  finding_id?: string | null;
  evidence?: string | null; // 関係する検出の根拠(JSON)
};

// 承認した直後に「送信済み」として残す行(&sent=<id> で読む。DB は変えない)
export type SentRow = { id: string; body: string; recipient_name: string | null; decided_at: string | null; approved_by: string | null };

function hm(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

function reason(evidence: string | null | undefined): string | null {
  try {
    const e = JSON.parse(evidence ?? "{}") as { unlocked_at?: string; threshold_minutes?: number };
    if (e.unlocked_at) return `${hm(e.unlocked_at)} に入室、${e.threshold_minutes ?? 120}分たっても報告がない`;
  } catch {
    /* 省く */
  }
  return null;
}

export function ApprovalsSection(props: { storeId: string; drafts: DraftRow[]; candidates: RuleRow[]; closedDays?: string | null; sent?: SentRow | null }) {
  const n = props.drafts.length + props.candidates.length;
  return (
    <div class="pane">
      <div class="ph">
        <h1>承認待ち</h1>
        <span class="cnt">{n}件</span>
      </div>
      <p class="lead">スタッフに届く声かけと、ルールになる答えは、ここで承認するまで動きません。</p>

      {props.sent && (
        <div class="card">
          <div>
            <div class="who2">
              <span class="av2">{(props.sent.recipient_name ?? "ス").slice(0, 1)}</span>
              <b>{props.sent.recipient_name ?? "スタッフ"}さんへの声かけ</b><span class="kind">Slack の DM</span>
            </div>
            <div class="msg">{props.sent.body}</div>
          </div>
          <div class="acts">
            <div class="sent">
              <span class="pill ok">
                <IconCheck size={13} />
                送信済み
              </span>
              <span>
                {hm(props.sent.decided_at)} に{props.sent.approved_by ?? "オーナー"}が承認
              </span>
            </div>
          </div>
        </div>
      )}

      {n === 0 && !props.sent && <p class="empty">いま承認を待っているものはありません。</p>}

      {props.drafts.length > 0 && <h2 class="hint" style="margin:0 0 8px">承認待ちの下書き</h2>}
      {props.drafts.map((d) => {
        const why = reason(d.evidence);
        return (
          <div class="card">
            <div>
              <div class="who2">
                <span class="av2">{(d.recipient_name ?? "ス").slice(0, 1)}</span>
                <b>{d.recipient_name ?? "スタッフ"}さんへの声かけ</b><span class="kind">Slack の DM</span>
                <span class="when">
                  <IconClock size={13} />
                  {hm(d.created_at)} に下書き
                </span>
                {why && <span class="hint">{why}</span>}
              </div>
              <div class="msg">{d.body}</div>
              {d.finding_id && (
                <a class="lk" href={`/stores/${props.storeId}?view=findings&id=${d.finding_id}`}>
                  検出事項と判断経路を見る →
                </a>
              )}
            </div>
            <div class="acts">
              <form method="post" action={`/drafts/${d.id}/send`}>
                <input type="hidden" name="store" value={props.storeId} />
                <button type="submit" class="btn p">
                  <IconCheck />
                  承認して送る
                </button>
              </form>
              <form method="post" action={`/drafts/${d.id}/reject`}>
                <input type="hidden" name="store" value={props.storeId} />
                <button type="submit" class="btn">
                  送らない
                </button>
              </form>
            </div>
          </div>
        );
      })}

      {props.candidates.length > 0 && (
        <h2 class="hint" style="margin:0 0 8px">
          ルール候補
        </h2>
      )}
      {props.candidates.map((r) => (
        <CandidateCard storeId={props.storeId} r={r} closedDays={props.closedDays} />
      ))}
    </div>
  );
}

// ルール候補の1件(仕様 2章「ルールの入口は2つ」)。承認なしに有効にはならない
export function CandidateCard(props: { storeId: string; r: RuleRow; closedDays?: string | null }) {
  const r = props.r;
  const fromKnowledge = r.origin === "knowledge";
  return (
    <div class="card">
      <div>
        <div class="who2">
          {fromKnowledge ? (
            <>
              <span class="av2">{(r.asked_by ?? "ス").slice(0, 1)}</span>
              <b>{r.asked_by ?? "スタッフ"}さんの質問への答え</b><span class="kind">ルール候補</span>
              <span class="when">
                <IconClock size={13} />
                {dayLabel(r.asked_at, props.closedDays)}
              </span>
            </>
          ) : (
            <>
              <span class="av2">オ</span>
              <b>オーナーが足したルール</b><span class="kind">ルール候補</span>
            </>
          )}
        </div>
        <p class="rule-q" style="margin:0 0 6px">
          {fromKnowledge ? "この答えをルールにしますか" : "この読み取りで有効にしますか"}
        </p>
        <p class="rule-text" style="margin:0 0 8px">
          ルール{r.rule_no}「{r.natural_text}」
        </p>
        {fromKnowledge ? (
          <div class="qa">
            <span class="k">質問</span>
            <span class="q">
              {r.question}({dayLabel(r.asked_at, props.closedDays)} {r.asked_by}さん)
            </span>
            <span class="k">答え</span>
            <div class="msg">
              {r.answer}({dayLabel(r.answered_at, props.closedDays)} {r.answered_by})
            </div>
          </div>
        ) : (
          <div class="qa" style="grid-template-columns:1fr">
            <dl>
              <dt>読み取り</dt>
              <dd>{r.reading}</dd>
              <dt>動作</dt>
              <dd>
                {ACTION_LABEL[r.action]}
                {r.recipient ? ` / 宛先: ${RECIPIENT_LABEL[r.recipient]}` : ""} / {URGENCY_LABEL[r.urgency]}
              </dd>
              <dt>条件</dt>
              <dd>
                <code>{r.condition}</code>
              </dd>
              {r.unclear && (
                <>
                  <dt>未確定</dt>
                  <dd>{r.unclear}</dd>
                </>
              )}
            </dl>
          </div>
        )}
        <span class="hint">承認すると「ルール{r.rule_no}」になり、エージェントの判断の基準になります</span>
      </div>
      <div class="acts">
        <form method="post" action={`/rules/${r.id}/approve`}>
          <input type="hidden" name="store" value={props.storeId} />
          <button type="submit" class="btn p">
            <IconCheck />
            承認してルールにする
          </button>
        </form>
        <form method="post" action={`/rules/${r.id}/reject`}>
          <input type="hidden" name="store" value={props.storeId} />
          <button type="submit" class="btn">
            {fromKnowledge ? "引き継ぎ帳の答えだけにする" : "有効にしない"}
          </button>
        </form>
      </div>
    </div>
  );
}

export const DRAFTS_QUERY = `
  SELECT d.id, d.body, s.display_name AS recipient_name, d.created_at, d.finding_id, f.evidence
    FROM drafts d LEFT JOIN staff s ON s.id = d.recipient_staff_id
    LEFT JOIN findings f ON f.id = d.finding_id
   WHERE d.store_id = ? AND d.status = 'pending'
   ORDER BY d.created_at`;

export const SENT_DRAFT_QUERY = `
  SELECT d.id, d.body, s.display_name AS recipient_name, d.decided_at, o.display_name AS approved_by
    FROM drafts d LEFT JOIN staff s ON s.id = d.recipient_staff_id
    LEFT JOIN staff o ON o.id = d.approved_by_staff_id
   WHERE d.id = ? AND d.store_id = ? AND d.status = 'sent'`;

// デモ用の操作(撮影用。demo 環境でだけ出す): 入室を模擬する / 夜の突き合わせを今動かす / 朝の定時を今動かす
export function DemoPanel(props: { storeId: string; staff: { id: string; display_name: string }[] }) {
  return (
    <div class="pane">
      <div class="ph">
        <h1>デモの操作</h1>
        <span class="pill demo">demo のみ</span>
      </div>
      <p class="lead">撮影のための操作です。鍵の解錠の代わりに入室を記録し、定時の処理をいま動かします(Cron と同じくキューに積むだけ)。</p>
      <form method="post" action={`/demo/stores/${props.storeId}/entry`} class="demo-row">
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
        <button type="submit" class="btn">
          入室を記録する
        </button>
      </form>
      <form method="post" action={`/demo/stores/${props.storeId}/night`} class="demo-row">
        <label>夜の突き合わせ(ふだんは 21:30 に自動で動く)</label>
        <button type="submit" class="btn">
          <IconPlay />
          いま動かす
        </button>
      </form>
      <form method="post" action={`/demo/stores/${props.storeId}/morning`} class="demo-row">
        <label>朝の定時(ふだんは 7:00 に自動で動く。全店の要約を1通、オーナーの DM に送る。知らせることがなければ送らない)</label>
        <button type="submit" class="btn">
          <IconPlay />
          朝の定時をいま動かす
        </button>
      </form>
    </div>
  );
}
