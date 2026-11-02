// 引き継ぎ帳の検索(現場エージェントのツール search_knowledge の中身)
//
// 知識は「人が実際に答えた言葉」だけ(設計書 5-5)。検索は語の重なりで候補を並べるだけで、
// 当たっているかの判断は Claude が候補を読んで行う。答えのない質問(オーナー確認中)も候補に出す
// (同じ質問で二度オーナーに聞かないため)。
// asOf を渡すと、その時刻までに人が答えた内容だけを返す(過去の質問の流し直しで使う)。

export type KnowledgeHit = {
  id: string;
  question: string;
  kind: "place" | "procedure" | "judgment" | null;
  status: "answered" | "pending_owner";
  answer: string | null;
  answered_by: string | null; // 出典: 誰が(呼び名)
  answered_at: string | null; // 出典: いつ(ISO)
  score: number;
};

// 日本語は分かち書きしないので、2文字ずつの重なりで近さを測る
function bigrams(s: string): Set<string> {
  const t = s.replace(/[\s、。!?！？「」()()・,.]/g, "");
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  if (t.length === 1) out.add(t);
  return out;
}

export function similarity(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  if (x.size === 0 || y.size === 0) return 0;
  let n = 0;
  for (const g of x) if (y.has(g)) n++;
  return n / Math.min(x.size, y.size);
}

export async function searchKnowledge(
  db: D1Database,
  storeId: string | null,
  query: string,
  opts: { limit?: number; asOf?: string } = {},
): Promise<KnowledgeHit[]> {
  const asOf = opts.asOf ?? "9999-12-31T23:59:59Z";
  const { results } = await db
    .prepare(
      `SELECT k.id, k.question, k.kind,
              a.answer, s.display_name AS answered_by, a.answered_at
         FROM knowledge k
         LEFT JOIN knowledge_answers a
           ON a.id = (SELECT id FROM knowledge_answers
                       WHERE knowledge_id = k.id AND answered_at <= ?
                       ORDER BY answered_at DESC, created_at DESC LIMIT 1)
         LEFT JOIN staff s ON s.id = a.answered_by_staff_id
        WHERE (k.store_id = ? OR k.store_id IS NULL) AND k.asked_at <= ?`,
    )
    .bind(asOf, storeId, asOf)
    .all<Omit<KnowledgeHit, "score" | "status">>();

  return results
    .map((r) => ({
      ...r,
      status: (r.answer ? "answered" : "pending_owner") as KnowledgeHit["status"],
      score: Math.round(similarity(query, r.question) * 100) / 100,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 6);
}

// 出典の表記: 「(9/14 デモオーナーの回答)」。日付は JST
export function sourceLabel(answeredBy: string, answeredAtIso: string): string {
  const d = new Date(new Date(answeredAtIso).getTime() + 9 * 60 * 60 * 1000);
  return `(${d.getUTCMonth() + 1}/${d.getUTCDate()} ${answeredBy}の回答)`;
}
