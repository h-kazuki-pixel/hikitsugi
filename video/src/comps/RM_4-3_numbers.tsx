import React from "react";
import { AbsoluteFill } from "remotion";
import { Frame } from "../components/Frame";
import { enterStyle, useEnter } from "../motion";
import { BOLD, C, SIZE } from "../theme";
import { STATS } from "../stats";
import { T } from "../timings";

export type NumbersProps = {
  days: number;
  commits: number;
  prs: number;
  tests: number;
  handWrittenLines: number;
};

export const numbersDefaultProps: NumbersProps = { ...STATS };

const Stat: React.FC<{
  value: number;
  unit: string;
  caption?: string;
  accent?: boolean;
  p: number;
}> = ({ value, unit, caption, accent = false, p }) => {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: 340,
        color: accent ? C.accent : C.text,
        opacity: Math.min(1, p * 1.5),
        translate: `0px ${(1 - p) * 36}px`,
        scale: String(0.85 + 0.15 * p),
      }}
    >
      <div style={{ fontSize: SIZE.note, height: SIZE.note * 1.5, opacity: 0.9, whiteSpace: "nowrap" }}>
        {caption ?? ""}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" }}>
        <span style={{ fontSize: 150, fontWeight: BOLD, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>
          {value}
        </span>
        <span style={{ fontSize: SIZE.body, fontWeight: BOLD }}>{unit}</span>
      </div>
    </div>
  );
};

export const RM_4_3_numbers: React.FC<NumbersProps> = ({ days, commits, prs, tests, handWrittenLines }) => {
  const t = T.RM_4_3_numbers;
  const at = (i: number) => t.first + t.step * i;
  const p0 = useEnter(at(0), "lively");
  const p1 = useEnter(at(1), "lively");
  const p2 = useEnter(at(2), "lively");
  const p3 = useEnter(at(3), "lively");
  const p4 = useEnter(at(4), "lively");
  const top = useEnter(t.top);
  const bottom = useEnter(t.bottom);

  return (
    <Frame exit={t.exit}>
      {/* 上の一行 */}
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 150 }}>
        <div style={{ fontSize: SIZE.title, whiteSpace: "nowrap", ...enterStyle(top) }}>
          ハッカソンのあとも、この店で使い続ける
        </div>
      </AbsoluteFill>

      {/* 数字5つ */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 24, marginTop: 40 }}>
          <Stat value={days} unit="日" p={p0} />
          <Stat value={commits} unit="コミット" p={p1} />
          <Stat value={prs} unit="PR" p={p2} />
          <Stat value={tests} unit="テスト" p={p3} />
          <Stat value={handWrittenLines} unit="行" caption="手で書いたコード" accent p={p4} />
        </div>
      </AbsoluteFill>

      {/* いちばん下の小さな一行 */}
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 72 }}>
        <div style={{ fontSize: SIZE.note, opacity: 0.8, ...enterStyle(bottom, 16) }}>
          人がいない店なら、同じ形で
        </div>
      </AbsoluteFill>
    </Frame>
  );
};
