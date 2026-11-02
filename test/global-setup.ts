// テスト用のローカル D1 を毎回まっさらに作り、マイグレーションと seed を流す。
// reports は削除できない(追記のみ)ので、テストのたびに状態を作り直す。
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";

export const TEST_STATE = ".wrangler/test-state";

export default function setup() {
  rmSync(TEST_STATE, { recursive: true, force: true });
  const run = (args: string[]) =>
    execFileSync("npx", ["wrangler", ...args, "--env", "demo", "--local", "--persist-to", TEST_STATE], {
      stdio: "pipe",
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" },
    });
  run(["d1", "migrations", "apply", "DB"]);
  execFileSync("node", ["scripts/build-seed.mjs", `${TEST_STATE}/seed.sql`], { stdio: "pipe" });
  run(["d1", "execute", "DB", "--file", `${TEST_STATE}/seed.sql`]);
}
