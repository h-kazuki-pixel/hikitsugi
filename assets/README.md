# assets/ — デモ動画の部品の確認用

相談役が見るための書き出し結果。ブランチ `video-assets` にだけ置き、main にも video にもマージしない。
元は `video/`(Remotion)で、作り直すときは `video/README.md` のとおり。

- `stills/` — 各部品の見どころを1枚ずつ PNG にしたもの(14枚)
- `rm/` — 地の色の上に出す部品。H.264 mp4、1920×1080、30fps(7本)
- `ov-webm/` — 収録した画面の上に重ねる部品。VP9 のアルファつき WebM(yuva420p、7本)。
  編集に使う本物は ProRes 4444 の mov で、大きいのでここには置かない。
  `OV_demo-label` は本来2分だが、ここでは先頭10秒に縮めてある
