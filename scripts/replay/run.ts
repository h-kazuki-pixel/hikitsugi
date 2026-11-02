// 過去の質問の流し直し(設計書 5-5)を手元で回す
//
//   ANTHROPIC_API_KEY=... npx tsx scripts/replay/run.ts scripts/replay/sample.csv
//
// 実店舗の質問(実名入り)は private/ に置いて回す(private/ はコミットしない)。
// 標準出力には件数と割合だけを出す。1件ごとの結果は private/replay-items.json に書く。
// 本番と同じエージェント(claude-opus-5-5)と、趣旨の判定(claude-sonnet-5-5)を使う。

import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { claudeJudge, parseCsv, replay } from "../../src/replay/replay";

const file = process.argv[2];
const key = process.env.ANTHROPIC_API_KEY;
if (!file || !key) {
  console.error("使い方: ANTHROPIC_API_KEY=... npx tsx scripts/replay/run.ts <質問の CSV>");
  process.exit(1);
}

const client = new Anthropic({ apiKey: key });
const create = (p: Anthropic.MessageCreateParamsNonStreaming) => client.messages.create(p);
const rows = parseCsv(readFileSync(file, "utf8"));
console.error(`${rows.length}件を時系列で流します`);

const { items, summary } = await replay(rows, {
  call: create,
  judge: claudeJudge(create),
  onItem: (item, i) => console.error(`${i + 1}/${rows.length} ${item.outcome}${item.verdict ? ` (${item.verdict})` : ""}`),
});

mkdirSync("private", { recursive: true });
writeFileSync("private/replay-items.json", JSON.stringify(items, null, 2));
console.log(JSON.stringify(summary, null, 2));
