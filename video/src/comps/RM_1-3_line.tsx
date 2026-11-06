import React from "react";
import { AbsoluteFill } from "remotion";
import { Frame } from "../components/Frame";
import { enterStyle, useEnter } from "../motion";
import { BOLD, C, SIZE } from "../theme";
import { T } from "../timings";

// 一行「答えが、自分の頭の中にしか残っていない」。前半が先に、後半があとから入る
export const RM_1_3_line: React.FC = () => {
  const t = T.RM_1_3_line;
  const first = useEnter(t.first);
  const second = useEnter(t.second);

  return (
    <Frame exit={t.exit}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            fontSize: SIZE.headline,
            fontWeight: BOLD,
            lineHeight: 1.4,
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ display: "inline-block", ...enterStyle(first) }}>答えが、</span>
          <span style={{ display: "inline-block", ...enterStyle(second) }}>
            <span style={{ color: C.accent }}>自分の頭の中</span>にしか残っていない
          </span>
        </div>
      </AbsoluteFill>
    </Frame>
  );
};
