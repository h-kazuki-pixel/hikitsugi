// 実店舗の seed(production)の検証と SQL づくり。データはすべて架空(ID は数字を含まない架空の形)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import * as demo from "../seed/demo.mjs";
import { buildSeedSql } from "./build-seed.mjs";

// demo の seed を、実店舗の形(実際の形の Slack ID、解錠ID はまだなし)に書き換えた架空データ
function productionLike() {
  const seed = structuredClone({ people: demo.people, stores: demo.stores, owner_rules: demo.owner_rules, 運営の設定: demo.運営の設定 });
  const letters = "ABCDEFGHIJ";
  seed.people.forEach((p, i) => {
    p.slack = `UTESTUSER${letters[i]}`;
    p.解錠ID = null;
  });
  seed.stores.forEach((s, i) => (s["4_報告の手段"].slackチャンネル = `CTESTCHAN${letters[i]}`));
  return seed;
}

test("実店舗の形なら SQL を作る。解錠ID は空でよい。見出しは実データの注意書き", () => {
  const sql = buildSeedSql(productionLike(), { env: "production", now: "2026-11-04T00:00:00Z" });
  assert.match(sql, /^-- 実店舗の seed から生成。実データなのでコミットしない/);
  assert.match(sql, /INSERT OR IGNORE INTO staff .*'UTESTUSERA', NULL/);
  assert.match(sql, /activated_at\) VALUES .*'2026-11-04T00:00:00Z'\);/);
});

test("実店舗の seed に架空の形が混ざっていたら止める。demo の seed は production では通らない", () => {
  const seed = productionLike();
  seed.people[0].slack = "U_DEMO_AOI";
  assert.throws(() => buildSeedSql(seed, { env: "production" }), /架空の ID/);
  const ch = productionLike();
  ch.stores[0]["4_報告の手段"].slackチャンネル = "C_DEMO_TENJIN";
  assert.throws(() => buildSeedSql(ch, { env: "production" }), /架空のチャンネル/);
  assert.throws(() => buildSeedSql(demo, { env: "production" }), /架空/);
});

test("実店舗の形は demo では通らない(demo には架空の形しか入れない)", () => {
  assert.throws(() => buildSeedSql(productionLike()), /架空の形/);
});

test("出典のない知識は実店舗でも弾く", () => {
  const seed = productionLike();
  delete seed.stores[0]["7_口調とよく聞かれる質問"].よく聞かれる質問[0].答えた人;
  assert.throws(() => buildSeedSql(seed, { env: "production" }), /出典/);
});

test("--production: JSON を読み、SQL は private/ かリポジトリの外にだけ書く。中身は画面に出さない", () => {
  const dir = mkdtempSync(join(tmpdir(), "seed-"));
  const input = join(dir, "seed.json");
  writeFileSync(input, JSON.stringify(productionLike()));
  const out = execFileSync("node", ["scripts/build-seed.mjs", "--production", input, join(dir, "seed.sql")], { encoding: "utf8" });
  assert.ok(out.includes("店舗 2 / 清掃箇所 6 / スタッフ 4 + 運営 2 / 知識 10 / ルール 5"), out);
  assert.doesNotMatch(out, /UTESTUSER/);
  assert.match(readFileSync(join(dir, "seed.sql"), "utf8"), /UTESTUSERA/);
  assert.throws(() => execFileSync("node", ["scripts/build-seed.mjs", "--production", input, "seed/prod.sql"], { stdio: "pipe" }), /private/);
  writeFileSync(input, "{ 壊れた JSON");
  assert.throws(() => execFileSync("node", ["scripts/build-seed.mjs", "--production", input, join(dir, "x.sql")], { stdio: "pipe" }), /JSON として読めません/);
});

test("--production: 不正なときも件数だけ出し、ID は出さない(--verbose なら出す)", () => {
  const dir = mkdtempSync(join(tmpdir(), "seed-"));
  const input = join(dir, "seed.json");
  const seed = productionLike();
  seed.people[0].slack = "U_DEMO_AOI";
  writeFileSync(input, JSON.stringify(seed));
  const run = (extra) => {
    try {
      execFileSync("node", ["scripts/build-seed.mjs", "--production", input, join(dir, "x.sql"), ...extra], { stdio: "pipe", encoding: "utf8" });
      return "";
    } catch (e) {
      return String(e.stderr);
    }
  };
  const quiet = run([]);
  assert.ok(quiet.includes("不正です(1件)"), quiet);
  assert.doesNotMatch(quiet, /staff_aoi|U_DEMO_AOI/);
  assert.match(run(["--verbose"]), /staff_aoi/);
});

test("頻度「毎日(N日空いても可)」と全店の知識(店舗を持たない知識)", () => {
  const seed = productionLike();
  seed.stores[0]["2_清掃箇所"].push({ id: "x_lobby", 名前: "架空のロビー", 頻度: "毎日(1日空いても可)" }, { id: "x_stairs", 名前: "架空の階段", 頻度: "毎日(2日空いても可)" });
  seed.全店の知識 = [{ id: "kn_all_x", 質問: "架空の質問?", 回答: "架空の答え。", 種別: "判断", 答えた人: seed.people.find((p) => p.役割 === "オーナー").id, 答えた: "2026-11-04 01:50" }];
  const sql = buildSeedSql(seed, { env: "production" });
  assert.match(sql, /'x_lobby', '[a-z]+', '架空のロビー', 'daily_gap:1'/);
  assert.match(sql, /'daily_gap:2'/);
  assert.match(sql, /INSERT OR IGNORE INTO knowledge \(id, store_id, .*VALUES \('kn_all_x', NULL,/);
  const bad = productionLike();
  bad.stores[0]["2_清掃箇所"].push({ id: "x_bad", 名前: "架空", 頻度: "毎日が理想" });
  assert.throws(() => buildSeedSql(bad, { env: "production", }), /頻度が読めません/);
});

test("テスト用の店舗チャンネルの印(運営の投稿も報告として受ける)は、書いた店だけ 1 になる", () => {
  const seed = productionLike();
  seed.stores[1]["4_報告の手段"].運営の投稿も報告として受ける = true;
  const stores = buildSeedSql(seed, { env: "production" }).split("\n").filter((l) => l.startsWith("INSERT OR IGNORE INTO stores"));
  assert.match(stores[0], /photo_required, accepts_operator_posts, .*VALUES \('tenjin', .*'CTESTCHANA', 0, 0,/);
  assert.match(stores[1], /VALUES \('yakuin', .*'CTESTCHANB', 0, 1,/);
});
