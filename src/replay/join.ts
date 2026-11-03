// 過去の質問の CSV と、当時の答えの CSV を結んで、流し直しの CSV(replay.ts の形)にする
//
// 質問の CSV(列): 分類, 出所, 日時, 曜日区分, スタッフ, 返信まで(分), メッセージ
// 答えの CSV(列): 元の行, 出所, 質問日時, 回答した人(役割), 回答本文, 種類, 備考
//   「元の行」は質問の CSV の行番号(見出しが1行目)
//   種類は「再利用できる答え」(「再利用できる答え(…の部分)」を含む)/「その場の対応」/「答えなし」
//
// 決めごと(11/3 オーナーの判断):
//   - 帳に積むのは「再利用できる答え」だけ(reusable = 1)
//   - 答えの時刻は分からないので、質問の時刻で近似する(各質問の時点では、厳密にそれより前の答えだけが見える)。
//     実際の回答時刻で確かめて、近似で未来の答えが見える組は 0件だった
//   - 日時は答えの CSV の「質問日時」を使う(質問の CSV の日時を直した行があるため)
//   - 休日 = 曜日区分が「休日」。営業時間外 = 「休日」+「平日18時以降」
//
// 実名・本文を含むので、入力も出力も private/ にだけ置く。ここが出す集計は件数だけ。

import { parseCsvRows } from "./replay";

export type JoinStats = {
  questions: number;
  joined: number;
  reusable: number;
  situational: number;
  no_answer: number;
  holiday: number;
  off_hours: number;
  date_differs: number; // 答えの CSV で日時を直した行
};

const DAY = { 休日: { holiday: true, off: true }, 平日18時以降: { holiday: false, off: true }, 平日: { holiday: false, off: false } } as const;

function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// 「2024/08/18 10:23」→「2024-08-18 10:23」(JST のまま。replay.ts が ISO にする)
function jst(v: string): string {
  const m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) throw new Error(`日時の形が読めません: 「${v.slice(0, 20)}」`);
  const p = (s: string) => s.padStart(2, "0");
  return `${m[1]}-${p(m[2]!)}-${p(m[3]!)} ${p(m[4]!)}:${m[5]}`;
}

// Slack のメンション(<@U…|名前>、<!here>)は質問の中身ではないので落とす
function cleanQuestion(v: string): string {
  return v.replace(/<@[A-Z0-9]+(\|[^>]*)?>/g, "@").replace(/<![a-z]+>/g, "").trim();
}

export function joinQuestionsAndAnswers(questionsCsv: string, answersCsv: string): { csv: string; stats: JoinStats } {
  const [qHead, ...qBody] = parseCsvRows(questionsCsv);
  const [aHead, ...aBody] = parseCsvRows(answersCsv);
  if (!qHead || !aHead) throw new Error("CSV が空です");
  const col = (head: string[], name: string) => {
    const i = head.indexOf(name);
    if (i < 0) throw new Error(`列「${name}」がありません`);
    return i;
  };
  const q = { at: col(qHead, "日時"), day: col(qHead, "曜日区分"), text: col(qHead, "メッセージ") };
  const a = { line: col(aHead, "元の行"), at: col(aHead, "質問日時"), by: col(aHead, "回答した人(役割)"), body: col(aHead, "回答本文"), kind: col(aHead, "種類") };

  const answers = new Map<number, string[]>();
  for (const r of aBody) {
    const line = Number(r[a.line]);
    if (!Number.isInteger(line) || line < 2) throw new Error(`元の行が読めません(答えの CSV の ${aBody.indexOf(r) + 2}行目)`);
    if (answers.has(line)) throw new Error(`元の行 ${line} が答えの CSV に2回あります`);
    answers.set(line, r);
  }

  const stats: JoinStats = { questions: qBody.length, joined: 0, reusable: 0, situational: 0, no_answer: 0, holiday: 0, off_hours: 0, date_differs: 0 };
  const out = [["id", "asked_at", "question", "answered_at", "answered_by", "answer", "kind", "off_hours", "holiday", "reusable"].join(",")];
  qBody.forEach((r, i) => {
    const line = i + 2; // 見出しが1行目
    const ans = answers.get(line);
    if (!ans) throw new Error(`元の行 ${line} の答えが、答えの CSV にありません`);
    stats.joined++;
    const day = DAY[(r[q.day] ?? "").trim() as keyof typeof DAY];
    if (!day) throw new Error(`元の行 ${line} の曜日区分が読めません`);
    const kindText = (ans[a.kind] ?? "").trim();
    const kind = kindText.startsWith("再利用できる答え") ? "reusable" : kindText === "その場の対応" ? "situational" : kindText === "答えなし" ? "none" : null;
    if (!kind) throw new Error(`元の行 ${line} の種類が読めません`);
    const body = (ans[a.body] ?? "").trim();
    if (kind !== "none" && !body) throw new Error(`元の行 ${line} は種類が「${kindText}」なのに回答本文が空です`);

    const qAt = jst(r[q.at] ?? "");
    const askedAt = (ans[a.at] ?? "").trim() ? jst(ans[a.at]!) : qAt;
    if (askedAt !== qAt) stats.date_differs++;
    if (kind === "reusable") stats.reusable++;
    else if (kind === "situational") stats.situational++;
    else stats.no_answer++;
    if (day.holiday) stats.holiday++;
    if (day.off) stats.off_hours++;

    out.push(
      [
        `r${line}`,
        askedAt,
        cleanQuestion(r[q.text] ?? ""),
        kind === "none" ? "" : askedAt, // 答えの時刻は質問の時刻で近似する
        kind === "none" ? "" : (ans[a.by] ?? "").trim(),
        kind === "none" ? "" : body,
        "", // 種別(場所/手順/判断)はこの CSV にない
        day.off ? "1" : "0",
        day.holiday ? "1" : "0",
        kind === "reusable" ? "1" : "0",
      ]
        .map(csvCell)
        .join(","),
    );
  });
  if (answers.size !== qBody.length) throw new Error(`答えの CSV に、質問の CSV にない行があります(答え ${answers.size}件、質問 ${qBody.length}件)`);
  return { csv: out.join("\n") + "\n", stats };
}
