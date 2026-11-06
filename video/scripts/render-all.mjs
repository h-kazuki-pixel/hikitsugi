#!/usr/bin/env node
// すべての部品を書き出す。
//   RM_* → H.264 の mp4(video/out/)
//   OV_* → 背景が透明な ProRes 4444 の mov(video/out/)
//   各カットの見どころ 1 枚 → PNG(video/out/stills/)。秒は src/timings.ts の STILL_AT
//
//   node scripts/render-all.mjs                 全部
//   node scripts/render-all.mjs --stills-only   静止画だけ
//   node scripts/render-all.mjs RM_1-1_logo     指定したものだけ(複数可)

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FPS, STILL_AT, compId } from "../src/timings.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const stillsOnly = args.includes("--stills-only");
const only = args.filter((a) => !a.startsWith("--"));

const ids = Object.keys(STILL_AT).filter((id) => only.length === 0 || only.includes(id));

mkdirSync(join(root, "out", "stills"), { recursive: true });

const common = ["--log=warn"];
if (process.env.REMOTION_BROWSER_EXECUTABLE) {
  common.push(`--browser-executable=${process.env.REMOTION_BROWSER_EXECUTABLE}`);
}

function run(cmd) {
  console.log(`$ npx remotion ${cmd.join(" ")}`);
  execFileSync("npx", ["remotion", ...cmd], { cwd: root, stdio: "inherit" });
}

for (const name of ids) {
  const id = compId(name); // Studio 上の ID(_ を - に)。書き出す名前は部品の名前のまま
  const isOverlay = name.startsWith("OV_");
  if (!stillsOnly) {
    if (isOverlay) {
      run([
        "render",
        id,
        `out/${name}.mov`,
        "--codec=prores",
        "--prores-profile=4444",
        "--pixel-format=yuva444p10le",
        "--image-format=png",
        ...common,
      ]);
    } else {
      run(["render", id, `out/${name}.mp4`, "--codec=h264", ...common]);
    }
  }
  const frame = Math.round(STILL_AT[name] * FPS);
  run(["still", id, `out/stills/${name}.png`, `--frame=${frame}`, "--image-format=png", ...common]);
}

console.log(`done: ${ids.length} composition(s)`);
