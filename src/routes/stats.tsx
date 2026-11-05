import { Hono } from "hono";
import type { Env } from "../env";
import { Layout } from "../views/Layout";

// 実稼働の数字(設計書 11章「これから残る証拠」)。件数だけで、本文は出さない。
// テスト用の店舗(運営の投稿も報告として受ける店)は数えない
export const stats = new Hono<{ Bindings: Env }>();

const REAL_STORES = "(SELECT id FROM stores WHERE accepts_operator_posts = 0)";

export type Stats = {
  reports: number;
  recheck: { flagged: number; photo: number; staff_word: number; report: number; open: number };
  handoff: { answered: number; waited: number; asked: number; owner_answers: number; candidates: number; approved: number };
  unreported: { detected: number; withdrawn: number; sent: number; rejected: number; pending: number };
};

export async function loadStats(db: D1Database): Promise<Stats> {
  const n = async (sql: string) => (await db.prepare(sql).first<{ n: number }>())?.n ?? 0;
  const byKey = async (sql: string) => {
    const { results } = await db.prepare(sql).all<{ k: string | null; n: number }>();
    return Object.fromEntries(results.map((r) => [r.k ?? "", r.n])) as Record<string, number>;
  };
  // 同じ日の同じ箇所は1件と数える(要確認 → 完了 → また要確認、は出来事としては2回でも箇所としては1つ)
  const item = "store_id || '|' || board_date || '|' || area_id";

  const cleared = await byKey(
    `SELECT basis AS k, count(DISTINCT ${item}) AS n FROM count_events WHERE kind = 'recheck_cleared' AND store_id IN ${REAL_STORES} GROUP BY basis`,
  );
  const handoff = await byKey(
    `SELECT kind AS k, count(*) AS n FROM count_events WHERE kind LIKE 'handoff_%' AND (store_id IS NULL OR store_id IN ${REAL_STORES}) GROUP BY kind`,
  );
  const findings = await byKey(`SELECT status AS k, count(*) AS n FROM findings WHERE kind = 'unreported' AND store_id IN ${REAL_STORES} GROUP BY status`);
  const drafts = await byKey(`SELECT status AS k, count(*) AS n FROM drafts WHERE store_id IN ${REAL_STORES} GROUP BY status`);
  // ルール候補は、元になった引き継ぎ帳の質問の店舗で判定する(テスト用の店舗の質問から生まれたものは数えない)。
  // 店舗を持たない質問(全店の知識)から生まれたものは数える
  const rules = await byKey(
    `SELECT r.status AS k, count(*) AS n FROM rules r JOIN knowledge k ON k.id = r.origin_knowledge_id
      WHERE r.origin = 'knowledge' AND (k.store_id IS NULL OR k.store_id IN ${REAL_STORES}) GROUP BY r.status`,
  );

  return {
    reports: await n(`SELECT count(*) AS n FROM reports WHERE merged_into_report_id IS NULL AND channel <> 'seed' AND store_id IN ${REAL_STORES}`),
    recheck: {
      flagged: await n(`SELECT count(DISTINCT ${item}) AS n FROM count_events WHERE kind = 'recheck_flagged' AND store_id IN ${REAL_STORES}`),
      photo: cleared.photo ?? 0,
      staff_word: cleared.staff_word ?? 0,
      report: cleared.report ?? 0,
      open: await n(`SELECT count(*) AS n FROM board_items WHERE status = 'needs_recheck' AND store_id IN ${REAL_STORES}`),
    },
    handoff: {
      answered: handoff.handoff_answered ?? 0,
      waited: handoff.handoff_waited ?? 0,
      asked: handoff.handoff_asked ?? 0,
      owner_answers: await n(
        `SELECT count(*) AS n FROM knowledge_answers a JOIN knowledge k ON k.id = a.knowledge_id
          WHERE a.answer_ref NOT LIKE 'seed:%' AND (k.store_id IS NULL OR k.store_id IN ${REAL_STORES})`,
      ),
      candidates: Object.values(rules).reduce((a, b) => a + b, 0),
      approved: rules.active ?? 0,
    },
    unreported: {
      detected: (findings.active ?? 0) + (findings.withdrawn ?? 0),
      withdrawn: findings.withdrawn ?? 0,
      sent: drafts.sent ?? 0,
      rejected: drafts.rejected ?? 0,
      pending: drafts.pending ?? 0,
    },
  };
}

function Row(props: { label: string; value: number; note?: string }) {
  return (
    <li>
      <span>
        {props.label}
        {props.note && <span class="note">{props.note}</span>}
      </span>
      <span class="status">{props.value}件</span>
    </li>
  );
}

export function StatsPage(props: { s: Stats; isDemo: boolean }) {
  const { s } = props;
  return (
    <Layout title="実稼働の数字">
      <header>
        {props.isDemo && <span class="pill demo">デモ(架空のデータ)</span>}
        <h1>実稼働の数字</h1>
        <p class="meta">動かし始めてからの合計。件数だけで、本文は出しません。テスト用の店舗は数えません。</p>
      </header>

      <section class="card plain" aria-labelledby="stats-report">
        <h2 id="stats-report">報告</h2>
        <ul class="board">
          <Row label="清掃報告" value={s.reports} note="5分以内の二重送信は1件にまとめて数える" />
        </ul>
      </section>

      <section class="card plain" aria-labelledby="stats-recheck">
        <h2 id="stats-recheck">写真で要確認</h2>
        <ul class="board">
          <Row label="要確認になった箇所" value={s.recheck.flagged} note="清掃後の写真に汚れ・ゴミが見えた" />
          <Row label="本人が直した(写真で確認)" value={s.recheck.photo} />
          <Row label="本人が直した(本人の申告)" value={s.recheck.staff_word} />
          <Row label="あとの報告で完了" value={s.recheck.report} />
          <Row label="いまも要確認" value={s.recheck.open} />
        </ul>
      </section>

      <section class="card plain" aria-labelledby="stats-handoff">
        <h2 id="stats-handoff">引き継ぎ帳</h2>
        <ul class="board">
          <Row label="出典つきで答えた質問" value={s.handoff.answered} />
          <Row label="オーナーに回した質問" value={s.handoff.asked} />
          <Row label="確認中の質問に重ねず待った" value={s.handoff.waited} />
          <Row label="オーナーの答えが積まれた" value={s.handoff.owner_answers} />
          <Row label="ルール候補になった" value={s.handoff.candidates} />
          <Row label="そのうち承認された" value={s.handoff.approved} />
        </ul>
      </section>

      <section class="card plain" aria-labelledby="stats-unreported">
        <h2 id="stats-unreported">入室したのに報告なし</h2>
        <ul class="board">
          <Row label="検出した" value={s.unreported.detected} note="遅れて届いた報告で取り下げたものを含む" />
          <Row label="そのうち取り下げた" value={s.unreported.withdrawn} />
          <Row label="声かけを承認して送った" value={s.unreported.sent} />
          <Row label="送らなかった" value={s.unreported.rejected} />
          <Row label="承認待ち" value={s.unreported.pending} />
        </ul>
      </section>

      <p class="meta" style="margin-top:12px">
        <a href="/">店舗の一覧へ</a> <a href="/usage">Claude の消費</a>
      </p>
    </Layout>
  );
}

stats.get("/stats", async (c) => c.html(<StatsPage s={await loadStats(c.env.DB)} isDemo={c.env.ENVIRONMENT === "demo"} />));
