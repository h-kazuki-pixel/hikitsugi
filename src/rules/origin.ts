// ルールの由来の表記(判断経路に出す。仕様 2章「判断時の扱い」)

export function md(iso: string | null): string {
  if (!iso) return "?";
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export type RuleOriginFields = {
  origin: string;
  question: string | null;
  asked_at: string | null;
  asked_by: string | null;
  answer: string | null;
  answered_at: string | null;
  answered_by: string | null;
};

export function ruleOrigin(r: RuleOriginFields): string {
  if (r.origin === "knowledge") {
    return `引き継ぎ帳: ${md(r.asked_at)} ${r.asked_by ?? "スタッフ"}さんの質問「${r.question ?? ""}」→ ${md(r.answered_at)} ${r.answered_by ?? "オーナー"}の回答「${r.answer ?? ""}」`;
  }
  return r.origin === "interview" ? "立ち上げ面談" : "オーナーが追加";
}
