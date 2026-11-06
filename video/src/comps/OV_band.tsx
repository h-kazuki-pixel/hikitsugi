import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Frame } from "../components/Frame";
import { SPRING } from "../motion";
import { BOLD, C, FONT } from "../theme";
import { T } from "../timings";

// 画面の上の中央に出す角丸の札。上から spring で降りて、とどまり、上に戻る。背景は透明
export const BANDS = {
  wed: "水曜日",
  sat: "土曜日・休業日",
  "next-week": "次の週",
  "own-store": "11/4 から、自分の店で",
} as const;

export type BandKey = keyof typeof BANDS;

const TOP = 48; // 降りきったときの上からの位置
const FONT_SIZE = 48;
const PAD_Y = 22;
const HEIGHT = FONT_SIZE * 1.3 + PAD_Y * 2;
const HIDDEN_Y = -(TOP + HEIGHT + 8); // 画面の上に隠れる位置

export const OV_band: React.FC<{ text: string }> = ({ text }) => {
  const t = T.OV_band;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const down = spring({ frame, fps, config: SPRING.normal });
  const leaveStart = Math.round((t.enterLength + t.stay) * fps);
  const up = interpolate(frame, [leaveStart, leaveStart + Math.round(t.exitLength * fps)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.cubic),
  });

  const y = HIDDEN_Y * (1 - down) + HIDDEN_Y * up;

  return (
    <Frame transparent exit={false}>
      <AbsoluteFill style={{ alignItems: "center", paddingTop: TOP }}>
        <div
          style={{
            backgroundColor: C.bg,
            color: C.text,
            fontFamily: FONT,
            fontWeight: BOLD,
            fontSize: FONT_SIZE,
            lineHeight: 1.3,
            padding: `${PAD_Y}px 40px`,
            borderRadius: 20,
            translate: `0px ${y}px`,
            whiteSpace: "nowrap",
          }}
        >
          {text}
        </div>
      </AbsoluteFill>
    </Frame>
  );
};
