// 店舗ページのルール一覧(由来つき)と「ルールを足す」。候補の承認は承認待ち(DraftsSection の CandidateCard)にある
// 面談(seed)で入れたルールと、引き継ぎ帳の「判断」の答えから承認で生まれたルールが同じ一覧に並ぶ(設計書 5-3)
import { dayLabel } from "../lib/time";
import type { ACTION_LABEL, RECIPIENT_LABEL, URGENCY_LABEL } from "../rules/structure";
import { isExecutedAction } from "./path-roles";
import { ruleAppliesSql, scopeLabel, scopeOf, scopeStoresSql } from "../rules/scope";
import { IconCheck } from "./icons";

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
  scope_store_ids?: string | null; // rule_stores の店(カンマ区切り。なければ NULL)
};

export type StoreOption = { id: string; name: string };

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
// 適用する店のチェックボックス(候補の承認と、あとから変えるときの両方で使う)。いちばん上に「全店(これから増える店も)」
export function ScopeChoice(props: { stores: StoreOption[]; checked: Set<string>; allChecked: boolean; idPrefix: string }) {
  return (
    <fieldset class="scope">
      <legend>適用する店</legend>
      <label>
        <input type="checkbox" name="stores" value="all" checked={props.allChecked} />
        全店(これから増える店も)
      </label>
      {props.stores.map((s) => (
        <label>
          <input type="checkbox" name="stores" value={s.id} checked={props.checked.has(s.id)} />
          {s.name}
        </label>
      ))}
    </fieldset>
  );
}

export function RulesSection(props: { storeId: string; rules: RuleRow[]; closedDays?: string | null; stores?: StoreOption[] }) {
  const stores = props.stores ?? [];
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
                <span class="pill gray">{scopeLabel(scopeOf(r), stores)}</span>
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
              {stores.length > 0 && (
                <details class="scope-edit">
                  <summary>適用する店を変える</summary>
                  <form method="post" action={`/rules/${r.id}/stores`}>
                    <input type="hidden" name="store" value={props.storeId} />
                    <ScopeChoice stores={stores} checked={new Set(scopeOf(r).kind === "stores" ? (scopeOf(r) as { storeIds: string[] }).storeIds : [])} allChecked={scopeOf(r).kind === "all"} idPrefix={r.id} />
                    <button type="submit" class="btn">
                      <IconCheck />
                      保存する
                    </button>
                  </form>
                </details>
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
         ${scopeStoresSql("r")} AS scope_store_ids,
         k.question, k.asked_at, ks.display_name AS asked_by,
         a.answer, a.answered_at, s.display_name AS answered_by
    FROM rules r
    LEFT JOIN knowledge k ON k.id = r.origin_knowledge_id
    LEFT JOIN staff ks ON ks.id = k.asked_by_staff_id
    LEFT JOIN knowledge_answers a ON a.id = r.origin_answer_id
    LEFT JOIN staff s ON s.id = a.answered_by_staff_id
   WHERE ${ruleAppliesSql("r")} AND r.status IN ('candidate', 'active')
   ORDER BY r.rule_no`;
// RULES_QUERY は店の id を2回 bind する
