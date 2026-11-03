#!/usr/bin/env node
// 店舗の seed(仕様 1章の7つの塊)を検証し、D1 に流す SQL を作る。
//
// - 何度流しても同じ結果になるよう INSERT OR IGNORE にする(既存の行は上書きしない)
// - 引き継ぎ帳の初期知識は、出典(誰が・いつ答えたか)のないものを弾く
// - demo: seed/demo.mjs(架空)→ seed/demo.sql。架空データであることを形で確かめる
//   (Slack ID は U_DEMO_ / C_DEMO_、解錠ID は demo-lock-)
// - production: 実店舗の seed(JSON。形は seed/demo.mjs と同じ)→ SQL。実データなので、リポジトリに置かない。
//   CI では GitHub の Environment production の Secret「PRODUCTION_SEED」から読む。
//   架空の形(U_DEMO_ など)が混ざっていたら止める。出力先は private/ かリポジトリの外だけ
//
// 使い方:
//   node scripts/build-seed.mjs [出力先(既定 seed/demo.sql)]
//   node scripts/build-seed.mjs --production <実店舗の seed の JSON> <出力先>

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const CLEANING_TYPE = { 毎日の店: "daily", 週次巡回の店: "weekly" };
const ROLE = { スタッフ: "staff", 副担当: "sub", オーナー: "owner" };
const KIND = { 場所: "place", 手順: "procedure", 判断: "judgment" };
const LOCK = { RemoteLOCK: "remotelock", その他: "other", なし: "none" };
const ACTION = {
  知らせる: "notify",
  下書きを作る: "draft",
  回数に数えない: "exclude_from_count",
  "1件に畳む": "merge",
  義務回数を変える: "change_quota",
  判断の基準にする: "judgment_basis",
};
const RECIPIENT = { オーナー: "owner", 副担当: "sub", 本人: "self" };
const URGENCY = { 即時: "immediate", 定時: "scheduled", 週次: "weekly" };

function frequency(f) {
  if (f === "毎日") return "daily";
  // 毎日が理想だが、N日までは空いてもよい(N+1日続けて空いたら繰り越し)
  const gap = f.match(/^毎日[((](\d+)日空いても可[))]$/);
  if (gap) return `daily_gap:${gap[1]}`;
  if (f === "来たときに") return "on_visit";
  const m = f.match(/^週(\d+)回$/);
  if (m) return `weekly:${m[1]}`;
  throw new Error(`清掃箇所の頻度が読めません: ${f}`);
}

function code(table, value, label) {
  if (value === null || value === undefined) return null;
  if (!(value in table)) throw new Error(`${label} の値が読めません: ${value}`);
  return table[value];
}

function sql(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "number") return String(v);
  if (typeof v === "object") v = JSON.stringify(v);
  return `'${String(v).replaceAll("'", "''")}'`;
}

function insert(table, row) {
  const cols = Object.keys(row);
  return `INSERT OR IGNORE INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((c) => sql(row[c])).join(", ")});`;
}

// JST の日時(YYYY-MM-DD HH:MM)→ UTC の ISO 8601
const JST_DATETIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;
export function jstToUtc(s) {
  const m = String(s).match(JST_DATETIME);
  if (!m) throw new Error(`日時の形が違います(YYYY-MM-DD HH:MM、JST): ${s}`);
  const [, y, mo, d, h, mi] = m.map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - 9, mi)).toISOString().replace(".000Z", "Z");
}

const DEMO_SHAPE = /U_DEMO_|C_DEMO_|demo-lock-/;
const REAL_USER = /^[UW][A-Z0-9]{8,12}$/;
const REAL_CHANNEL = /^[CG][A-Z0-9]{8,12}$/;

// 引き継ぎ帳の初期知識の1件を確かめる(店舗の塊7 と、全店の知識で同じ)
function checkKnowledge(q, personIds, dup, errors) {
  dup(q.id);
  if (!q.回答 || !q.答えた人 || !q.答えた) errors.push(`${q.id}: 出典(回答・答えた人・答えた日時)のない知識は入れない`);
  for (const t of [q.聞いた, q.答えた]) if (t && !JST_DATETIME.test(t)) errors.push(`${q.id}: 日時は YYYY-MM-DD HH:MM(JST)で書く: ${t}`);
  if (q.聞いた && q.答えた && JST_DATETIME.test(q.聞いた) && JST_DATETIME.test(q.答えた) && q.聞いた > q.答えた) errors.push(`${q.id}: 答えた日時が聞いた日時より前です`);
  if (q.答えた人 && !personIds.has(q.答えた人)) errors.push(`${q.id}: 答えた人 ${q.答えた人} が名簿にいません`);
  if (q.聞いた人 && !personIds.has(q.聞いた人)) errors.push(`${q.id}: 聞いた人 ${q.聞いた人} が名簿にいません`);
  if (q.種別 && !(q.種別 in KIND)) errors.push(`${q.id}: 種別は 場所 / 手順 / 判断 のどれか`);
}

export function validate({ people, stores, owner_rules, 運営の設定, 全店の知識 = [] }, { env = "demo" } = {}) {
  const errors = [];
  const prod = env === "production";
  if (!運営の設定) errors.push("運営の設定(塊3 のうち運営全体で決めるもの)がありません");
  const ids = new Set();
  const dup = (id) => (ids.has(id) ? errors.push(`id が重複しています: ${id}`) : ids.add(id));
  const personIds = new Set(people.map((p) => p.id));
  const storeIds = new Set(stores.map((s) => s.id));

  for (const p of people) {
    dup(p.id);
    if (prod) {
      // 実店舗: 架空の形が混ざっていたら止める。Slack ID は実際の形。解錠ID は入室の受け口ができるまで空でよい
      if (DEMO_SHAPE.test(`${p.slack ?? ""} ${p.解錠ID ?? ""}`)) errors.push(`${p.id}: 架空の ID(U_DEMO_・demo-lock-)が入っています`);
      else if (p.slack != null && !REAL_USER.test(p.slack)) errors.push(`${p.id}: Slack のメンバーID の形が違います(U で始まる英大文字と数字)`);
      if (p.解錠ID != null && (typeof p.解錠ID !== "string" || !p.解錠ID.trim())) errors.push(`${p.id}: 解錠ID は文字で書く(まだなければ null)`);
    } else {
      if (!/^U_DEMO_[A-Z0-9_]+$/.test(p.slack)) errors.push(`${p.id}: Slack ID は架空の形(U_DEMO_…)にする`);
      if (!/^demo-lock-[a-z0-9-]+$/.test(p.解錠ID)) errors.push(`${p.id}: 解錠ID は架空の形(demo-lock-…)にする`);
    }
    if (p.主な店舗 && !storeIds.has(p.主な店舗)) errors.push(`${p.id}: 主な店舗 ${p.主な店舗} がありません`);
    if (p.役割 !== "スタッフ" && p.義務の対象) errors.push(`${p.id}: オーナー・副担当は義務の対象外(仕様 3章)`);
  }
  for (const s of stores) {
    dup(s.id);
    for (const k of ["1_店舗", "2_清掃箇所", "3_スタッフ", "4_報告の手段", "5_入室記録", "6_連絡先と役割", "7_口調とよく聞かれる質問"]) {
      if (!(k in s)) errors.push(`${s.id}: 塊「${k}」がありません`);
    }
    const ch = s["4_報告の手段"]?.slackチャンネル ?? "";
    if (prod) {
      if (DEMO_SHAPE.test(ch)) errors.push(`${s.id}: 架空のチャンネル ID(C_DEMO_…)が入っています`);
      else if (ch && !REAL_CHANNEL.test(ch)) errors.push(`${s.id}: Slack のチャンネルID の形が違います(C で始まる英大文字と数字)`);
    } else if (!/^C_DEMO_[A-Z0-9_]+$/.test(ch)) errors.push(`${s.id}: チャンネルは架空の形(C_DEMO_…)にする`);
    for (const a of s["2_清掃箇所"] ?? []) dup(a.id);
    for (const m of s["3_スタッフ"]?.在籍 ?? []) if (!personIds.has(m)) errors.push(`${s.id}: 在籍 ${m} が名簿にいません`);
    const roles = s["6_連絡先と役割"] ?? {};
    for (const r of ["オーナー", "副担当"]) if (roles[r] && !personIds.has(roles[r])) errors.push(`${s.id}: ${r} ${roles[r]} が名簿にいません`);
    for (const q of s["7_口調とよく聞かれる質問"]?.よく聞かれる質問 ?? []) checkKnowledge(q, personIds, dup, errors);
    for (const a of s["2_清掃箇所"] ?? []) {
      try {
        frequency(a.頻度);
      } catch (e) {
        errors.push(`${a.id}: ${e.message}`);
      }
    }
  }
  for (const q of 全店の知識) checkKnowledge(q, personIds, dup, errors);
  const nos = new Set();
  for (const r of owner_rules) {
    if (nos.has(r.no)) errors.push(`ルール番号が重複しています: ${r.no}`);
    nos.add(r.no);
    if (r.店舗 && !storeIds.has(r.店舗)) errors.push(`ルール${r.no}: 店舗 ${r.店舗} がありません`);
  }
  if (errors.length) throw Object.assign(new Error("seed が不正です:\n- " + errors.join("\n- ")), { seedErrors: errors });
}

export function buildSeedSql(seed, { env = "demo", now = "2026-11-02T03:00:00Z" } = {}) {
  validate(seed, { env });
  const { people, stores, owner_rules, 運営の設定: org } = seed;
  const out = [
    env === "production"
      ? "-- 実店舗の seed から生成。実データなのでコミットしない・ログに出さない"
      : "-- seed/demo.mjs から生成(npm run seed:build)。手で編集しない。すべて架空データ",
    "",
  ];

  out.push(
    insert("org_settings", {
      id: 1,
      week_start: org.週の起算日,
      required_days_per_week: org.週の実施日数,
      areas_per_visit: org.来店時の清掃箇所数,
      attendance_style: org.出勤の決め方,
      exemption_policy: org.免除の制度,
      merge_window_minutes: org.二重送信の畳み込み分,
      unreported_after_minutes: org.未報告とみるまでの分,
    }),
    "",
  );

  for (const s of stores) {
    const c1 = s["1_店舗"], c4 = s["4_報告の手段"], c5 = s["5_入室記録"], c7 = s["7_口調とよく聞かれる質問"];
    out.push(
      insert("stores", {
        id: s.id,
        name: c1.店名,
        business_type: c1.業態,
        opening_hours: c1.営業時間,
        is_unmanned: c1.無人,
        cleaning_type: code(CLEANING_TYPE, c1.清掃の型, "清掃の型"),
        closed_days: { weekdays: c1.休業日.曜日, dates: c1.休業日.日付 },
        closed_day_policy: c1.休業日.決め方,
        slack_channel_id: c4.slackチャンネル,
        photo_required: c4.写真を必須にする,
        // テスト用の店舗チャンネルだけ true(オーナー・副担当の投稿も報告として受ける)。省略すると false
        accepts_operator_posts: c4.運営の投稿も報告として受ける === true,
        lock_type: code(LOCK, c5.鍵の種類, "鍵の種類"),
        lock_has_staff_ids: c5.スタッフごとの解錠IDがある,
        lock_shared_with_members: c5.会員も同じ鍵で入る,
        tone_sample: c7.口調サンプル,
      }),
    );
    s["2_清掃箇所"].forEach((a, i) =>
      out.push(insert("areas", { id: a.id, store_id: s.id, name: a.名前, frequency: frequency(a.頻度), sort_order: i + 1 })),
    );
  }
  out.push("");

  for (const p of people) {
    out.push(
      insert("staff", {
        id: p.id,
        display_name: p.呼び名,
        aliases: p.別名,
        slack_user_id: p.slack ?? null,
        unlock_id: p.解錠ID ?? null,
        is_obligated: p.義務の対象,
        role: code(ROLE, p.役割, "役割"),
        home_store_id: p.主な店舗,
      }),
    );
  }
  out.push("");

  // 質問を「オーナー確認中」で入れ、回答を積む(回答が積まれるとトリガーが回答済みにする)。store_id が NULL なら全店の知識
  const knowledgeRows = (q, storeId) => [
    insert("knowledge", {
      id: q.id,
      store_id: storeId,
      question: q.質問,
      kind: code(KIND, q.種別, "種別"),
      asked_by_staff_id: q.聞いた人 ?? null,
      asked_at: jstToUtc(q.聞いた ?? q.答えた),
      question_ref: "seed:立ち上げ面談",
    }),
    insert("knowledge_answers", {
      id: `${q.id}_a1`,
      knowledge_id: q.id,
      answer: q.回答,
      answered_by_staff_id: q.答えた人,
      answered_at: jstToUtc(q.答えた),
      answer_ref: "seed:立ち上げ面談",
    }),
  ];
  for (const s of stores) {
    for (const q of s["7_口調とよく聞かれる質問"].よく聞かれる質問) out.push(...knowledgeRows(q, s.id));
  }
  for (const q of seed.全店の知識 ?? []) out.push(...knowledgeRows(q, null));
  out.push("");

  for (const r of owner_rules) {
    out.push(
      insert("rules", {
        id: `rule_${r.no}`,
        rule_no: r.no,
        store_id: r.店舗,
        natural_text: r.自然文,
        condition: r.条件,
        target: r.対象,
        action: code(ACTION, r.動作, "動作"),
        recipient: code(RECIPIENT, r.宛先, "宛先"),
        urgency: code(URGENCY, r.緊急度, "緊急度"),
        origin: "interview",
        status: "active",
        activated_at: now,
      }),
    );
  }
  return out.join("\n") + "\n";
}

function summary(seed) {
  const n = seed.stores.reduce(
    (a, s) => ({ areas: a.areas + s["2_清掃箇所"].length, faq: a.faq + s["7_口調とよく聞かれる質問"].よく聞かれる質問.length }),
    { areas: 0, faq: (seed.全店の知識 ?? []).length },
  );
  const staffCount = seed.people.filter((p) => p.役割 === "スタッフ").length;
  return `店舗 ${seed.stores.length} / 清掃箇所 ${n.areas} / スタッフ ${staffCount} + 運営 ${seed.people.length - staffCount} / 知識 ${n.faq} / ルール ${seed.owner_rules.length}`;
}

// 実データの SQL を書いてよい場所: private/ の中か、リポジトリの外(CI の一時ディレクトリなど)
function allowedProductionOut(target) {
  const rel = relative(ROOT, target);
  const outside = rel.startsWith("..") || isAbsolute(rel);
  return outside || rel.split(sep)[0] === "private";
}

async function main() {
  if (process.argv[2] === "--production") {
    // 公開リポジトリの Actions のログは誰でも読める。不正なときも、件数だけ出して中身(ID・名前)は出さない。
    // 手元(private/)で中身を見たいときは --verbose を付ける
    const verbose = process.argv.includes("--verbose");
    const [input, output] = process.argv.slice(3).filter((a) => a !== "--verbose");
    if (!input || !output) throw new Error("使い方: node scripts/build-seed.mjs --production <実店舗の seed の JSON> <出力先>");
    const target = resolve(output);
    if (!allowedProductionOut(target)) throw new Error("実店舗の SQL は private/ の中かリポジトリの外に書いてください(実データをコミットしないため)");
    let seed;
    try {
      seed = JSON.parse(readFileSync(input, "utf8"));
    } catch {
      // 中身はログに出さない
      throw new Error("実店舗の seed が JSON として読めません(Secret PRODUCTION_SEED の貼り付けを確かめてください)");
    }
    let sqlText;
    try {
      sqlText = buildSeedSql(seed, { env: "production", now: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") });
    } catch (e) {
      if (verbose || !e.seedErrors) throw e;
      throw new Error(`実店舗の seed が不正です(${e.seedErrors.length}件)。ログに中身を出さないため、詳しくは private/ で --verbose を付けて確かめてください`);
    }
    writeFileSync(target, sqlText);
    console.log(`実店舗の seed を作りました(${summary(seed)})`);
    return;
  }
  const seed = await import(pathToFileURL(join(ROOT, "seed", "demo.mjs")).href);
  const target = resolve(process.argv[2] ?? join(ROOT, "seed", "demo.sql"));
  writeFileSync(target, buildSeedSql(seed));
  console.log(`seed を作りました: ${target}(${summary(seed)})`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // 失敗したときは文だけを出す(スタックや中身は出さない)
  await main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
