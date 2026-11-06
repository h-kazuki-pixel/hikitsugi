import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Frame } from "../components/Frame";
import { useEnter } from "../motion";
import { T } from "../timings";

// ロゴのマークが組み上がり、最後に lockup-dark の形になる。
// 下の図形はすべて docs/brand/hikitsugi-lockup-dark.svg から値をそのまま写したもの(描き直していない)。
// 動かすために要素ごとに分けているだけで、座標・色・パスは SVG と同じ。

const VIEW = { x: 12, y: 0, w: 196.5, h: 64 }; // lockup-dark の viewBox
const MARK_CENTER_X = 32; // 表紙 x=14〜50 の中心
const LOCKUP_CENTER_X = VIEW.x + VIEW.w / 2;
const BAND = { x: 22, y: 8, w: 7, h: 42 };
const COVER_BOTTOM = 50;

export const RM_1_1_logo: React.FC = () => {
  const t = T.RM_1_1_logo;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sec = frame / fps;

  // 1) 緑の表紙が spring で出る
  const cover = useEnter(t.cover, "normal");

  // 2) 白い帯が上から下へ伸びる(等速ではなく、ゆるく減速)
  const band = interpolate(sec, [t.band, t.band + t.bandLength], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  // 3) 帯がふちを越えたところで、しおりが落ちて止まる(少し弾む)
  const ribbon = useEnter(t.ribbon, "lively");

  // 4) 右にワードマークが入る。同時にマークが左へ寄って lockup の形になる
  const word = useEnter(t.wordmark, "soft");

  const shiftX = (LOCKUP_CENTER_X - MARK_CENTER_X) * (1 - word); // 最初は画面の中央、最後は lockup の位置

  const width = 1040;
  const height = width * (VIEW.h / VIEW.w);

  return (
    <Frame exit={t.exit}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <svg
          width={width}
          height={height}
          viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}
          style={{ overflow: "visible" }}
        >
          <defs>
            {/* しおりは表紙の下のふちから下にだけ見える */}
            <clipPath id="ribbon-clip">
              <rect x={BAND.x - 2} y={COVER_BOTTOM} width={BAND.w + 4} height={20} />
            </clipPath>
          </defs>

          <g transform={`translate(${shiftX} 0)`}>
            {/* 表紙 */}
            <g
              transform={`translate(32 26) scale(${0.6 + 0.4 * cover}) translate(-32 -26)`}
              opacity={Math.min(1, cover * 1.5)}
            >
              <rect x="14" y="2" width="36" height="48" rx="3" fill="#14A08D" />
            </g>

            {/* 白い帯(上から下へ) */}
            <rect x={BAND.x} y={BAND.y} width={BAND.w} height={BAND.h * band} fill="#FFFFFF" />

            {/* 紫のしおり */}
            <g clipPath="url(#ribbon-clip)">
              <g transform={`translate(0 ${-12 * (1 - ribbon)})`}>
                <path d="M22 50H29V62L25.5 58.5L22 62Z" fill="#A898F7" />
              </g>
            </g>

            {/* ワードマーク(lockup-dark.svg の <g> をそのまま) */}
            <g
              transform={`translate(${14 * (1 - word)} 0)`}
              opacity={Math.max(0, Math.min(1, word * 1.4))}
            >
              <g transform="translate(66 6.4) scale(0.7015)">
                <g fill="none" stroke="#FFFFFF" strokeWidth="6">
                  <path d="M3 4V40M3 29A10 10 0 0 1 23 29V40" />
                  <path d="M35 16V40" />
                  <path d="M47 4V40M47 31L61.5 18M54 24.7L63.5 39" />
                  <path d="M75 16V40" />
                  <path d="M83 19H98M89 7V31A6 6 0 0 0 95 37H99" />
                  <path d="M122.6 22.1A7 4.75 0 0 0 109 23.75A7 4.25 0 0 0 116 28A7 4.5 0 0 1 123 32.5A7 4.5 0 0 1 109.4 34" />
                  <path d="M135 16V27A10 10 0 0 0 155 27M155 16V40" />
                  <circle cx="176" cy="28" r="9" />
                  <path d="M185 16V44A9 9 0 0 1 176 53H171" />
                  <path d="M197 16V40" />
                </g>
                <rect x="32" y="5" width="6" height="6" fill="#FFFFFF" />
                <rect x="72" y="5" width="6" height="6" fill="#FFFFFF" />
                <path d="M194 3H200V13L197 10.5L194 13Z" fill="#A898F7" />
              </g>
            </g>
          </g>
        </svg>
      </AbsoluteFill>
    </Frame>
  );
};
