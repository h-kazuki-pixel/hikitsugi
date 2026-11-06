# video/ — デモ動画の部品(Remotion)

Workers 本体とは別のパッケージ。ここだけで完結する。動画の組み上げは別の編集ソフトで行い、ここでは部品を書き出すところまで。

## 使い方

```bash
cd video
npm install          # 終わりに Noto Sans JP を public/fonts/ に落とす(postinstall)
npm run dev          # Remotion Studio(http://localhost:3000)
npm run render       # 全部品を video/out/ に書き出す(静止画も)
npm run stills       # 見どころの静止画だけ video/out/stills/ に
```

- `out/` と `public/fonts/` はコミットしない
- 環境に Chromium があるときは `REMOTION_BROWSER_EXECUTABLE=/path/to/chrome` で指定できる(なければ Remotion が自分で用意する)
- Remotion は個人の無料ライセンスで使う

## 書き出し

| 部品 | 形式 |
|---|---|
| `RM_*` | H.264 mp4、1920×1080、30fps |
| `OV_*` | ProRes 4444 mov(背景透明)。収録した画面の上に重ねる |

## ファイルの置き場

- `src/timings.ts` — 各カットの長さと、カットの中の秒。**秒はここにしか書かない**。語りを録ったあとに変える
- `src/stats.ts` — RM_4-3 に出す数字
- `src/theme.ts` — 色・フォント・文字の大きさ。凡例の紫・緑は `src/views/Layout.tsx` の判断経路の色を写したもの
- `src/comps/` — コンポジション。部品の名前がそのままファイル名
- `public/brand/` — `docs/brand/` のロゴ SVG の複製(描き直していない)

Remotion のコンポジション ID には `_` が使えないので、Studio 上の ID だけ `_` を `-` に置き換えている(`RM_1-1_logo` → `RM-1-1-logo`)。ファイル名・書き出し名は部品の名前のまま。

## props で受けるもの

- `RM_2-11_same-words`: 写真2枚のパス(`public/` からの相対。`null` なら仮の灰色)と、枠の位置。枠は写真の幅・高さに対する割合(0〜1)で `{ x, y, w, h }`。写真の表示サイズは `photoWidth` / `photoHeight`
- `RM_4-3_numbers`: 数字5つ(既定値は `src/stats.ts`)
- `OV_2-12_legend`: `screenTheme` に `"light"` か `"dark"`(収録した画面の表示に合わせる)

## 数字の数え方(2026-11-02 12:00 JST から、2026-11-06 に数えた)

```bash
# コミット数(main、マージコミットを除く)。含めると 128
git rev-list origin/main --count --no-merges --since='2026-11-02T12:00:00+09:00'
```

```bash
# マージ済みの PR
gh api -X GET search/issues -f q='repo:h-kazuki-pixel/hikitsugi is:pr is:merged merged:>=2026-11-02T03:00:00Z' --jq .total_count
```

```bash
# vitest のテストの数("Tests  143 passed" の数)
npx vitest run
```
