import React from "react";
import { AbsoluteFill } from "remotion";
import { Frame } from "../components/Frame";
import { Pill } from "../components/Pill";
import { useEnter } from "../motion";
import { SIZE } from "../theme";
import { T } from "../timings";

// 左上の小さな札。入りだけ spring、あとは動かない。背景は透明
export const OV_demo_label: React.FC = () => {
  const t = T.OV_demo_label;
  const p = useEnter(0, "normal");
  return (
    <Frame transparent exit={t.exit}>
      <AbsoluteFill style={{ padding: 48, alignItems: "flex-start" }}>
        <Pill fontSize={SIZE.label} style={{ opacity: Math.min(1, p * 1.5), translate: `0px ${(1 - p) * -20}px` }}>
          デモ用の店とスタッフ(架空)
        </Pill>
      </AbsoluteFill>
    </Frame>
  );
};
