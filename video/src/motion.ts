import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { EXIT_FRAMES } from "./timings";

// 入りの spring。damping 14〜18 で、行き過ぎが少しだけ見える
export const SPRING = {
  soft: { damping: 18, stiffness: 110, mass: 1 },
  normal: { damping: 16, stiffness: 120, mass: 1 },
  lively: { damping: 14, stiffness: 130, mass: 1 },
} as const;

export type SpringKind = keyof typeof SPRING;

// at 秒から始まる spring の進み(0 → 1、少し行き過ぎてから 1 に落ち着く)
export function useEnter(atSeconds: number, kind: SpringKind = "normal"): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({
    frame: frame - Math.round(atSeconds * fps),
    fps,
    config: SPRING[kind],
  });
}

// 出るときの残り(1 → 0)。カットの最後の EXIT_FRAMES フレームで短く消える
export function useExit(enabled: boolean): number {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  if (!enabled) return 1;
  return interpolate(frame, [durationInFrames - EXIT_FRAMES, durationInFrames - 1], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.quad),
  });
}

// 入りの spring を「下から少し上がりながら現れる」スタイルにする
export function enterStyle(p: number, distance = 28): React.CSSProperties {
  return {
    opacity: Math.min(1, p * 1.6),
    translate: `0px ${(1 - p) * distance}px`,
  };
}

// 出るときの共通スタイル
export function exitStyle(e: number): React.CSSProperties {
  return {
    opacity: e,
    translate: `0px ${(1 - e) * -12}px`,
  };
}
