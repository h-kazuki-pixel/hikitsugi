// 店舗ページのルール欄: ルール候補(承認の一押し)と、有効なルールの一覧(由来つき)
// 面談(seed)で入れたルールと、引き継ぎ帳の「判断」の答えから承認で生まれたルールが同じ一覧に並ぶ(設計書 5-3)
import { ACTION_LABEL, RECIPIENT_LABEL, URGENCY_LABEL } from "../rules/structure";

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

export function RulesSection(props: { storeId: string; rules: RuleRow[] }) {
  const candidates = props.rules.filter((r) => r.status === "candidate");
  const active = props.rules.filter((r) => r.status === "active");
  return (
    <>
      {candidates.length > 0 && (
        <section class="card" aria-labelledby="candidates-title">
          <h2 id="candidates-title">ルール候補</h2>
          <ul class="rules">
            {candidates.map((r) => (
              <li>
                <p class="rule-q">{r.origin === "knowledge" ? "この答えをルールにしますか" : "この読み取りで有効にしますか"}</p>
                <p class="rule-text">
                  ルール{r.rule_no}「{r.natural_text}」
                </p>
                {r.origin === "knowledge" ? (
                  <dl class="rule-src">
                    <dt>質問</dt>
                    <dd>
                      {r.question}({md(r.asked_at)} {r.asked_by}さん)
                    </dd>
                    <dt>答え</dt>
                    <dd>
                      {r.answer}({md(r.answered_at)} {r.answered_by})
                    </dd>
                  </dl>
                ) : (
                  <dl class="rule-src">
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
                )}
                <div class="actions">
                  <form method="post" action={`/rules/${r.id}/approve`}>
                    <input type="hidden" name="store" value={props.storeId} />
                    <button type="submit" class="primary">
                      承認してルールにする
                    </button>
                  </form>
                  <form method="post" action={`/rules/${r.id}/reject`}>
                    <input type="hidden" name="store" value={props.storeId} />
                    <button type="submit">{r.origin === "knowledge" ? "引き継ぎ帳の答えだけにする" : "有効にしない"}</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section class="card" aria-labelledby="rules-title">
        <h2 id="rules-title">ルール一覧</h2>
        {active.length === 0 ? (
          <p class="empty">有効なルールはまだありません。</p>
        ) : (
          <ul class="rules">
            {active.map((r) => (
              <li>
                <p class="rule-text">
                  ルール{r.rule_no}「{r.natural_text}」{r.store_id === null && <span class="badge">全店</span>}
                </p>
                <p class="meta">由来: {originLabel(r)}</p>
              </li>
            ))}
          </ul>
        )}
        <form method="post" action={`/stores/${props.storeId}/rules`} class="add-rule">
          <label for="rule-text">ルールを足す(ふだんの言葉で)</label>
          <textarea id="rule-text" name="text" rows={2} maxlength={200} required placeholder="例: トイレの報告がない日が2日続いたら、副担当に知らせて" />
          <button type="submit">読み取ってもらう</button>
        </form>
      </section>
    </>
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
