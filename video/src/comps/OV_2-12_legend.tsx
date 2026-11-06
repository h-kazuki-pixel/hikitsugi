import React from "react";
import { AbsoluteFill } from "remotion";
import { Frame } from "../components/Frame";
import { Pill } from "../components/Pill";
import { useEnter } from "../motion";
import { SCREEN_PATH, ScreenTheme, SIZE } from "../theme";
import { T } from "../timings";

// 右上の凡例2行。紫・緑は判断経路の画面と同じ値(theme.ts の SCREEN_PATH)。
// screenTheme は収録した画面が明るい表示なら "light"、暗い表示なら "dark"
export type LegendProps = { screenTheme: ScreenTheme };
export const legendDefaultProps: LegendProps = { screenTheme: "light" };

const Swatch: React.FC<{ fill: string; line: string; ink: string }> = ({ fill, line, ink }) => (
  <span
    style={{
      display: "inline-block",
      width: 56,
      height: 36,
      borderRadius: 8,
      backgroundColor: fill,
      border: `2px solid ${line}`,
      boxSizing: "border-box",
      position: "relative",
    }}
  >
    <span
      style={{
        position: "absolute",
        left: 10,
        right: 10,
        top: 14,
        height: 6,
        borderRadius: 3,
        backgroundColor: ink,
      }}
    />
  </span>
);

export const OV_2_12_legend: React.FC<LegendProps> = ({ screenTheme }) => {
  const t = T.OV_2_12_legend;
  const c = SCREEN_PATH[screenTheme];
  const p1 = useEnter(t.first);
  const p2 = useEnter(t.second);

  const rowStyle = (p: number): React.CSSProperties => ({
    opacity: Math.min(1, p * 1.5),
    translate: `0px ${(1 - p) * -16}px`,
  });

  return (
    <Frame transparent exit={t.exit}>
      <AbsoluteFill style={{ padding: 48, alignItems: "flex-end" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 14 }}>
          <Pill fontSize={SIZE.note} style={rowStyle(p1)}>
            <Swatch fill={c.aiWash} line={c.aiLine} ink={c.ai} />
            <span>紫 = Claude が読み取ったこと</span>
          </Pill>
          <Pill fontSize={SIZE.note} style={rowStyle(p2)}>
            <Swatch fill={c.humanWash} line={c.humanLine} ink={c.human} />
            <span>緑 = 人が書いた言葉</span>
          </Pill>
        </div>
      </AbsoluteFill>
    </Frame>
  );
};
