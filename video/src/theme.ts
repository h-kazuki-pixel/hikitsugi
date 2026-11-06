import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

// 色は3色。例外はロゴのしおりの紫と、凡例の紫・緑(SCREEN_PATH)
export const C = {
  bg: "#15181D",
  text: "#EEEFF1",
  accent: "#14A08D",
  ribbon: "#A898F7",
  // 仮の画像の灰色(本物の静止画が来たら使わない)
  placeholder: "#3A3F47",
} as const;

// 判断経路の画面と同じ値(src/views/Layout.tsx の :root 変数から写した)。
// 紫 = --ai / --ai-wash / --ai-line、緑 = --brand / --hu-wash / --hu-line
export const SCREEN_PATH = {
  light: {
    ai: "#6E56CF",
    aiWash: "#F5F2FE",
    aiLine: "#DDD5FA",
    human: "#0F7B6C",
    humanWash: "#EAF5F1",
    humanLine: "#BFE0D6",
  },
  dark: {
    ai: "#A99BF0",
    aiWash: "#221C3A",
    aiLine: "#3D3360",
    human: "#3FB59F",
    humanWash: "#12302B",
    humanLine: "#1F4A41",
  },
} as const;

export type ScreenTheme = keyof typeof SCREEN_PATH;

// Noto Sans JP。public/fonts/ に scripts/fetch-fonts.mjs が落としたファイルを読む
export const FONT = "Noto Sans JP";
export const MEDIUM = 500;
export const BOLD = 700;

for (const weight of [MEDIUM, BOLD]) {
  loadFont({
    family: FONT,
    url: staticFile(`fonts/NotoSansJP-${weight}.ttf`),
    weight: String(weight),
    format: "truetype",
  });
}

// 文字の大きさ(見出し 72 以上、本文 48 以上、注記 28 以上)
export const SIZE = {
  display: 200,
  headline: 84,
  title: 64,
  body: 48,
  small: 36,
  note: 32,
  label: 28,
} as const;
