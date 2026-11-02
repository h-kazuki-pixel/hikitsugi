// demo の D1 に、デモ用ワークスペースの実際の Slack ID を結びつける(CI の deploy-demo から呼ぶ)
//
// seed の Slack ID は架空の形(U_DEMO_… / C_DEMO_…)で、実際のワークスペースの ID とは一致しない。
// 実際の ID は公開リポジトリにコミットしない決まりなので、GitHub の demo 環境の Secret「DEMO_SLACK_IDS」から読み、
// seed を入れたあとに UPDATE で上書きする。seed は INSERT OR IGNORE なので、次のデプロイでも元に戻らない。
//
// DEMO_SLACK_IDS の形(1行に1つ。足りない行は飛ばす):
//   owner=U…  aoi=U…  haruto=U…  mio=U…  sota=U…  sub=U…   ← 人(staff.slack_user_id)
//   tenjin=C…  yakuin=C…                                   ← 店舗チャンネル(stores.slack_channel_id)
//
// 使い方: node scripts/ci/apply-demo-slack-ids.mjs <出力する SQL のパス>
//   SQL を書き出すだけ。D1 への適用はワークフローが wrangler d1 execute で行う。ID はログに出さない。

import { writeFileSync } from "node:fs";

const PEOPLE = { owner: "staff_owner", sub: "staff_sub", aoi: "staff_aoi", haruto: "staff_haruto", mio: "staff_mio", sota: "staff_sota" };
const STORES = { tenjin: "tenjin", yakuin: "yakuin" };

export function buildSql(raw) {
  const statements = [];
  const errors = [];
  for (const line of (raw ?? "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([a-z]+)\s*=\s*(\S+)$/);
    if (!m) { errors.push(`形が読めない行があります(「名前=ID」の形にする)`); continue; }
    const [, key, id] = m;
    if (PEOPLE[key]) {
      if (!/^[UW][A-Z0-9]{6,}$/.test(id)) { errors.push(`${key}: 人の ID は U で始まる英大文字と数字にする`); continue; }
      statements.push(`UPDATE staff SET slack_user_id = '${id}' WHERE id = '${PEOPLE[key]}';`);
    } else if (STORES[key]) {
      if (!/^C[A-Z0-9]{6,}$/.test(id)) { errors.push(`${key}: チャンネルの ID は C で始まる英大文字と数字にする`); continue; }
      statements.push(`UPDATE stores SET slack_channel_id = '${id}' WHERE id = '${STORES[key]}';`);
    } else {
      errors.push(`${key}: 知らない名前です(使えるのは ${[...Object.keys(PEOPLE), ...Object.keys(STORES)].join(" / ")})`);
    }
  }
  return { sql: statements.join("\n") + (statements.length ? "\n" : ""), count: statements.length, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2];
  if (!out) { console.error("出力先の SQL のパスを渡してください"); process.exit(2); }
  const { sql, count, errors } = buildSql(process.env.DEMO_SLACK_IDS);
  for (const e of errors) console.log(`::warning::DEMO_SLACK_IDS: ${e}`);
  writeFileSync(out, sql);
  console.log(`DEMO_SLACK_IDS から ${count} 件の結びつけを用意しました`);
}
