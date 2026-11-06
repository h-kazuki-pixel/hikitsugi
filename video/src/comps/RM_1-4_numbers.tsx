import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Frame } from "../components/Frame";
import { enterStyle, useEnter } from "../motion";
import { BOLD, C, SIZE } from "../theme";
import { T } from "../timings";

const TOTAL = 114;

export const RM_1_4_numbers: React.FC = () => {
  const t = T.RM_1_4_numbers;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sec = frame / fps;

  const label = useEnter(t.label);
  const count = Math.round(
    interpolate(sec, [t.countStart, t.countStart + t.countLength], [0, TOTAL], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    }),
  );
  const numberIn = useEnter(t.countStart, "soft");
  const unit = useEnter(t.countStart + t.countLength, "lively"); // 数え終わった瞬間に「件」
  const period = useEnter(t.period);
  const arrow = useEnter(t.arrow, "soft");
  const lead = useEnter(t.lead);
  const three = useEnter(t.three, "lively");
  const note = useEnter(t.note);

  const arrowLength = 220;

  return (
    <Frame exit={t.exit}>
      {/* 左: 質問 114件 / 約2年 */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "flex-start", paddingLeft: 160 }}>
        <div style={{ width: 640 }}>
          <div style={{ fontSize: SIZE.body, ...enterStyle(label) }}>質問</div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              marginTop: -8,
              ...enterStyle(numberIn, 20),
            }}
          >
            <span
              style={{
                fontSize: SIZE.display,
                fontWeight: BOLD,
                lineHeight: 1.1,
                fontVariantNumeric: "tabular-nums",
                minWidth: 3 * SIZE.display * 0.58,
                textAlign: "right",
              }}
            >
              {count}
            </span>
            <span style={{ fontSize: SIZE.title, fontWeight: BOLD, ...enterStyle(unit, 16) }}>件</span>
          </div>
          <div style={{ fontSize: SIZE.small, opacity: 0.85, ...enterStyle(period) }}>約2年</div>
        </div>
      </AbsoluteFill>

      {/* 中: 矢印 */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <svg
          width={arrowLength + 40}
          height={60}
          viewBox={`0 0 ${arrowLength + 40} 60`}
          style={{ position: "absolute", left: 860, top: 540 - 30, opacity: Math.min(1, arrow * 2) }}
        >
          <line
            x1={0}
            y1={30}
            x2={arrowLength * arrow}
            y2={30}
            stroke={C.text}
            strokeWidth={8}
            strokeLinecap="round"
          />
          <path
            d="M-22 -22 L0 0 L-22 22"
            transform={`translate(${arrowLength * arrow} 30)`}
            fill="none"
            stroke={C.text}
            strokeWidth={8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </AbsoluteFill>

      {/* 右: その時点で書き残されていた答えで返せたのは → 3件(主役。「3」は「114」と同じ大きさ) */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "flex-start", paddingLeft: 1180 }}>
        <div style={{ width: 640 }}>
          <div style={{ fontSize: SIZE.body, lineHeight: 1.25, ...enterStyle(lead) }}>
            その時点で
            <br />
            書き残されていた
            <br />
            答えで返せたのは
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              marginTop: 0,
              color: C.accent,
              opacity: Math.min(1, three * 1.5),
              scale: String(0.7 + 0.3 * three),
              transformOrigin: "left center",
            }}
          >
            <span style={{ fontSize: SIZE.display, fontWeight: BOLD, lineHeight: 1.1 }}>3</span>
            <span style={{ fontSize: SIZE.title, fontWeight: BOLD }}>件</span>
          </div>
        </div>
      </AbsoluteFill>

      {/* 注記。数字のすぐ下(下から 180px は字幕のために空ける) */}
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 800 }}>
        <div style={{ fontSize: SIZE.note, opacity: 0.8, ...enterStyle(note, 16) }}>
          質問が来たその時点に、書き残されていた答えだけで確かめた
        </div>
      </AbsoluteFill>
    </Frame>
  );
};
