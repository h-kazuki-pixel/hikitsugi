#!/usr/bin/env node
// seed/demo.mjs(仕様 1章の7つの塊)を検証し、D1 に流す SQL(seed/demo.sql)を作る。
//
// - 何度流しても同じ結果になるよう INSERT OR IGNORE にする(既存の行は上書きしない)
// - 架空データであることを形で確かめる(Slack ID は U_DEMO_ / C_DEMO_、解錠ID は demo-lock-)
// - 引き継ぎ帳の初期知識は、出典(誰が・いつ答えたか)のないものを弾く
//
// 使い方: node scripts/build-seed.mjs [出力先(既定 seed/demo.sql)]

import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const CLEANING_TYPE = { 毎日の店: "daily", 週次巡回の店: "weekly" };
const ROLE = { スタッフ: "staff", 副担当: "sub", オーナー: "owner" };
const KIND = { 場所: "place", 手順: "procedure", 判断: "judgment" };
const LOCK = { RemoteLOCK: "remotelock", その他: "other", なし: "none" };
const COUNT_SCOPE = { 全店合計: "all_stores", 店舗ごと: "per_store" };
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

// ISO 日付(JST)→ その日の 12:00 JST を UTC で(出典の日時として使う)
const jstNoon = (d) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`日付の形が違います: ${d}`);
  return `${d}T03:00:00Z`;
};

export function validate({ people, stores, owner_rules }) {
  const errors = [];
  const ids = new Set();
  const dup = (id) => (ids.has(id) ? errors.push(`id が重複しています: ${id}`) : ids.add(id));
  const personIds = new Set(people.map((p) => p.id));
  const storeIds = new Set(stores.map((s) => s.id));

  for (const p of people) {
    dup(p.id);
    if (!/^U_DEMO_[A-Z0-9_]+$/.test(p.slack)) errors.push(`${p.id}: Slack ID は架空の形(U_DEMO_…)にする`);
    if (!/^demo-lock-[a-z0-9-]+$/.test(p.解錠ID)) errors.push(`${p.id}: 解錠ID は架空の形(demo-lock-…)にする`);
    if (p.主な店舗 && !storeIds.has(p.主な店舗)) errors.push(`${p.id}: 主な店舗 ${p.主な店舗} がありません`);
    if (p.役割 !== "スタッフ" && p.義務の対象) errors.push(`${p.id}: オーナー・副担当は義務の対象外(仕様 3章)`);
  }
  for (const s of stores) {
    dup(s.id);
    for (const k of ["1_店舗", "2_清掃箇所", "3_スタッフ", "4_報告の手段", "5_入室記録", "6_連絡先と役割", "7_口調とよく聞かれる質問"]) {
      if (!(k in s)) errors.push(`${s.id}: 塊「${k}」がありません`);
    }
    if (!/^C_DEMO_[A-Z0-9_]+$/.test(s["4_報告の手段"]?.slackチャンネル ?? "")) errors.push(`${s.id}: チャンネルは架空の形(C_DEMO_…)にする`);
    for (const a of s["2_清掃箇所"] ?? []) dup(a.id);
    for (const m of s["3_スタッフ"]?.在籍 ?? []) if (!personIds.has(m)) errors.push(`${s.id}: 在籍 ${m} が名簿にいません`);
    const roles = s["6_連絡先と役割"] ?? {};
    for (const r of ["オーナー", "副担当"]) if (roles[r] && !personIds.has(roles[r])) errors.push(`${s.id}: ${r} ${roles[r]} が名簿にいません`);
    for (const q of s["7_口調とよく聞かれる質問"]?.よく聞かれる質問 ?? []) {
      dup(q.id);
      if (!q.回答 || !q.答えた人 || !q.答えた日) errors.push(`${q.id}: 出典(回答・答えた人・答えた日)のない知識は入れない`);
      if (q.答えた人 && !personIds.has(q.答えた人)) errors.push(`${q.id}: 答えた人 ${q.答えた人} が名簿にいません`);
      if (q.聞いた人 && !personIds.has(q.聞いた人)) errors.push(`${q.id}: 聞いた人 ${q.聞いた人} が名簿にいません`);
    }
  }
  const nos = new Set();
  for (const r of owner_rules) {
    if (nos.has(r.no)) errors.push(`ルール番号が重複しています: ${r.no}`);
    nos.add(r.no);
    if (r.店舗 && !storeIds.has(r.店舗)) errors.push(`ルール${r.no}: 店舗 ${r.店舗} がありません`);
  }
  if (errors.length) throw new Error("seed が不正です:\n- " + errors.join("\n- "));
}

export function buildSeedSql(seed) {
  validate(seed);
  const { people, stores, owner_rules } = seed;
  const out = ["-- seed/demo.mjs から生成(npm run seed:build)。手で編集しない。すべて架空データ", ""];

  for (const s of stores) {
    const c1 = s["1_店舗"], c3 = s["3_スタッフ"], c4 = s["4_報告の手段"], c5 = s["5_入室記録"], c7 = s["7_口調とよく聞かれる質問"];
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
        week_start: c3.週の起算日,
        required_days_per_week: c3.週の実施日数,
        count_scope: code(COUNT_SCOPE, c3.数え方, "数え方"),
        areas_per_visit: c3.来店時の清掃箇所数,
        attendance_style: c3.出勤の決め方,
        exemption_policy: c3.免除の制度,
        merge_window_minutes: c3.二重送信の畳み込み分,
        unreported_after_minutes: c3.未報告とみるまでの分,
        slack_channel_id: c4.slackチャンネル,
        photo_required: c4.写真を必須にする,
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
        slack_user_id: p.slack,
        unlock_id: p.解錠ID,
        is_obligated: p.義務の対象,
        role: code(ROLE, p.役割, "役割"),
        home_store_id: p.主な店舗,
      }),
    );
  }
  out.push("");

  for (const s of stores) {
    for (const q of s["7_口調とよく聞かれる質問"].よく聞かれる質問) {
      out.push(
        insert("knowledge", {
          id: q.id,
          store_id: s.id,
          question: q.質問,
          answer: q.回答,
          kind: code(KIND, q.種別, "種別"),
          asked_by_staff_id: q.聞いた人 ?? null,
          asked_at: jstNoon(q.聞いた日 ?? q.答えた日),
          answered_by_staff_id: q.答えた人,
          answered_at: jstNoon(q.答えた日),
          status: "answered",
          source_ref: "seed:立ち上げ面談",
        }),
      );
    }
  }
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
        activated_at: "2026-11-02T03:00:00Z",
      }),
    );
  }
  return out.join("\n") + "\n";
}

async function main() {
  const seed = await import(pathToFileURL(join(ROOT, "seed", "demo.mjs")).href);
  const target = resolve(process.argv[2] ?? join(ROOT, "seed", "demo.sql"));
  writeFileSync(target, buildSeedSql(seed));
  const n = seed.stores.reduce(
    (a, s) => ({ areas: a.areas + s["2_清掃箇所"].length, faq: a.faq + s["7_口調とよく聞かれる質問"].よく聞かれる質問.length }),
    { areas: 0, faq: 0 },
  );
  const staffCount = seed.people.filter((p) => p.役割 === "スタッフ").length;
  console.log(
    `seed を作りました: ${target}(店舗 ${seed.stores.length} / 清掃箇所 ${n.areas} / スタッフ ${staffCount} + 運営 ${seed.people.length - staffCount} / 知識 ${n.faq} / ルール ${seed.owner_rules.length})`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
