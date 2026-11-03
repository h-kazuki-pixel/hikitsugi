// 過去の質問の CSV と当時の答えの CSV を結んで、流し直しの CSV を private/ に書く(src/replay/join.ts)
//
//   npm run replay:join private/staff_questions_v2.csv private/staff_answers_v1.csv
//
// 出力は private/questions.csv(実名・本文を含むので private/ の外には書かない)。
// 画面に出すのは件数だけ。

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, relative, sep } from "node:path";
import { joinQuestionsAndAnswers } from "../../src/replay/join";

const [questions, answers, out = "private/questions.csv"] = process.argv.slice(2);
if (!questions || !answers) {
  console.error("使い方: npm run replay:join <質問の CSV> <答えの CSV> [出力先。既定は private/questions.csv]");
  process.exit(1);
}
const rel = relative(resolve("private"), resolve(out));
if (rel.startsWith("..") || rel.startsWith(sep) || rel === "") {
  console.error("出力先は private/ の中にしてください(実データをリポジトリに入れないため)");
  process.exit(1);
}

const { csv, stats } = joinQuestionsAndAnswers(readFileSync(questions, "utf8"), readFileSync(answers, "utf8"));
writeFileSync(out, csv);
console.error(`${out} に書きました`);
console.log(JSON.stringify(stats, null, 2));
