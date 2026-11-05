// 判断経路の担い手の割り当て(25 の表)と、実行まで動くルールの種類(README「限界」)
import { describe, expect, it } from "vitest";
import { isExecutedAction, roleOf, ROLE_LABEL } from "../src/views/path-roles";

describe("判断経路の担い手", () => {
  it("夜の突き合わせでツール使用ループが呼んだ読み取りは Claude(ツール)", () => {
    for (const step of ["入室記録を読む", "報告を読む", "名簿を見る", "ルール一覧を参照"]) expect(roleOf(step), step).toBe("ai_tool");
    expect(ROLE_LABEL.ai_tool).toBe("Claude(ツール)");
  });
  it("Claude が読んで判断した行は Claude", () => {
    for (const step of ["見えたこと", "ルール6に該当", "ルール12に該当", "報告なし", "分類と構造化", "トラブルとして検出", "声かけ文を下書き"]) expect(roleOf(step), step).toBe("ai");
  });
  it("記録から原文のまま引く行は 人の言葉", () => {
    for (const step of ["元になった質問", "オーナーの答え"]) expect(roleOf(step), step).toBe("human");
  });
  it("コードが書いた事実は 仕組み。入室0件で Claude を呼ばずに終えた行もそう", () => {
    for (const step of ["投稿を受け取る", "対応", "取り下げ", "既定値", "ルールの由来", "知らない手順"]) expect(roleOf(step), step).toBe("system");
    expect(roleOf("入室記録を読む", "今日の入室は0件。突き合わせるものがないので終える(Claude は呼ばない)")).toBe("system");
  });
});

describe("実行まで動くルールの種類", () => {
  it("下書きを作る(夜の突き合わせ)と 判断の基準にする(照合・引き継ぎ帳)だけ。ほかは登録のみ", () => {
    expect(isExecutedAction("draft")).toBe(true);
    expect(isExecutedAction("judgment_basis")).toBe(true);
    for (const a of ["notify", "exclude_from_count", "merge", "change_quota"]) expect(isExecutedAction(a), a).toBe(false);
  });
});
