// 過去の質問の流し直し(設計書 5-5)を手元で回す
//
//   ANTHROPIC_API_KEY=... npx tsx scripts/replay/run.ts scripts/replay/sample.csv
//
// 実店舗の質問(実名入り)は private/ に置いて回す(private/ はコミットしない)。
// 標準出力には件数と割合だけを出す。1件ごとの結果は private/replay-items.json に書く。
// 本番と同じエージェント(claude-opus-5-5)と、趣旨の判定・帳に答えがあったはずかの判定(claude-sonnet-5-5)を使う。
// 帳に答えがあったはずかの判定を省くときは --no-answerable を付ける。

import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { claudeAnswerable, claudeJudge, parseCsv, replay } from "../../src/replay/replay";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const withAnswerable = !args.includes("--no-answerable");
const key = process.env.ANTHROPIC_API_KEY;
if (!file || !key) {
  console.error("使い方: ANTHROPIC_API_KEY=... npx tsx scripts/replay/run.ts <質問の CSV>");
  process.exit(1);
}

const client = new Anthropic({ apiKey: key });
// 判定の分も含めた、この実行の消費(summary.tokens はエージェントの分だけ)
const all = { input: 0, output: 0 };
const create = async (p: Anthropic.MessageCreateParamsNonStreaming) => {
  const res = await client.messages.create(p);
  all.input += res.usage.input_tokens;
  all.output += res.usage.output_tokens;
  return res;
};
const rows = parseCsv(readFileSync(file, "utf8"));
console.error(`${rows.length}件を時系列で流します`);

const { items, summary } = await replay(rows, {
  call: create,
  judge: claudeJudge(create),
  ...(withAnswerable ? { answerable: claudeAnswerable(create) } : {}),
  onItem: (item, i) =>
    console.error(`${i + 1}/${rows.length} ${item.outcome}${item.verdict ? ` (${item.verdict})` : ""}${item.answerable ? (item.answerable.id ? " 帳に答えあり" : " 帳に答えなし") : ""}`),
});

mkdirSync("private", { recursive: true });
writeFileSync("private/replay-items.json", JSON.stringify(items, null, 2));
console.log(JSON.stringify({ ...summary, tokens_all_calls: all }, null, 2));
