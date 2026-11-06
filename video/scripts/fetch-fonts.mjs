#!/usr/bin/env node
// Noto Sans JP(Medium 500 / Bold 700)を Google Fonts から public/fonts/ に落とす。
// 書き出しのたびに百数十の分割ファイルを取りに行かずに済むようにするため。public/fonts/ はコミットしない。
// npm install のあとに自動で走る(postinstall)。すでにあれば何もしない。失敗しても install は止めない。

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "fonts");
const WEIGHTS = ["500", "700"];
const target = (w) => join(dir, `NotoSansJP-${w}.ttf`);

if (WEIGHTS.every((w) => existsSync(target(w)))) {
  console.log("fonts: すでにある");
  process.exit(0);
}

try {
  // 古い UA で頼むと、分割されていない TTF の URL が返る。subset=japanese を付けないと欧文だけの小さな TTF になる
  const css = await fetch("https://fonts.googleapis.com/css?family=Noto+Sans+JP:500,700&subset=japanese", {
    headers: { "User-Agent": "Mozilla/4.0" },
  }).then((r) => r.text());

  mkdirSync(dir, { recursive: true });
  for (const w of WEIGHTS) {
    const m = css.match(new RegExp(`font-weight: ${w};\\s*src: url\\(([^)]+)\\)`));
    if (!m) throw new Error(`weight ${w} の URL が見つからない`);
    const buf = Buffer.from(await fetch(m[1]).then((r) => r.arrayBuffer()));
    writeFileSync(target(w), buf);
    console.log(`fonts: NotoSansJP-${w}.ttf (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
  }
} catch (e) {
  console.warn(`fonts: 取得できなかった(${e.message})。あとで npm run fonts を実行する`);
}
