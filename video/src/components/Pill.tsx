import React from "react";
import { C, FONT, MEDIUM } from "../theme";

// 収録画面の上に重ねる札。地の色の角丸
export const Pill: React.FC<{
  fontSize: number;
  bold?: boolean;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ fontSize, bold = false, style, children }) => {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 16,
        backgroundColor: C.bg,
        color: C.text,
        fontFamily: FONT,
        fontWeight: bold ? 700 : MEDIUM,
        fontSize,
        lineHeight: 1.3,
        padding: `${Math.round(fontSize * 0.45)}px ${Math.round(fontSize * 0.9)}px`,
        borderRadius: Math.round(fontSize * 0.45),
        whiteSpace: "nowrap",
        fontFeatureSettings: '"palt"',
        ...style,
      }}
    >
      {children}
    </div>
  );
};
