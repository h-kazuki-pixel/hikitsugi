// 店舗ページのルール一覧(由来つき)と「ルールを足す」。候補の承認は承認待ち(DraftsSection の CandidateCard)にある
// 面談(seed)で入れたルールと、引き継ぎ帳の「判断」の答えから承認で生まれたルールが同じ一覧に並ぶ(設計書 5-3)
import { dayLabel } from "../lib/time";
import type { ACTION_LABEL, RECIPIENT_LABEL, URGENCY_LABEL } from "../rules/structure";
import { isExecutedAction } from "./path-roles";

export type RuleRow = {
  id: string;
  rule_no: number;
  natural_text: string;
  status: "candidate" | "active" | "inactive";
  origin: "interview" | "owner_ui" | "knowledge";
  store_id: string | null;
  question: string | null;
  asked_at: string | null;
  asked_by: string | null;
  answer: string | null;
  answered_at: string | null;
  answered_by: string | null;
  action: keyof typeof ACTION_LABEL;
  recipient: keyof typeof RECIPIENT_LABEL | null;
  urgency: keyof typeof URGENCY_LABEL;
  condition: string;
  reading: string | null;
  unclear: string | null;
};

function md(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export function originLabel(r: RuleRow): string {
  if (r.origin === "interview") return "立ち上げ面談";
  if (r.origin === "owner_ui") return "オーナーが追加";
  return `引き継ぎ帳(${md(r.asked_at)} ${r.asked_by ?? ""}さんの質問、${md(r.answered_at)} ${r.answered_by ?? ""}の回答)`;
}

// closedDays: 店舗の休業日(日付に「休業日」を添えるため)
export function RulesSection(props: { storeId: string; rules: RuleRow[]; closedDays?: string | null }) {
  const active = props.rules.filter((r) => r.status === "active");
  return (
    <div class="pane">
      <div class="ph">
        <h1>ルール</h1>
        <span class="cnt">有効 {active.length}件</span>
      </div>
      <p class="lead">立ち上げ面談で決めたものと、スタッフの質問への答えから生まれたものが、同じ一覧に並びます。</p>
      {active.length === 0 ? (
        <p class="empty">有効なルールはまだありません。</p>
      ) : (
        <ul class="rules">
          {active.map((r) => (
            <li>
              <p class="rule-text">
                <span>
                  ルール{r.rule_no}「{r.natural_text}」
                </span>
                {r.store_id === null && <span class="pill gray">全店</span>}
                {!isExecutedAction(r.action) && <span class="pill gray">登録のみ(まだ実行しない)</span>}
              </p>
              {r.origin === "knowledge" ? (
                // スタッフの質問から生まれたルールは、面談のルールと見分けられるように目立たせる
                <p class="origin-key">
                  スタッフの質問から: {dayLabel(r.asked_at, props.closedDays)} {r.asked_by ?? "スタッフ"}さんの質問 → {dayLabel(r.answered_at, props.closedDays)}{" "}
                  {r.answered_by ?? "オーナー"}の答え
                </p>
              ) : (
                <p class="origin">由来: {originLabel(r)}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      <form method="post" action={`/stores/${props.storeId}/rules`} class="add-rule">
        <label for="rule-text">ルールを足す(ふだんの言葉で)</label>
        <textarea id="rule-text" name="text" rows={2} maxlength={200} required placeholder="例: トイレの報告がない日が2日続いたら、副担当に知らせて" />
        <button type="submit" class="btn">
          読み取ってもらう
        </button>
        <span class="hint">Claude が読み取った内容を承認待ちに出します。承認するまで有効になりません。</span>
      </form>
    </div>
  );
}

export const RULES_QUERY = `
  SELECT r.id, r.rule_no, r.natural_text, r.status, r.origin, r.store_id,
         r.action, r.recipient, r.urgency, r.condition, r.reading, r.unclear,
         k.question, k.asked_at, ks.display_name AS asked_by,
         a.answer, a.answered_at, s.display_name AS answered_by
    FROM rules r
    LEFT JOIN knowledge k ON k.id = r.origin_knowledge_id
    LEFT JOIN staff ks ON ks.id = k.asked_by_staff_id
    LEFT JOIN knowledge_answers a ON a.id = r.origin_answer_id
    LEFT JOIN staff s ON s.id = a.answered_by_staff_id
   WHERE (r.store_id = ? OR r.store_id IS NULL) AND r.status IN ('candidate', 'active')
   ORDER BY r.rule_no`;
