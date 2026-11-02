#!/usr/bin/env node
// コミット前の実データ検査。
//
// 公開リポジトリに実データ(APIキー・トークン・メールアドレス・電話番号・Slack のユーザーID、
// private/denylist.txt に書いた第三者の実名など)を入れないため、コミットされる差分の「追加行」を検査する。
//
// 使い方:
//   node scripts/check-commit.mjs           ステージ済みの差分を検査する
//   node scripts/check-commit.mjs --hook    Claude Code の PreToolUse フックとして動く
//                                           (標準入力の JSON から Bash のコマンドを読み、git commit のときだけ検査)
//
// 見つかったら終了コード 2(フックではコミットが止まる)。見つかった値そのものは伏せて表示する。

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// ---- 検査する型 ---------------------------------------------------------

const PATTERNS = [
  { kind: "Anthropic APIキー", re: /sk-ant-[A-Za-z0-9_-]{10,}/g },
  { kind: "Slack トークン", re: /\bxox[abposre]-[A-Za-z0-9-]{10,}/g },
  { kind: "Slack アプリトークン", re: /\bxapp-[A-Za-z0-9-]{10,}/g },
  { kind: "Slack Webhook URL", re: /hooks\.slack\.com\/services\/[A-Za-z0-9/]{10,}/g },
  { kind: "GitHub トークン", re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g },
  { kind: "AWS アクセスキー", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { kind: "OpenAI 形式のキー", re: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/g },
  { kind: "秘密鍵", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  {
    kind: "メールアドレス",
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    allow: (m) =>
      /@(?:[A-Za-z0-9-]+\.)*example\.(?:com|org|net|jp)$/i.test(m) ||
      /@(?:[A-Za-z0-9-]+\.)*(?:test|invalid|localhost)$/i.test(m) ||
      /@users\.noreply\.github\.com$/i.test(m) ||
      /^noreply@anthropic\.com$/i.test(m) ||
      /^git@github\.com$/i.test(m),
  },
  {
    kind: "電話番号",
    // 日本の番号(0X-XXXX-XXXX、090XXXXXXXX、+81 ...)。日付・UUID・バージョン番号に当たらないよう前後を区切る
    re: /(?<![\w.+-])(?:\+81[- ]?\d{1,4}[- ]\d{1,4}[- ]\d{3,4}|0\d{1,4}-\d{1,4}-\d{3,4}|0[5789]0\d{8})(?![\w-])/g,
  },
  {
    kind: "Slack ユーザーID",
    // U/W + 英大文字数字 8〜11 桁で、数字を1つ以上含むもの。架空の ID は U_DEMO_01 のように _ を入れて書く
    re: /\b[UW](?=[A-Z0-9]*\d)[A-Z0-9]{8,11}\b/g,
  },
];

// ---- 共通 -------------------------------------------------------------

function git(args, opts = {}) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
}

function repoRoot() {
  return git(["rev-parse", "--show-toplevel"]).trim();
}

function mask(s) {
  if (s.length <= 6) return "*".repeat(s.length);
  return `${s.slice(0, 3)}${"*".repeat(Math.min(s.length - 5, 12))}${s.slice(-2)}`;
}

function loadDenylist(root) {
  const p = join(root, "private", "denylist.txt");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

// 差分(unified diff, -U0)から「ファイル名・行番号・追加された行」を取り出す
function addedLinesFromDiff(diff) {
  const out = [];
  let file = null;
  let line = 0;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) {
      file = raw === "+++ /dev/null" ? null : raw.replace(/^\+\+\+ b\//, "");
      continue;
    }
    if (raw.startsWith("--- ")) continue;
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (file && raw.startsWith("+")) {
      out.push({ file, line, text: raw.slice(1) });
      line++;
    }
  }
  return out;
}

function untrackedLines(root) {
  const files = git(["ls-files", "--others", "--exclude-standard", "-z"], { cwd: root })
    .split("\0")
    .filter(Boolean);
  const out = [];
  for (const f of files) {
    const p = join(root, f);
    try {
      if (!statSync(p).isFile() || statSync(p).size > 2 * 1024 * 1024) continue;
      const buf = readFileSync(p);
      if (buf.includes(0)) continue; // バイナリは飛ばす
      buf
        .toString("utf8")
        .split(/\r?\n/)
        .forEach((text, i) => out.push({ file: f, line: i + 1, text }));
    } catch {
      /* 読めないものは飛ばす */
    }
  }
  return out;
}

function hasHead(root) {
  try {
    git(["rev-parse", "--verify", "HEAD"], { cwd: root, stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

// wide=true: `git commit -a` や `git add … && git commit` のように、
// 実行時点ではまだステージされていない変更もコミットに入りうる場合。作業ツリーの変更と未追跡ファイルも検査する
function collectLines(root, wide) {
  const base = ["diff", "-U0", "--no-color", "--no-ext-diff", "--text"];
  if (!wide) return addedLinesFromDiff(git([...base, "--cached"], { cwd: root }));
  const diff = hasHead(root)
    ? git([...base, "HEAD"], { cwd: root })
    : git([...base, "--cached"], { cwd: root }) + "\n" + git(base, { cwd: root });
  return [...addedLinesFromDiff(diff), ...untrackedLines(root)];
}

export function scanLines(lines, denylist = []) {
  const findings = [];
  const deny = denylist.map((w) => ({ w, lw: w.toLowerCase() }));
  for (const { file, line, text } of lines) {
    for (const p of PATTERNS) {
      for (const m of text.matchAll(p.re)) {
        if (p.allow && p.allow(m[0])) continue;
        findings.push({ file, line, kind: p.kind, value: m[0] });
      }
    }
    const lt = text.toLowerCase();
    for (const { w, lw } of deny) {
      if (lt.includes(lw)) findings.push({ file, line, kind: "denylist の語", value: w });
    }
  }
  return findings;
}

function report(findings) {
  const lines = [
    "コミットを止めました: 公開リポジトリに入れてはいけない文字列が差分に含まれています。",
    "",
    ...findings.slice(0, 50).map((f) => `  ${f.file}:${f.line}  ${f.kind}  (${mask(f.value)})`),
  ];
  if (findings.length > 50) lines.push(`  …ほか ${findings.length - 50} 件`);
  lines.push(
    "",
    "対処: 実データを架空のものに置き換える(メールは @example.com、Slack ID は U_DEMO_01 のように書く)。",
    "秘密情報は GitHub Secrets → ワークフロー → wrangler secret で渡し、リポジトリには置かない。",
  );
  return lines.join("\n");
}

// ---- フックとしての判定 -------------------------------------------------

// Bash のコマンド文字列が git commit を含むか。含むなら、未ステージの変更まで見るべきかも返す
export function analyzeCommand(cmd) {
  const segments = cmd.split(/&&|\|\||;|\n|\|/);
  let commit = false;
  let wide = false;
  let addBefore = false;
  for (const seg of segments) {
    const s = seg.trim();
    if (/\bgit\b(?:\s+-C\s+\S+|\s+-c\s+\S+)*\s+add\b/.test(s)) addBefore = true;
    const m = s.match(/\bgit\b(?:\s+-C\s+\S+|\s+-c\s+\S+)*\s+commit\b(.*)$/);
    if (m) {
      commit = true;
      const flags = m[1].split(/\s+/).filter((t) => /^-[A-Za-z]+$/.test(t));
      if (addBefore || /(?:^|\s)--all\b/.test(m[1]) || flags.some((t) => t.includes("a"))) wide = true;
    }
  }
  return { commit, wide };
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main() {
  const hookMode = process.argv.includes("--hook");
  let wide = process.argv.includes("--wide");

  if (hookMode) {
    let input;
    try {
      input = JSON.parse(readStdin() || "{}");
    } catch {
      process.exit(0);
    }
    const cmd = input?.tool_input?.command;
    if (input?.tool_name !== "Bash" || typeof cmd !== "string") process.exit(0);
    const a = analyzeCommand(cmd);
    if (!a.commit) process.exit(0);
    wide = a.wide;
    if (input.cwd) {
      try {
        process.chdir(input.cwd);
      } catch {
        /* そのまま */
      }
    }
  }

  let root;
  try {
    root = repoRoot();
  } catch {
    process.exit(0); // git リポジトリの外なら何もしない
  }

  const findings = scanLines(collectLines(root, wide), loadDenylist(root));
  if (findings.length === 0) process.exit(0);
  process.stderr.write(report(findings) + "\n");
  process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
