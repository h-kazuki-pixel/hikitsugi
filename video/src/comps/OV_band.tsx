import React from "react";
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Frame } from "../components/Frame";
import { SPRING } from "../motion";
import { BOLD, C, FONT } from "../theme";
import { T } from "../timings";

// 画面の上の帯。上から spring で降りて、とどまり、上に戻る。背景は透明
export const BANDS = {
  wed: "水曜日",
  sat: "土曜日・休業日",
  "next-week": "次の週",
  "own-store": "11/4 から、自分の店で",
} as const;

export type BandKey = keyof typeof BANDS;

const HEIGHT = 112;

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

  const y = -HEIGHT * (1 - down) - HEIGHT * up;

  return (
    <Frame transparent exit={false}>
      <AbsoluteFill style={{ alignItems: "stretch" }}>
        <div
          style={{
            height: HEIGHT,
            backgroundColor: C.bg,
            color: C.text,
            fontFamily: FONT,
            fontWeight: BOLD,
            fontSize: 52,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
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
