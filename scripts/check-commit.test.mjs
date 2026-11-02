// node --test scripts/check-commit.test.mjs
// 検査対象の文字列はリポジトリに残さないよう、実行時に組み立てる。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanLines, analyzeCommand } from "./check-commit.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "check-commit.mjs");
const j = (...p) => p.join("");
const kinds = (text, deny) => scanLines([{ file: "x", line: 1, text }], deny).map((f) => f.kind);

test("トークン類を見つける", () => {
  assert.deepEqual(kinds(j("key=", "sk-", "ant-", "api03-abcdefghijklmnop")), ["Anthropic APIキー"]);
  assert.deepEqual(kinds(j("xo", "xb-", "1234567890-abcdefghij")), ["Slack トークン"]);
  assert.deepEqual(kinds(j("xo", "xp-", "1234567890-abcdefghij")), ["Slack トークン"]);
});

test("メールアドレスを見つけ、example ドメインは通す", () => {
  assert.deepEqual(kinds(j("taro", "@", "gmail.com")), ["メールアドレス"]);
  assert.deepEqual(kinds(j("owner", "@", "example.com")), []);
});

test("電話番号を見つけ、日付や UUID には反応しない", () => {
  assert.deepEqual(kinds(j("0", "92-123-4567")), ["電話番号"]);
  assert.deepEqual(kinds(j("0", "90", "12345678")), ["電話番号"]);
  assert.deepEqual(kinds("2026-11-02"), []);
  assert.deepEqual(kinds("550e8400-e29b-41d4-0716-446655440000"), []);
});

test("Slack ユーザーID を見つけ、架空の書式と SQL の語は通す", () => {
  assert.deepEqual(kinds(j("U0", "12AB34CD")), ["Slack ユーザーID"]);
  assert.deepEqual(kinds("U_DEMO_01 UPDATE UNIQUE"), []);
});

test("denylist の語を大文字小文字を区別せず見つける", () => {
  assert.deepEqual(kinds("担当は Yamada-San です", ["yamada-san"]), ["denylist の語"]);
});

test("コマンドの判定", () => {
  assert.deepEqual(analyzeCommand("git status"), { commit: false, wide: false });
  assert.deepEqual(analyzeCommand('git commit -m "x"'), { commit: true, wide: false });
  assert.deepEqual(analyzeCommand('git commit -am "x"'), { commit: true, wide: true });
  assert.deepEqual(analyzeCommand('git add -A && git commit -m "x"'), { commit: true, wide: true });
  assert.deepEqual(analyzeCommand("git -C repo commit --all"), { commit: true, wide: true });
});

function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "hk-"));
  const g = (...a) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  g("init", "-q");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "t");
  writeFileSync(join(dir, "a.txt"), "hello\n");
  g("add", "a.txt");
  g("commit", "-qm", "init");
  return { dir, g };
}
const runHook = (dir, command) =>
  spawnSync("node", [SCRIPT, "--hook"], {
    cwd: dir,
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command }, cwd: dir }),
    encoding: "utf8",
  });

test("フック: ステージ済みの秘密情報でコミットを止め、値は伏せる", () => {
  const { dir, g } = tempRepo();
  const secret = j("xo", "xb-", "1111111111-abcdefghijk");
  writeFileSync(join(dir, "b.txt"), `token=${secret}\n`);
  g("add", "b.txt");
  const r = runHook(dir, 'git commit -m "b"');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /b\.txt:1\s+Slack トークン/);
  assert.ok(!r.stderr.includes(secret));
});

test("フック: きれいな差分と commit 以外のコマンドは通す", () => {
  const { dir, g } = tempRepo();
  writeFileSync(join(dir, "c.txt"), "U_DEMO_01 owner@example.com\n");
  g("add", "c.txt");
  assert.equal(runHook(dir, 'git commit -m "c"').status, 0);
  writeFileSync(join(dir, "d.txt"), j("sk-", "ant-", "zzzzzzzzzzzzzzzz"));
  assert.equal(runHook(dir, "ls").status, 0);
});

test("フック: git add && git commit では未ステージの新規ファイルも見る", () => {
  const { dir } = tempRepo();
  writeFileSync(join(dir, "e.txt"), j("call ", "0", "80", "11112222"));
  assert.equal(runHook(dir, 'git commit -m "e"').status, 0); // まだステージされていない
  assert.equal(runHook(dir, 'git add . && git commit -m "e"').status, 2);
});

test("フック: コミットメッセージ(-m / ヒアドキュメント / -F)も検査する", () => {
  const { dir, g } = tempRepo();
  writeFileSync(join(dir, "m.txt"), "clean\n");
  g("add", "m.txt");
  // 差分はきれいでも、メッセージに実データがあれば止める
  assert.equal(runHook(dir, `git commit -m "連絡先 ${j("hanako", "@", "gmail.com")}"`).status, 2);
  const heredoc = `git commit -m "$(cat <<'EOF'\n件名\n\nU${j("0", "12AB34CD")} に確認\nEOF\n)"`;
  const r = runHook(dir, heredoc);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /\(コミットメッセージ\):4\s+Slack ユーザーID/);
  writeFileSync(join(dir, "..msg"), j("token ", "xo", "xp-", "2222222222-abcdefghij\n"));
  assert.equal(runHook(dir, `git commit -F ${join(dir, "..msg")}`).status, 2);
  // 通常のメッセージ(Co-Authored-By の noreply を含む)は通す
  const ok = 'git commit -m "機能を追加\n\nCo-Authored-By: Claude <noreply@anthropic.com>"';
  assert.equal(runHook(dir, ok).status, 0);
});

test("フック: private/denylist.txt の語で止め、denylist 自体は検査しない", () => {
  const { dir, g } = tempRepo();
  writeFileSync(join(dir, ".gitignore"), "private/\n");
  mkdirSync(join(dir, "private"));
  writeFileSync(join(dir, "private", "denylist.txt"), "# 第三者の実名\n架空太郎\n");
  writeFileSync(join(dir, "f.txt"), "担当: 架空太郎\n");
  g("add", ".gitignore", "f.txt");
  assert.equal(runHook(dir, 'git commit -m "f"').status, 2);
});
