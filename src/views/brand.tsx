// ロゴの部品。絵は docs/brand/ の SVG と同じ(viewBox は変えない。枠と絵の間の余白を含む)
// 色の意味は画面の色分けと同じ: 帳面 #0F7B6C = 人が答えた言葉、白い帯 = 次の人が開くページ、紫のしおり #6E56CF = Claude(書かずに、開く)
// 色は SVG に直接書く(CSS 変数にしない)。暗い表示のときだけ、Layout の暗い表示のセレクタが class ごとに fill / stroke を上書きする
// (帳面 #14A08D、しおり #A898F7、文字の線と i の点は白、帯は白のまま)。明るい表示の色と形はこの SVG のとおり
// マークと文字を並べるときは必ず Lockup を使う。Mark と Wordmark を flex で並べ直さない(マークの SVG には左右に余白があり、
// 並べ直すと間が開きすぎる。間は文字の x の高さと同じ、文字の x の高さの中心を帳面の中心に揃える、と Lockup の中で決めてある)
// Layout の共通 CSS(svg{width:16px;height:16px;stroke-linecap:round;…})に負けないよう、大きさは style に書き、線の端は svg.logo で戻す

const round = (n: number) => Math.round(n * 100) / 100;
const px = (n: number) => `${round(n)}px`;

// マーク: 帳面・白い帯・紫のしおり(viewBox 64×64)。最小 16px(16px ではファビコン版)。周りの余白は帯の幅(7/64)以上
export function Mark(props: { size: number }) {
  const s = props.size;
  return (
    <svg class="logo" viewBox="0 0 64 64" width={s} height={s} style={`width:${px(s)};height:${px(s)}`} aria-hidden="true">
      <rect class="lg-book" x="14" y="2" width="36" height="48" rx="3" fill="#0F7B6C" />
      <rect class="lg-band" x="22" y="8" width="7" height="42" fill="#FFFFFF" />
      <path class="lg-ribbon" d="M22 50H29V62L25.5 58.5L22 62Z" fill="#6E56CF" />
    </svg>
  );
}

// 文字の中身(Wordmark と Lockup で共有)。フォントで打った「hikitsugi」をロゴとして使わない
function WordmarkPaths() {
  return (
    <>
      <g class="lg-ink" fill="none" stroke="#1F2328" strokeWidth="6">
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
      <rect class="lg-dot" x="32" y="5" width="6" height="6" fill="#1F2328" />
      <rect class="lg-dot" x="72" y="5" width="6" height="6" fill="#1F2328" />
      <path class="lg-ribbon" d="M194 3H200V13L197 10.5L194 13Z" fill="#6E56CF" />
    </>
  );
}

// 文字(viewBox 204×58)
export function Wordmark(props: { height: number }) {
  const h = props.height;
  const w = (h * 204) / 58;
  return (
    <svg class="logo" viewBox="-2 0 204 58" width={round(w)} height={h} style={`width:${px(w)};height:${px(h)}`} role="img" aria-label="hikitsugi">
      <WordmarkPaths />
    </svg>
  );
}

// 横組み(viewBox 196.5×64)。height={26} で幅は約 80px
export function Lockup(props: { height: number }) {
  const h = props.height;
  const w = (h * 196.5) / 64;
  return (
    <svg class="logo" viewBox="12 0 196.5 64" width={round(w)} height={h} style={`width:${px(w)};height:${px(h)}`} role="img" aria-label="hikitsugi">
      <rect class="lg-book" x="14" y="2" width="36" height="48" rx="3" fill="#0F7B6C" />
      <rect class="lg-band" x="22" y="8" width="7" height="42" fill="#FFFFFF" />
      <path class="lg-ribbon" d="M22 50H29V62L25.5 58.5L22 62Z" fill="#6E56CF" />
      <g transform="translate(66 6.4) scale(0.7015)">
        <WordmarkPaths />
      </g>
    </svg>
  );
}

// ファビコン版(docs/brand/favicon.svg と同じ)。16px で読めるよう帳面と帯を少し太らせたもの。GET /favicon.svg が返す
export const FAVICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="12" y="1" width="40" height="50" rx="3" fill="#0F7B6C"/><rect x="21" y="7" width="9" height="44" fill="#FFFFFF"/><path d="M21 51H30V63L25.5 58.5L21 63Z" fill="#6E56CF"/></svg>\n';
