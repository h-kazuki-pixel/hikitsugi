// 判断経路の各行を「誰が出したか」で分ける(店舗ページの判断経路の表の「担い手」の欄)。
//
// ソースで確かめた割り当て(25 の表のとおり):
// - Claude(ツール): 夜の突き合わせで claude-opus-5-5 のツール使用ループが呼んだ読み取り(night.ts の read_entries ほか)。
//   行を書いているのはコードだが、呼ぶと決めたのは Claude
// - Claude: Claude が読んで判断した行。見えたこと(rulecheck / structure の evidence)、ルールNに該当(Claude が選んだ rule_no)、
//   報告なし(draft_nudge で Claude が選んだ入室。事実の文はコードが書き、理由は Claude の一文)、分類と構造化、トラブルとして検出、
//   声かけ文を下書き(本文は Claude)
// - 人の言葉: 元になった質問 / オーナーの答え(記録から原文のまま引く。Claude には書かせない)
// - 仕組み: それ以外(投稿を受け取る / 対応 / 取り下げ / 既定値 / ルールの由来 / 入室0件で終えた行 など)。コードが書いた事実

export type PathRole = "ai_tool" | "ai" | "human" | "system";

export const ROLE_LABEL: Record<PathRole, string> = {
  ai_tool: "Claude(ツール)",
  ai: "Claude",
  human: "人の言葉",
  system: "仕組み",
};

const AI_TOOL_STEPS = new Set(["入室記録を読む", "報告を読む", "名簿を見る", "ルール一覧を参照"]);
const AI_STEPS = new Set(["見えたこと", "報告なし", "分類と構造化", "トラブルとして検出", "声かけ文を下書き"]);
const HUMAN_STEPS = new Set(["元になった質問", "オーナーの答え"]);

export function roleOf(step: string, detail = ""): PathRole {
  // 入室が0件のときは Claude を呼ばずにコードが書く行(night.ts)
  if (step === "入室記録を読む" && detail.includes("Claude は呼ばない")) return "system";
  if (AI_TOOL_STEPS.has(step)) return "ai_tool";
  if (AI_STEPS.has(step) || /^ルール\d+に該当$/.test(step)) return "ai";
  if (HUMAN_STEPS.has(step)) return "human";
  return "system";
}

// ルールの動作のうち、実際に実行まで動く種類(ソースで確かめた):
// - draft: 夜の突き合わせの draft_nudge(night.ts)
// - judgment_basis: 写真・本文の照合(process.ts)と引き継ぎ帳の答え(knowledge/search.ts)
// それ以外(知らせる・回数に数えない・1件に畳む・義務回数を変える)は、登録・一覧・エージェントへの提示まで(README「限界」)
const EXECUTED_ACTIONS = new Set(["draft", "judgment_basis"]);

export function isExecutedAction(action: string): boolean {
  return EXECUTED_ACTIONS.has(action);
}
