import type { Child } from "hono/jsx";
import { IconBot, IconChartColumn, IconChevronDown } from "./icons";

// 見た目の決まり(30): 色と字は :root のトークンに一か所で持つ。グラデーションなし、影はトーストだけ。
// 字は IBM Plex Sans JP(SIL OFL 1.1、Google Fonts 経由)。アイコンは Lucide(ISC)を icons.tsx に写した
const css = `
:root{--side:#F7F7F8;--bg:#FFFFFF;--ink:#1F2328;--sub:#656D76;--faint:#8C959F;--line:#E4E6EA;--hover:#EFF0F2;
--brand:#0F7B6C;--brand-wash:#E6F2EF;--ai:#6E56CF;--ai-wash:#F5F2FE;--ai-line:#DDD5FA;--hu-wash:#EAF5F1;--hu-line:#BFE0D6;
--warn:#B25E09;--warn-wash:#FDF2E4;--ok:#1A7F37;--ok-wash:#E8F5EC;--danger:#B42318;--danger-wash:#FDECEA;--toast:#1F2328}
@media (prefers-color-scheme: dark){
:root{--side:#161A1F;--bg:#0E1116;--ink:#E6EDF3;--sub:#9DA7B3;--faint:#6E7A87;--line:#2A313A;--hover:#1C222A;
--brand:#3FB59F;--brand-wash:#12302B;--ai:#A99BF0;--ai-wash:#221C3A;--ai-line:#3D3360;--hu-wash:#12302B;--hu-line:#1F4A41;
--warn:#F0A04B;--warn-wash:#33230F;--ok:#4CC26A;--ok-wash:#102A18;--danger:#F08B82;--danger-wash:#3A1613;--toast:#E6EDF3}
.toast{color:#0E1116}.hk{color:#0E1116}.btn.p{color:#0E1116}.nav .n.badge{color:#0E1116}}
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{font-family:"IBM Plex Sans JP",system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;font-size:14px;line-height:1.6;color:var(--ink);background:var(--bg);font-feature-settings:"palt","tnum";-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%}
svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;flex:none}
a{color:var(--brand)}
:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
h1{font-size:20px;font-weight:600;margin:0 0 6px;line-height:1.35}
h2{font-size:13.5px;font-weight:600;margin:0}
@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}

/* ---- アプリの枠 */
.app{display:grid;grid-template-columns:232px 1fr;min-height:100vh}
.side{background:var(--side);border-right:1px solid var(--line);display:flex;flex-direction:column;padding:12px 10px;position:sticky;top:0;height:100vh}
.ws{display:flex;align-items:center;gap:9px;padding:6px 8px 14px;text-decoration:none;color:inherit}
.hk{width:26px;height:26px;border-radius:6px;background:var(--brand);color:#fff;font-weight:600;font-size:12px;display:flex;align-items:center;justify-content:center;letter-spacing:.02em;flex:none}
.ws b{display:block;font-size:13.5px;font-weight:600;line-height:1.2}.ws small{display:flex;align-items:center;gap:2px;font-size:12px;color:var(--sub)}
.grp{font-size:11.5px;color:var(--faint);font-weight:500;padding:12px 8px 4px}
.nav{display:flex;align-items:center;gap:9px;height:32px;padding:0 8px;border-radius:6px;color:var(--sub);text-decoration:none;font-size:13.5px;white-space:nowrap}
.nav:hover{background:var(--hover)}
.nav.on{background:var(--hover);color:var(--ink);font-weight:500}
.nav .n{margin-left:auto;font-size:12px;color:var(--faint)}
.nav .n.badge{background:var(--brand);color:#fff;border-radius:999px;min-width:20px;height:18px;display:inline-flex;align-items:center;justify-content:center;font-weight:600;font-size:11.5px;padding:0 6px}
.nav .n.warn{color:var(--warn);font-weight:600}
.side .sp{flex:1}
.me{display:flex;align-items:center;gap:8px;padding:8px;font-size:13px;color:var(--sub);border-top:1px solid var(--line)}
.av{width:24px;height:24px;border-radius:50%;background:#D8DEE4;color:#1F2328;font-size:11px;font-weight:600;display:flex;align-items:center;justify-content:center;flex:none}
.main{display:flex;flex-direction:column;min-width:0}
.top{height:48px;border-bottom:1px solid var(--line);display:flex;align-items:center;padding:0 20px;gap:8px;font-size:13.5px;color:var(--sub)}
.top b{color:var(--ink);font-weight:500}.top .r{margin-left:auto;display:flex;gap:10px;align-items:center}
.pill{display:inline-flex;align-items:center;gap:5px;border-radius:999px;font-size:12px;font-weight:500;padding:1px 9px;line-height:1.6;white-space:nowrap}
.pill.demo{background:var(--warn-wash);color:var(--warn)}
.pill.rule{background:var(--hover);color:var(--ink);font-size:11.5px}
.pill.rule.k{background:var(--hu-wash);color:var(--brand)}
.pill.ai{background:var(--ai-wash);color:var(--ai);border:1px solid var(--ai-line)}
.pill.hu{background:var(--hu-wash);color:var(--brand);border:1px solid var(--hu-line)}
.pill.sys{background:var(--hover);color:var(--sub)}
.pill.ok{background:var(--ok-wash);color:var(--ok)}
.pill.warn{background:var(--warn-wash);color:var(--warn)}
.pill.gray{background:var(--hover);color:var(--sub);font-size:11.5px}
.pill.closed{background:var(--hover);color:var(--sub)}

/* ---- 区画の中身 */
.pane{padding:20px 28px;overflow:auto;flex:1}
.ph{display:flex;align-items:baseline;gap:10px;margin:0 0 4px}.ph h1{margin:0}.ph .cnt{font-size:13px;color:var(--sub)}
.lead{font-size:13px;color:var(--sub);margin:0 0 16px}
.empty{color:var(--sub);margin:0;font-size:13.5px}
.meta{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12.5px;color:var(--sub);margin:0 0 16px}
.meta span{display:inline-flex;align-items:center;gap:5px}.meta svg{width:14px;height:14px}

/* 検出事項: 一覧+詳細の2ペイン */
.body{display:grid;grid-template-columns:260px 1fr;flex:1;min-height:0}
.list{border-right:1px solid var(--line);overflow:auto}
.lh{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;font-size:12.5px;color:var(--sub);border-bottom:1px solid var(--line)}
.it{display:block;padding:12px 16px;border-bottom:1px solid var(--line);text-decoration:none;color:inherit}
.it:hover{background:var(--hover)}
.it.on{background:var(--brand-wash);box-shadow:inset 3px 0 0 var(--brand)}
.it .t{font-weight:500;font-size:13.5px;margin:0 0 3px}
.it .m{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:center;font-size:12px;color:var(--sub)}
.it .m span{display:inline-flex;align-items:center;gap:4px}.it .m svg{width:13px;height:13px}
.det{overflow:auto;padding:20px 28px;min-width:0}
.th{display:flex;align-items:center;margin:0 0 8px;flex-wrap:wrap;gap:6px}
.leg{margin-left:auto;display:flex;gap:12px;font-size:12px;color:var(--sub)}
.leg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.leg i.ai{background:var(--ai-wash);border:1px solid var(--ai-line)}.leg i.hu{background:var(--hu-wash);border:1px solid var(--hu-line)}

/* 判断経路の表 */
table.path{width:100%;border-collapse:separate;border-spacing:0;border:1px solid var(--line);border-radius:8px;overflow:hidden;font-size:13.5px}
table.path th{background:var(--side);color:var(--sub);font-weight:500;font-size:12px;text-align:left;padding:7px 12px;border-bottom:1px solid var(--line)}
table.path td{padding:8px 12px;border-bottom:1px solid var(--line);vertical-align:top}
table.path tr:last-child td{border-bottom:0}
table.path td.no{color:var(--faint);width:34px}
table.path td.who{width:118px}
table.path td.step{width:132px;font-weight:500;white-space:nowrap}
.sub-text{color:var(--sub)}
.box{display:block;padding:5px 10px;border-radius:6px}
.box.ai{background:var(--ai-wash);border:1px solid var(--ai-line)}
.box.hu{background:var(--hu-wash);border:1px solid var(--hu-line)}
tr.key .box,tr.key td.step{font-weight:600}

/* 承認待ちのキュー */
.card{border:1px solid var(--line);border-radius:8px;margin:0 0 12px;display:grid;grid-template-columns:1fr auto;gap:0 20px;padding:14px 16px;background:var(--bg)}
.card.plain{display:block}
.who2{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:13px;color:var(--sub);margin:0 0 8px}
.who2 b{color:var(--ink);font-weight:500}
.av2{width:26px;height:26px;border-radius:50%;background:var(--brand-wash);color:var(--brand);font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center;flex:none}
.kind{font-size:11.5px;font-weight:500;color:var(--sub);background:var(--hover);border-radius:999px;padding:1px 8px}
.when{display:inline-flex;align-items:center;gap:4px}.when svg{width:13px;height:13px}
.msg{background:var(--side);border:1px solid var(--line);border-radius:6px;padding:9px 12px;white-space:pre-wrap;font-size:13.5px;margin:0 0 8px}
.lk{font-size:12.5px;color:var(--brand);text-decoration:none;display:inline-flex;align-items:center;gap:4px}
.acts{display:flex;flex-direction:column;gap:8px;align-items:stretch;min-width:150px}
.acts form{margin:0;display:flex}
.btn{font:inherit;font-size:13.5px;font-weight:500;height:34px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--ink);display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:0 14px;cursor:pointer;width:100%}
.btn.p{background:var(--brand);border-color:var(--brand);color:#fff}
.qa{display:grid;grid-template-columns:44px 1fr;gap:6px 10px;font-size:13.5px;margin:0 0 8px}
.qa .k{color:var(--sub);font-size:12.5px;padding-top:6px}
.qa .q{font-weight:600;padding-top:5px}
.qa .msg{margin:0}
.qa dl{margin:0;display:grid;grid-template-columns:auto 1fr;gap:2px 10px;font-size:13px}.qa dt{color:var(--sub)}.qa dd{margin:0}
.hint{font-size:12.5px;color:var(--sub)}
.sent{display:flex;flex-direction:column;gap:4px;align-items:flex-start;font-size:12px;color:var(--sub)}
.toast{position:fixed;right:24px;bottom:24px;background:var(--toast);color:#fff;border-radius:8px;padding:10px 14px;font-size:13px;display:flex;align-items:center;gap:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);animation:toast 4s ease forwards}
@keyframes toast{0%{opacity:0;transform:translateY(6px)}8%{opacity:1;transform:none}85%{opacity:1}100%{opacity:0;visibility:hidden}}

/* ボード */
ul.board{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:8px;overflow:hidden}
ul.board li{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:44px;padding:8px 14px;border-top:1px solid var(--line);font-size:13.5px}
ul.board li:first-child{border-top:0}
.status{display:inline-flex;align-items:center;border-radius:999px;font-size:12px;font-weight:500;padding:1px 9px;white-space:nowrap;border:1px solid transparent}
.status.done{background:var(--ok-wash);color:var(--ok)}
.status.needs_recheck{background:var(--warn-wash);color:var(--warn)}
.status.pending{border-color:var(--line);color:var(--sub)}
.status.carried_over,.status.no_assignee{background:var(--danger-wash);color:var(--danger)}
.note{display:block;font-size:12px;color:var(--sub)}
.note.key{color:var(--warn);font-size:12.5px}

/* ルール一覧・そのほかの一覧 */
ul.rules{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:8px}
ul.rules li{border-top:1px solid var(--line);padding:10px 14px}
ul.rules li:first-child{border-top:0}
.rule-text{margin:0;font-weight:500;font-size:13.5px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.rule-q{margin:0;font-size:12.5px;color:var(--sub)}
.origin-key{margin:6px 0 0;padding:4px 10px;border-radius:6px;background:var(--hu-wash);border:1px solid var(--hu-line);font-size:12.5px;color:var(--brand)}
.origin{margin:2px 0 0;font-size:12px;color:var(--sub)}
form.add-rule{display:grid;gap:6px;margin-top:16px;max-width:560px}
form.add-rule label{font-size:13px;font-weight:500}
textarea,select{font:inherit;font-size:13.5px;width:100%;padding:7px 10px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--ink)}
select{height:34px;padding:0 10px}
form.add-rule .btn{width:auto;justify-self:start}
fieldset.scope{border:1px solid var(--line);border-radius:6px;padding:6px 10px 8px;margin:0 0 8px;display:grid;gap:2px;font-size:13px;min-width:240px}
.acts form:has(fieldset.scope){flex-direction:column}
fieldset.scope legend{font-size:12px;color:var(--sub);padding:0 4px}
fieldset.scope label{display:flex;align-items:center;gap:6px;min-height:26px}
fieldset.scope input{accent-color:var(--brand);width:15px;height:15px;margin:0}
details.scope-edit{margin-top:6px}
details.scope-edit summary{font-size:12.5px;color:var(--brand);cursor:pointer;list-style:none;display:inline-block}
details.scope-edit summary::-webkit-details-marker{display:none}
details.scope-edit form{margin-top:6px;max-width:360px;display:grid;gap:6px}
details.scope-edit .btn{width:auto;justify-self:start}
code{font-size:12px;word-break:break-all}
ul.stores{list-style:none;padding:0;margin:0;border:1px solid var(--line);border-radius:8px}
ul.stores li a{display:block;padding:12px 14px;min-height:44px;border-top:1px solid var(--line);text-decoration:none;color:var(--ink);font-weight:500}
ul.stores li:first-child a{border-top:0}
ul.stores .sub{font-weight:400;color:var(--sub);font-size:12.5px;margin-left:8px}
.demo-row{display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end;max-width:560px;margin:0 0 16px}
.demo-row label{font-size:13px;font-weight:500;grid-column:1/-1}
.demo-row .btn{width:auto}

/* 単独のページ(店舗の一覧・数字・消費・404) */
main.plain{max-width:720px;margin:0 auto;padding:24px 20px 48px}
main.plain header{margin-bottom:16px}
main.plain section{margin-top:12px}
main.plain .meta{margin-bottom:0}

/* ---- スマホ幅(〜1023px): サイドバーは上の横スクロールのタブに、2ペインは縦積みに */
@media (max-width: 1023px){
.app{grid-template-columns:1fr}
.side{position:static;height:auto;flex-direction:row;align-items:center;overflow-x:auto;padding:6px 10px;border-right:0;border-bottom:1px solid var(--line);gap:2px}
.side .ws{padding:4px 8px 4px 2px}.side .ws small{display:none}
.side .grp,.side .sp,.side .me{display:none}
.nav{height:30px;padding:0 8px;gap:6px}.nav .n{margin-left:2px}
.top{height:auto;min-height:44px;padding:6px 16px;flex-wrap:wrap}.top .r{margin-left:auto}
.pane,.det{padding:16px}
.body{grid-template-columns:1fr}
.list{border-right:0;border-bottom:1px solid var(--line);max-height:40vh}
table.path,table.path tbody,table.path tr,table.path td{display:block;width:auto}
table.path thead{display:none}
table.path tr{padding:8px 12px;border-bottom:1px solid var(--line)}
table.path tr:last-child{border-bottom:0}
table.path td{padding:2px 0;border:0}
table.path td.no{display:inline;width:auto;margin-right:6px}table.path td.who{display:inline;width:auto}
table.path td.step{white-space:normal;width:auto;padding-top:4px}
.card{grid-template-columns:1fr}.acts{flex-direction:row;flex-wrap:wrap}.acts form{flex:1}
.leg{margin-left:0}
.demo-row{grid-template-columns:1fr}
}
`;

function Head(props: { title: string }) {
  return (
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      <meta name="robots" content="noindex" />
      <title>{props.title}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+JP:wght@400;500;600&display=swap" rel="stylesheet" />
      <style dangerouslySetInnerHTML={{ __html: css }} />
    </head>
  );
}

// 単独のページ(店舗の一覧・数字・Claude の消費・404)
export function Layout(props: { title: string; children: Child }) {
  return (
    <html lang="ja">
      <Head title={props.title} />
      <body>
        <main class="plain">{props.children}</main>
      </body>
    </html>
  );
}

export type NavItem = { key: string; label: string; icon: unknown; href: string; count?: number | null; countStyle?: "badge" | "warn" | "plain" };

// アプリの枠: 左にサイドバー(232px)、上に 48px のバー(パンくず・日時・デモのピル)
export function AppShell(props: {
  title: string;
  storeName: string;
  crumb: string;
  now: string; // 「11/6(金)14:12」
  isDemo: boolean;
  ownerName: string | null;
  items: NavItem[];
  activeKey: string;
  children: Child;
}) {
  return (
    <html lang="ja">
      <Head title={props.title} />
      <body>
        <div class="app">
          <aside class="side">
            <a class="ws" href="/" aria-label="店舗の一覧へ">
              <div class="hk">hk</div>
              <div>
                <b>hikitsugi</b>
                <small>
                  {props.storeName} <IconChevronDown size={13} />
                </small>
              </div>
            </a>
            <div class="grp">店舗</div>
            {props.items.map((it) => (
              <a class={`nav${it.key === props.activeKey ? " on" : ""}`} href={it.href} aria-current={it.key === props.activeKey ? "page" : undefined}>
                {it.icon as never}
                {it.label}
                {it.count != null && it.count > 0 && <span class={`n${it.countStyle === "badge" ? " badge" : it.countStyle === "warn" ? " warn" : ""}`}>{it.count}</span>}
              </a>
            ))}
            <div class="grp">運営</div>
            <a class="nav" href="/stats">
              <IconChartColumn />
              数字
            </a>
            <a class="nav" href="/usage">
              <IconBot />
              Claude の消費
            </a>
            <div class="sp" />
            {props.ownerName && (
              <div class="me">
                <span class="av">{props.ownerName.slice(0, 1)}</span>
                {props.ownerName}
              </div>
            )}
          </aside>
          <div class="main">
            <div class="top">
              {props.storeName} <span>/</span> <b>{props.crumb}</b>
              <span class="r">
                <span>{props.now}</span>
                {props.isDemo && <span class="pill demo">デモ環境(架空のデータ)</span>}
              </span>
            </div>
            {props.children}
          </div>
        </div>
      </body>
    </html>
  );
}
