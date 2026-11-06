import React from "react";
import { Img, staticFile } from "remotion";

// docs/brand/hikitsugi-lockup-dark.svg をそのまま表示する(public/brand に複製したもの)
// 元の viewBox は 196.5 × 64
export const LOCKUP_RATIO = 64 / 196.5;

export const Lockup: React.FC<{ width: number; style?: React.CSSProperties }> = ({ width, style }) => {
  return (
    <Img
      src={staticFile("brand/hikitsugi-lockup-dark.svg")}
      style={{ width, height: width * LOCKUP_RATIO, display: "block", ...style }}
    />
  );
};
