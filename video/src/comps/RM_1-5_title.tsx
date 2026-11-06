import React from "react";
import { AbsoluteFill } from "remotion";
import { Frame } from "../components/Frame";
import { Lockup } from "../components/Lockup";
import { enterStyle, useEnter } from "../motion";
import { SIZE } from "../theme";
import { T } from "../timings";

export const RM_1_5_title: React.FC = () => {
  const t = T.RM_1_5_title;
  const logo = useEnter(t.logo, "soft");
  const line = useEnter(t.line);

  return (
    <Frame exit={t.exit}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", gap: 72 }}>
        <div style={{ opacity: Math.min(1, logo * 1.5), scale: String(0.92 + 0.08 * logo) }}>
          <Lockup width={900} />
        </div>
        <div style={{ fontSize: SIZE.title, lineHeight: 1.4, whiteSpace: "nowrap", ...enterStyle(line) }}>
          休みの日の一言が、次のスタッフへの答えになる
        </div>
      </AbsoluteFill>
    </Frame>
  );
};
