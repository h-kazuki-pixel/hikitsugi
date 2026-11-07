import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Frame } from "../components/Frame";
import { enterStyle, useEnter } from "../motion";
import { C, SIZE } from "../theme";
import { T } from "../timings";

// 画面写真の中の「同じ一文」の位置に、緑の枠が出て光る。
// 枠の位置は、写真の幅・高さに対する割合(0〜1)で受ける。
//   例: 1600×1000 の写真で、左上 (200, 430) から幅 900・高さ 60 の範囲なら
//       { x: 200/1600, y: 430/1000, w: 900/1600, h: 60/1000 }
// src が null のときは仮の灰色の画像を出す。public/ に置いた写真は "shots/xxx.png" のように渡す。

export type Box = { x: number; y: number; w: number; h: number };
export type Photo = { src: string | null; box: Box };
export type SameWordsProps = {
  left: Photo;
  right: Photo;
  // 写真の表示サイズ(2枚とも同じ)。スクリーンショットの縦横比に合わせて変える
  photoWidth: number;
  photoHeight: number;
};

export const sameWordsDefaultProps: SameWordsProps = {
  left: { src: null, box: { x: 0.08, y: 0.46, w: 0.7, h: 0.09 } },
  right: { src: null, box: { x: 0.1, y: 0.58, w: 0.7, h: 0.09 } },
  photoWidth: 840,
  photoHeight: 560,
};

const Shot: React.FC<{
  photo: Photo;
  label: string;
  width: number;
  height: number;
  photoIn: number;
  labelIn: number;
  boxIn: number;
  glow: number;
}> = ({ photo, label, width, height, photoIn, labelIn, boxIn, glow }) => {
  const b = photo.box;
  return (
    <div style={{ width, display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ fontSize: SIZE.label, opacity: 0.85, ...enterStyle(labelIn, 12) }}>{label}</div>
      <div
        style={{
          position: "relative",
          width,
          height,
          borderRadius: 16,
          overflow: "hidden",
          backgroundColor: C.placeholder,
          opacity: Math.min(1, photoIn * 1.5),
          scale: String(0.96 + 0.04 * photoIn),
        }}
      >
        {photo.src ? (
          <Img src={staticFile(photo.src)} style={{ width, height, objectFit: "cover", display: "block" }} />
        ) : (
          // 仮の灰色の画像。本物の静止画が来たら消える
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: SIZE.label,
              color: C.text,
              opacity: 0.35,
            }}
          >
            画面写真(仮)
          </div>
        )}
        {/* 緑の枠 */}
        <div
          style={{
            position: "absolute",
            left: b.x * width,
            top: b.y * height,
            width: b.w * width,
            height: b.h * height,
            border: `5px solid ${C.accent}`,
            borderRadius: 10,
            boxShadow: `0 0 ${18 + 22 * glow}px ${2 + 4 * glow}px ${C.accent}${Math.round(0x40 + 0x60 * glow)
              .toString(16)
              .padStart(2, "0")}`,
            opacity: Math.min(1, boxIn * 1.5),
            scale: String(0.8 + 0.2 * boxIn),
            boxSizing: "border-box",
          }}
        />
      </div>
    </div>
  );
};

export const RM_2_11_same_words: React.FC<SameWordsProps> = ({ left, right, photoWidth, photoHeight }) => {
  const t = T.RM_2_11_same_words;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sec = frame / fps;

  const photoL = useEnter(t.photos, "soft");
  const photoR = useEnter(t.photos + 0.1, "soft");
  const labels = useEnter(t.labels);
  const boxL = useEnter(t.leftBox, "lively");
  const boxR = useEnter(t.leftBox + t.rightDelay, "lively");

  // 光の明滅(枠が出てからゆっくり)
  const glowOf = (since: number) =>
    sec < since ? 0 : 0.5 + 0.5 * Math.sin(((sec - since) / t.glowPeriod) * Math.PI * 2 - Math.PI / 2);

  return (
    <Frame exit={t.exit}>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 80 }}>
          <Shot
            photo={left}
            label="オーナーの答え(あおいさんへ)"
            width={photoWidth}
            height={photoHeight}
            photoIn={photoL}
            labelIn={labels}
            boxIn={boxL}
            glow={glowOf(t.leftBox)}
          />
          <Shot
            photo={right}
            label="はるとさんへの返事"
            width={photoWidth}
            height={photoHeight}
            photoIn={photoR}
            labelIn={labels}
            boxIn={boxR}
            glow={glowOf(t.leftBox + t.rightDelay)}
          />
        </div>
      </AbsoluteFill>
    </Frame>
  );
};
