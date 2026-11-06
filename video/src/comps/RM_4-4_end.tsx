import React from "react";
import { AbsoluteFill } from "remotion";
import { Frame } from "../components/Frame";
import { Lockup } from "../components/Lockup";
import { enterStyle, useEnter } from "../motion";
import { SIZE } from "../theme";
import { T } from "../timings";

export const RM_4_4_end: React.FC = () => {
  const t = T.RM_4_4_end;
  const logo = useEnter(t.logo, "soft");
  const url = useEnter(t.url);

  return (
    <Frame exit={t.exit}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", gap: 64 }}>
        <div style={{ opacity: Math.min(1, logo * 1.5), scale: String(0.92 + 0.08 * logo) }}>
          <Lockup width={900} />
        </div>
        <div style={{ fontSize: SIZE.small, opacity: 0.8, letterSpacing: 1, ...enterStyle(url, 16) }}>
          github.com/h-kazuki-pixel/hikitsugi
        </div>
      </AbsoluteFill>
    </Frame>
  );
};
