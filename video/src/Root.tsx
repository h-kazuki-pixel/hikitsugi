import React from "react";
import { Composition, Folder } from "remotion";
import { FPS, HEIGHT, T, WIDTH, compId } from "./timings";
import { RM_1_1_logo } from "./comps/RM_1-1_logo";
import { RM_1_3_line } from "./comps/RM_1-3_line";
import { RM_1_4_numbers } from "./comps/RM_1-4_numbers";
import { RM_1_5_title } from "./comps/RM_1-5_title";
import { RM_2_11_same_words, sameWordsDefaultProps } from "./comps/RM_2-11_same-words";
import { RM_4_3_numbers, numbersDefaultProps } from "./comps/RM_4-3_numbers";
import { RM_4_4_end } from "./comps/RM_4-4_end";
import { OV_demo_label } from "./comps/OV_demo-label";
import { BANDS, BandKey, OV_band } from "./comps/OV_band";
import { OV_2_12_legend, legendDefaultProps } from "./comps/OV_2-12_legend";
import { OV_1_2_three_lines } from "./comps/OV_1-2_three-lines";

const frames = (seconds: number) => Math.round(seconds * FPS);
const size = { fps: FPS, width: WIDTH, height: HEIGHT };

// 背景透明の書き出し既定(ProRes)。4444 のプロファイルは scripts/render-all.mjs が CLI で渡す。
// ここで defaultProResProfile を指定すると、VP9 の WebM で書き出すときに弾かれるので書かない
const transparent = () => ({
  defaultCodec: "prores" as const,
  defaultVideoImageFormat: "png" as const,
  defaultPixelFormat: "yuva444p10le" as const,
});

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Folder name="RM">
        <Composition id={compId("RM_1-1_logo")} component={RM_1_1_logo} durationInFrames={frames(T.RM_1_1_logo.duration)} {...size} />
        <Composition id={compId("RM_1-3_line")} component={RM_1_3_line} durationInFrames={frames(T.RM_1_3_line.duration)} {...size} />
        <Composition
          id={compId("RM_1-4_numbers")}
          component={RM_1_4_numbers}
          durationInFrames={frames(T.RM_1_4_numbers.duration)}
          {...size}
        />
        <Composition id={compId("RM_1-5_title")} component={RM_1_5_title} durationInFrames={frames(T.RM_1_5_title.duration)} {...size} />
        <Composition
          id={compId("RM_2-11_same-words")}
          component={RM_2_11_same_words}
          durationInFrames={frames(T.RM_2_11_same_words.duration)}
          defaultProps={sameWordsDefaultProps}
          {...size}
        />
        <Composition
          id={compId("RM_4-3_numbers")}
          component={RM_4_3_numbers}
          durationInFrames={frames(T.RM_4_3_numbers.duration)}
          defaultProps={numbersDefaultProps}
          {...size}
        />
        <Composition id={compId("RM_4-4_end")} component={RM_4_4_end} durationInFrames={frames(T.RM_4_4_end.duration)} {...size} />
      </Folder>

      <Folder name="OV">
        <Composition
          id={compId("OV_demo-label")}
          component={OV_demo_label}
          durationInFrames={frames(T.OV_demo_label.duration)}
          calculateMetadata={transparent}
          {...size}
        />
        {(Object.keys(BANDS) as BandKey[]).map((key) => (
          <Composition
            key={key}
            id={compId(`OV_band_${key}`)}
            component={OV_band}
            durationInFrames={frames(T.OV_band.duration)}
            defaultProps={{ text: BANDS[key] }}
            calculateMetadata={transparent}
            {...size}
          />
        ))}
        <Composition
          id={compId("OV_2-12_legend")}
          component={OV_2_12_legend}
          durationInFrames={frames(T.OV_2_12_legend.duration)}
          defaultProps={legendDefaultProps}
          calculateMetadata={transparent}
          {...size}
        />
        <Composition
          id={compId("OV_1-2_three-lines")}
          component={OV_1_2_three_lines}
          durationInFrames={frames(T.OV_1_2_three_lines.duration)}
          calculateMetadata={transparent}
          {...size}
        />
      </Folder>
    </>
  );
};
