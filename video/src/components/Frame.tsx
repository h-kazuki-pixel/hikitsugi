import React from "react";
import { AbsoluteFill } from "remotion";
import { useExit, exitStyle } from "../motion";
import { C, FONT, MEDIUM } from "../theme";

// 地の色を敷いたカット(RM_*)。transparent のときは背景を敷かない(OV_*)
export const Frame: React.FC<{
  transparent?: boolean;
  exit: boolean;
  children: React.ReactNode;
}> = ({ transparent = false, exit, children }) => {
  const e = useExit(exit);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: transparent ? undefined : C.bg,
        color: C.text,
        fontFamily: FONT,
        fontWeight: MEDIUM,
        fontFeatureSettings: '"palt"',
      }}
    >
      <AbsoluteFill style={exitStyle(e)}>{children}</AbsoluteFill>
    </AbsoluteFill>
  );
};
