import type { Child } from "hono/jsx";

// スマホ優先。幅は狭い画面を基準にし、広い画面では中央に寄せるだけ
const css = `
:root {
  --bg: #f6f5f2; --card: #ffffff; --text: #1d1d1b; --muted: #6b6a66; --line: #e3e1db;
  --accent: #2f6f5e; --done: #2f6f5e; --pending: #a15c00; --carried: #8a3b3b; --none: #6b6a66;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161615; --card: #1f1f1d; --text: #ecebe7; --muted: #a3a29c; --line: #34332f;
    --accent: #7cc4ad; --done: #7cc4ad; --pending: #f0b35a; --carried: #e48d8d; --none: #a3a29c;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font-family: system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif;
  font-size: 16px; line-height: 1.6; -webkit-text-size-adjust: 100%;
}
main { max-width: 640px; margin: 0 auto; padding: 16px 16px 48px; }
header { margin-bottom: 16px; }
h1 { font-size: 1.35rem; line-height: 1.35; margin: 4px 0; }
h2 { font-size: 1.05rem; margin: 0 0 8px; }
.meta { color: var(--muted); font-size: 0.9rem; display: flex; flex-wrap: wrap; gap: 4px 12px; }
.badge { display: inline-block; font-size: 0.75rem; padding: 1px 8px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); }
.badge.demo { border-color: var(--accent); color: var(--accent); }
section.card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 16px; margin-top: 12px; }
.empty { color: var(--muted); margin: 0; }
ul.board { list-style: none; margin: 0; padding: 0; }
ul.board li { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 44px; border-top: 1px solid var(--line); }
ul.board li:first-child { border-top: 0; }
.status { font-size: 1rem; font-weight: 600; white-space: nowrap; }
.status.done { color: var(--done); } .status.pending { color: var(--pending); }
.status.carried_over { color: var(--carried); } .status.no_assignee { color: var(--none); } .status.needs_recheck { color: var(--carried); }
.note { display: block; font-size: 0.8rem; color: var(--muted); }
.note.key { font-size: 1rem; color: var(--text); }
a { color: var(--accent); }
ul.stores { list-style: none; padding: 0; margin: 0; }
ul.stores li a { display: block; padding: 12px 0; min-height: 44px; border-top: 1px solid var(--line); text-decoration: none; }
ul.stores li:first-child a { border-top: 0; }
ul.rules { list-style: none; margin: 0; padding: 0; }
ul.rules li { border-top: 1px solid var(--line); padding: 10px 0; }
ul.rules li:first-child { border-top: 0; padding-top: 0; }
.rule-q { margin: 0; font-size: 0.85rem; color: var(--muted); }
.rule-ask { margin: 0 0 4px; font-size: 1.1rem; font-weight: 700; }
.origin-key { margin: 4px 0 0; padding-left: 8px; border-left: 3px solid var(--accent); font-size: 1rem; font-weight: 600; }
.rule-text { margin: 2px 0; font-weight: 600; }
dl.rule-src { margin: 6px 0; font-size: 0.9rem; display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; }
dl.rule-src dt { color: var(--muted); } dl.rule-src dd { margin: 0; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.actions form { margin: 0; }
button { font: inherit; min-height: 44px; padding: 0 14px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--text); }
ol.path { margin: 6px 0 0; padding-left: 1.4em; font-size: 0.9rem; }
ol.path li { margin: 2px 0; }
ol.path li.key { border-left: 3px solid var(--accent); padding-left: 8px; font-weight: 600; }
details summary { cursor: pointer; color: var(--accent); font-size: 0.9rem; min-height: 32px; }
form.add-rule { display: grid; gap: 6px; margin-top: 12px; border-top: 1px solid var(--line); padding-top: 12px; }
form.add-rule label { font-size: 0.9rem; color: var(--muted); }
textarea { font: inherit; width: 100%; padding: 8px; border-radius: 10px; border: 1px solid var(--line); background: var(--bg); color: var(--text); }
code { font-size: 0.8rem; word-break: break-all; }
.draft-body { white-space: pre-wrap; margin: 4px 0; padding: 8px; border-radius: 8px; background: var(--bg); }
select { font: inherit; min-height: 44px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); color: var(--text); padding: 0 8px; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }
`;

export function Layout(props: { title: string; children: Child }) {
  return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="robots" content="noindex" />
        <title>{props.title}</title>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        <main>{props.children}</main>
      </body>
    </html>
  );
}
