// 各カットの長さと、カットの中の「何秒で何が起きるか」をここに集める。
// 語りを録ったあとで秒を変えるので、ほかのファイルには秒を書かない。
// 値はすべて秒。フレーム数への変換は comps 側で fps を掛ける。

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;

// 出るときの長さ(フレーム数。6〜8)。exit: false のカットには掛けない
export const EXIT_FRAMES = 7;

export const T = {
  // 1. ロゴが組み上がる
  RM_1_1_logo: {
    duration: 3.0,
    cover: 0.0, // 緑の表紙が出る
    band: 0.45, // 白い帯が上から伸び始める
    bandLength: 0.6, // 帯が伸び切るまで
    ribbon: 1.05, // 帯がふちを越えたところでしおりが落ちる
    wordmark: 1.55, // 右にワードマークが入る(ここから lockup の形に寄る)
    hold: 0.5, // 最後の静止(ここでは動きを止める)
    exit: false,
  },

  // 2. 一行(語りの「答えが、自分の頭の中に…」に間に合うよう、後半は 1.2 秒以内に入る)
  RM_1_3_line: {
    duration: 5.98,
    first: 0.2, // 「答えが、」
    second: 1.0, // 「自分の頭の中にしか残っていない」
    exit: true,
  },

  // 3. 質問の数(数え上げは 0.8 秒で終え、「3件」は 3.5 秒までに入る。語りの「3件だけでした」は 6 秒台)
  RM_1_4_numbers: {
    duration: 8.0,
    label: 0.2, // 「質問」
    countStart: 0.4, // 0 から数え始める
    countLength: 0.8, // 114 まで
    period: 1.5, // 「約2年」
    arrow: 2.0, // 矢印が伸びる
    lead: 2.5, // 「その時点で書き残されていた答えで返せたのは」
    three: 3.3, // 「3件」
    note: 4.5, // 注記
    exit: true,
  },

  // 4. タイトル
  RM_1_5_title: {
    duration: 2.5,
    logo: 0.0,
    line: 0.45,
    exit: true,
  },

  // 5. 同じ一文
  RM_2_11_same_words: {
    duration: 6.28,
    photos: 0.15, // 写真2枚
    labels: 0.5, // 上の小さな札
    leftBox: 1.6, // 左の枠
    rightDelay: 0.6, // 右の枠は左の何秒あと
    glowPeriod: 1.4, // 光の明滅の周期
    exit: true,
  },

  // 6. 数字5つ
  RM_4_3_numbers: {
    duration: 9.11,
    first: 0.3, // 1つ目
    step: 0.42, // 2つ目以降の間隔
    top: 3.6, // 上の一行
    bottom: 4.6, // いちばん下の小さな一行
    exit: true,
  },

  // 7. 終わり
  RM_4_4_end: {
    duration: 3.0,
    logo: 0.0,
    url: 0.5,
    exit: true,
  },

  // 8. デモ用の札(背景透明)
  OV_demo_label: {
    duration: 85.88, // 収録の長さ(実測)
    exit: false,
  },

  // 9. 上の札(背景透明)。3本とも同じ秒
  OV_band: {
    duration: 4.0,
    stay: 3.2, // 降りきってからとどまる長さ。入りの約0.5秒 + 3.2秒で上に戻り始める
    enterLength: 0.5,
    exitLength: 0.3, // 上に戻るのにかかる秒
  },

  // 10. 凡例(背景透明)
  OV_2_12_legend: {
    duration: 15.33,
    first: 0.0,
    second: 9.21,
    exit: true,
  },

  // 11. 3行(背景透明)
  OV_1_2_three_lines: {
    duration: 17.23,
    lines: [0.0, 4.93, 11.38],
    exit: true,
  },
} as const;

// Remotion のコンポジション ID には _ が使えない(a-z A-Z 0-9 CJK と - だけ)。
// 部品の名前(ファイル名・書き出し名)は RM_1-1_logo のままにし、Studio 上の ID だけ _ を - に置き換える
export const compId = (name: string) => name.replace(/_/g, "-");

// 各カットの見どころ(静止画を書き出す秒)。scripts/render-all.mjs が読む。鍵は部品の名前
export const STILL_AT: Record<string, number> = {
  "RM_1-1_logo": 2.6,
  "RM_1-3_line": 3.0,
  "RM_1-4_numbers": 5.5,
  "RM_1-5_title": 1.8,
  "RM_2-11_same-words": 3.6,
  "RM_4-3_numbers": 6.5,
  "RM_4-4_end": 2.0,
  "OV_demo-label": 1.0,
  "OV_band_sat": 1.5,
  "OV_band_other-staff": 1.5,
  "OV_band_own-store": 1.5,
  "OV_2-12_legend": 10.5,
  "OV_1-2_three-lines": 12.5,
};
