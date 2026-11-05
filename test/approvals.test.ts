// 承認待ちの下書きの右に出す理由: 分数は判断経路と同じ実際の経過時間(checked_at − unlocked_at)
import { describe, expect, it } from "vitest";
import { draftReason } from "../src/views/DraftsSection";

describe("承認待ちの理由", () => {
  it("突き合わせた時刻と解錠時刻の差を分で出す(閾値の 120分ではない)", () => {
    const evidence = JSON.stringify({ entry_id: "e1", unlocked_at: "2026-11-05T02:41:00Z", threshold_minutes: 120, checked_at: "2026-11-05T05:11:00Z" });
    expect(draftReason(evidence)).toBe("11:41 に入室、150分たっても報告がない");
  });
  it("checked_at がなければ分数を出さない", () => {
    expect(draftReason(JSON.stringify({ unlocked_at: "2026-11-05T02:41:00Z", threshold_minutes: 120 }))).toBe("11:41 に入室、そのあとの報告がない");
  });
  it("解錠時刻がない・読めないときは省く", () => {
    expect(draftReason(JSON.stringify({ report_id: "x" }))).toBeNull();
    expect(draftReason("not json")).toBeNull();
  });
});
