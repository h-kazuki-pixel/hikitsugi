// 質問の CSV と答えの CSV を「元の行」で結ぶ(架空データ)
import { describe, expect, it } from "vitest";
import { joinQuestionsAndAnswers } from "../src/replay/join";
import { parseCsv } from "../src/replay/replay";

const questions = [
  "分類,出所,日時,曜日区分,スタッフ,返信まで(分),メッセージ",
  "備品,Slack,2026/07/04 10:00,休日,デモスタッフA,3,<@U0DEMO01|デモオーナー> 掃除機の紙パックはどこ?",
  '備品,Slack,2026/07/06 19:30,平日18時以降,デモスタッフB,5,"モップの替え, ありますか?"',
  "備品,Slack,2026/07/07 04:02,平日,デモスタッフA,9,ゴミ袋の予備は?",
].join("\n");
const answers = [
  "元の行,出所,質問日時,回答した人(役割),回答本文,種類,備考",
  "2,Slack,2026/07/04 10:00,代表,流しの下の引き出しの中。,再利用できる答え,",
  "3,Slack,2026/07/06 19:30,代表,今から持っていきます,その場の対応,",
  "4,Slack,2026/07/07 17:12,,,答えなし,日時を直した",
].join("\n");

describe("質問と答えを結ぶ", () => {
  it("元の行で結び、種類・曜日区分を列にする。日時は答えの CSV を使い、答えの時刻は質問の時刻で近似する", () => {
    const { csv, stats } = joinQuestionsAndAnswers(questions, answers);
    expect(stats).toEqual({ questions: 3, joined: 3, reusable: 1, situational: 1, no_answer: 1, holiday: 1, off_hours: 2, date_differs: 1 });
    const rows = parseCsv(csv);
    expect(rows.map((r) => [r.id, r.reusable, r.holiday, r.off_hours])).toEqual([
      ["r2", true, true, true],
      ["r3", false, false, true],
      ["r4", false, false, false],
    ]);
    expect(rows[0]).toMatchObject({ question: "@ 掃除機の紙パックはどこ?", answer: "流しの下の引き出しの中。", answered_at: rows[0]!.asked_at });
    expect(rows[1]!.question).toBe("モップの替え, ありますか?");
    expect(rows[2]).toMatchObject({ asked_at: "2026-07-07T08:12:00.000Z", answer: null, answered_at: null });
  });

  it("結べない行・読めない種類は止める", () => {
    expect(() => joinQuestionsAndAnswers(questions, answers.split("\n").slice(0, 3).join("\n"))).toThrow("元の行 4");
    expect(() => joinQuestionsAndAnswers(questions, answers.replace("その場の対応", "不明"))).toThrow("種類");
  });
});
