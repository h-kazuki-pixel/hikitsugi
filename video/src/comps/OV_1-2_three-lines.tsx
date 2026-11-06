import React from "react";
import { AbsoluteFill } from "remotion";
import { Frame } from "../components/Frame";
import { Pill } from "../components/Pill";
import { useEnter } from "../motion";
import { SIZE } from "../theme";
import { T } from "../timings";

const LINES = [
  "誰 = 無人自習室のオーナーと学生スタッフ",
  "何 = 店を回すための確認と答え",
  "問題 = 全部が一人に集まり、残らない",
] as const;

// 自撮りの右下に3行を順に出す。先に出た行は動かず、下に足されていく
export const OV_1_2_three_lines: React.FC = () => {
  const t = T.OV_1_2_three_lines;
  const p0 = useEnter(t.lines[0]);
  const p1 = useEnter(t.lines[1]);
  const p2 = useEnter(t.lines[2]);
  const ps = [p0, p1, p2];

  return (
    <Frame transparent exit={t.exit}>
      <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "flex-end", padding: 64 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 16 }}>
          {LINES.map((line, i) => (
            <Pill
              key={line}
              fontSize={SIZE.small}
              style={{ opacity: Math.min(1, ps[i] * 1.5), translate: `0px ${(1 - ps[i]) * 24}px` }}
            >
              {line}
            </Pill>
          ))}
        </div>
      </AbsoluteFill>
    </Frame>
  );
};
