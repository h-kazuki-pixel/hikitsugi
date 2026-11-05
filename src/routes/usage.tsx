import { Hono } from "hono";
import type { Env } from "../env";
import { Layout } from "../views/Layout";

// 製品の中の Claude 呼び出しの消費(種類ごと)。production ではオーナー画面ごと Access の背後
// 金額は出さない(単価は Console の請求で確かめる。ここではトークン数だけを正確に出す)
export const usage = new Hono<{ Bindings: Env }>();

const KIND_LABEL: Record<string, string> = {
  structure: "報告の構造化(写真・文)",
  rule_check: "ルールの照合(写真つき)",
  recheck_photo: "要確認の写真の見直し",
  clarify_answer: "聞き返しへの答え",
  handoff_agent: "引き継ぎ帳",
  night_check: "夜の突き合わせ",
  rule_draft: "ルール候補の文面",
  rule_structure: "自然文ルールの構造化",
};

// 写真を読む呼び出しは、写真の枚数ごとにも出す(写真1枚でどれだけ増えるかを README に書くため。文だけの投稿と混ぜない)
const PHOTO_KINDS = ["structure", "rule_check", "recheck_photo"];
type ByImages = { kind: string; model: string; images: number; n: number; avg_in: number; avg_out: number };

type Row = { kind: string; model: string; n: number; avg_in: number; avg_out: number; sum_in: number; sum_out: number; avg_turns: number; avg_images: number; n_truncated: number };

usage.get("/usage", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT kind, model, count(*) AS n,
            round(avg(input_tokens)) AS avg_in, round(avg(output_tokens)) AS avg_out,
            sum(input_tokens) AS sum_in, sum(output_tokens) AS sum_out,
            round(avg(turns), 1) AS avg_turns, round(avg(images), 1) AS avg_images, sum(truncated) AS n_truncated
       FROM claude_usage GROUP BY kind, model ORDER BY sum_in DESC`,
  ).all<Row>();
  const { results: byImages } = await c.env.DB.prepare(
    `SELECT kind, model, images, count(*) AS n, round(avg(input_tokens)) AS avg_in, round(avg(output_tokens)) AS avg_out
       FROM claude_usage WHERE kind IN (${PHOTO_KINDS.map(() => "?").join(", ")})
      GROUP BY kind, model, images ORDER BY kind, model, images`,
  )
    .bind(...PHOTO_KINDS)
    .all<ByImages>();
  const total = results.reduce((t, r) => ({ n: t.n + r.n, i: t.i + r.sum_in, o: t.o + r.sum_out }), { n: 0, i: 0, o: 0 });
  return c.html(
    <Layout title="Claude の消費">
      <header>
        {c.env.ENVIRONMENT === "demo" && <span class="pill demo">デモ(架空のデータ)</span>}
        <h1>Claude の消費</h1>
        <div class="meta">
          呼び出し {total.n}回 / 入力 {total.i.toLocaleString()} / 出力 {total.o.toLocaleString()} トークン
        </div>
      </header>
      <section class="card plain">
        {results.length === 0 ? (
          <p class="empty">まだ記録がありません。</p>
        ) : (
          <ul class="rules">
            {results.map((r) => (
              <li>
                <p class="rule-text">
                  {KIND_LABEL[r.kind] ?? r.kind} <span class="meta" style="display:inline">{r.model}</span>
                </p>
                <p class="meta">
                  {r.n}回 / 1回あたり 入力 {r.avg_in.toLocaleString()}・出力 {r.avg_out.toLocaleString()} トークン
                  {r.avg_turns > 1 ? ` / 往復 ${r.avg_turns}` : ""}
                  {r.avg_images > 0 ? ` / 写真 ${r.avg_images}枚` : ""}
                  {r.n_truncated > 0 ? ` / 上限で切れた ${r.n_truncated}回` : ""}
                </p>
                {PHOTO_KINDS.includes(r.kind) && (
                  <ul class="note">
                    {byImages
                      .filter((b) => b.kind === r.kind && b.model === r.model)
                      .map((b) => (
                        <li>
                          写真{b.images}枚: {b.n}回 / 1回あたり 入力 {b.avg_in.toLocaleString()}・出力 {b.avg_out.toLocaleString()} トークン
                        </li>
                      ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Layout>,
  );
});
