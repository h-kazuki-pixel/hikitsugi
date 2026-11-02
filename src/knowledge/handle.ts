// 引き継ぎ帳の最小形(設計書 5-5、5-6「どれだけ削っても残すもの」)
//
//   知らない質問 → スタッフに「確認中(休業日なら遅れる)」と返す → オーナーに一度だけ聞く
//   → オーナーが DM のスレッドで答える → スタッフに返し、回答を出典つきで積む → 次から出典つきで答える
//
// スタッフへの返事は、本人が送ってきた質問へのスレッド返事だけ(承認不要)。オーナーへの問い合わせも承認不要
// (宛先が運営側。設計書 5-4)。スタッフに返す文はすべてコードが組む(回答の原文 + 出典 / 決まった文)。
// 回答は追記のみ(knowledge_answers のトリガー)。答えが変わったら、前の回答を指して新しく積む。

import type { ReportEvent } from "../channels/report-event";
import { jstDate } from "../lib/time";
import { recordUsage } from "../lib/usage";
import type { SlackClient } from "../slack/api";
import { isClosedDay } from "../views/StorePage";
import { d1Search, runHandoffAgent, type Decision, type ModelCall } from "./agent";
import { createRuleCandidate, type RuleDrafter } from "../rules/candidate";
import { answerText, sourceLabel } from "./search";

export type KnowledgeDeps = { slack: SlackClient; agent: ModelCall; draftRule: RuleDrafter; newId: () => string };

type Store = { id: string; name: string; closed_days: string };
type Person = { id: string; display_name: string; role: "staff" | "sub" | "owner"; home_store_id: string | null };

export type QuestionOutcome =
  | { kind: "question"; decision: Decision["type"]; knowledgeId: string | null; replied: boolean; ownerAsked: boolean }
  | { kind: "owner_answer"; knowledgeId: string; answerId: string; repliedToStaff: boolean; ruleCandidate: { ruleId: string; ruleNo: number } | null }
  | { kind: "ignored"; reason: string };

export const TEXT = {
  asking: "オーナーに確認します。答えが来たら、このスレッドに返します。",
  waiting: "同じことをいまオーナーに確認しています。答えが来たら、このスレッドにも返します。",
  closed: "今日は休業日なので、返事が遅れるかもしれません。",
} as const;

export async function lookupPerson(db: D1Database, slackUserId: string): Promise<Person | null> {
  return db
    .prepare("SELECT id, display_name, role, home_store_id FROM staff WHERE slack_user_id = ? AND status = 'active'")
    .bind(slackUserId)
    .first<Person>();
}

async function storeById(db: D1Database, id: string | null): Promise<Store | null> {
  if (!id) return null;
  return db.prepare("SELECT id, name, closed_days FROM stores WHERE id = ?").bind(id).first<Store>();
}

// スタッフ・副担当からの質問(店舗チャンネルの「質問」に分類された投稿、またはボットへの DM)
export async function handleQuestion(
  db: D1Database,
  ev: ReportEvent,
  deps: KnowledgeDeps,
  ctx: { store: Store | null; sender: Person | null },
): Promise<QuestionOutcome> {
  if (!ctx.sender || ctx.sender.role === "owner") return { kind: "ignored", reason: "not_staff_question" };

  // キューの再配達で同じ質問を二度オーナーに聞かない
  const seen = await db
    .prepare("SELECT 1 FROM knowledge WHERE question_channel_ref = ? AND question_ref = ?")
    .bind(ev.channelRef, ev.messageRef)
    .first();
  if (seen) return { kind: "ignored", reason: "duplicate" };

  // DM は店舗が決まらないので、質問した人の主な店舗で探す
  const store = ctx.store ?? (await storeById(db, ctx.sender.home_store_id));
  const run = await runHandoffAgent(
    d1Search(db, store?.id ?? null),
    { storeName: store?.name ?? "全店", senderName: ctx.sender.display_name, question: ev.text },
    deps.agent,
  );
  // 判断経路と消費を残す(質問の本文は出さない)
  await recordUsage(db, { kind: "handoff_agent", ...run.usage, store_id: store?.id ?? null }, { decision: run.decision.type, steps: run.steps.map((s) => s.tool) });

  const closed = store ? isClosedDay(store.closed_days, jstDate(new Date(ev.sentAt))) : false;
  const reply = (text: string) =>
    deps.slack
      .postMessage(ev.channelRef, text, ev.threadRef)
      .then((r) => r.ok)
      .catch(() => false);

  const d = run.decision;
  if (d.type === "answer") {
    const replied = await reply(answerText(d.hit));
    return { kind: "question", decision: "answer", knowledgeId: d.hit.id, replied, ownerAsked: false };
  }
  if (d.type === "wait") {
    // オーナーには二度聞かない。答えが来たらこの人のスレッドにも返す
    await db
      .prepare("INSERT OR IGNORE INTO knowledge_waiters (id, knowledge_id, staff_id, channel_ref, message_ref) VALUES (?, ?, ?, ?, ?)")
      .bind(deps.newId(), d.hit.id, ctx.sender.id, ev.channelRef, ev.messageRef)
      .run();
    const replied = await reply(closed ? `${TEXT.waiting}\n${TEXT.closed}` : TEXT.waiting);
    return { kind: "question", decision: "wait", knowledgeId: d.hit.id, replied, ownerAsked: false };
  }

  // 答えがない: 引き継ぎ帳に質問を積み、スタッフには確認中と返し、オーナーに一度だけ聞く
  const knowledgeId = deps.newId();
  await db
    .prepare(
      `INSERT INTO knowledge (id, store_id, question, kind, asked_by_staff_id, asked_at, question_ref, question_channel_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(knowledgeId, store?.id ?? null, ev.text, d.kind, ctx.sender.id, ev.sentAt, ev.messageRef, ev.channelRef)
    .run();
  const replied = await reply(closed ? `${TEXT.asking}\n${TEXT.closed}` : TEXT.asking);

  const owner = await db
    .prepare("SELECT slack_user_id FROM staff WHERE role = 'owner' AND status = 'active' AND slack_user_id IS NOT NULL LIMIT 1")
    .first<{ slack_user_id: string }>();
  let ownerAsked = false;
  if (owner) {
    const where = store ? `${store.name}の` : "";
    const text = [
      `【引き継ぎ帳】${where}${ctx.sender.display_name}さんから質問です。引き継ぎ帳に答えがありません。`,
      `「${ev.text}」`,
      `このメッセージのスレッドに答えを書いてもらえれば、${ctx.sender.display_name}さんに返して、次から引き継ぎ帳が答えます。`,
    ].join("\n");
    const res = await deps.slack.postMessage(owner.slack_user_id, text).catch(() => ({ ok: false }) as { ok: boolean; ts?: string; channel?: string });
    if (res.ok && res.ts && res.channel) {
      await db
        .prepare("UPDATE knowledge SET owner_asked_at = ?, owner_ask_ref = ?, owner_ask_channel_ref = ? WHERE id = ?")
        .bind(new Date().toISOString(), res.ts, res.channel, knowledgeId)
        .run();
      ownerAsked = true;
    }
  }
  return { kind: "question", decision: "ask_owner", knowledgeId, replied, ownerAsked };
}

// オーナー(・副担当)が問い合わせの DM のスレッドで答えた: 回答を積み、質問したスタッフのスレッドに返す
export async function handleOwnerAnswer(
  db: D1Database,
  ev: ReportEvent,
  deps: KnowledgeDeps,
  sender: Person,
): Promise<QuestionOutcome> {
  const k = await db
    .prepare(
      `SELECT k.id, k.store_id, st.name AS store_name, k.question, k.kind, k.question_ref, k.question_channel_ref,
              s.display_name AS asked_by
         FROM knowledge k
         LEFT JOIN staff s ON s.id = k.asked_by_staff_id
         LEFT JOIN stores st ON st.id = k.store_id
        WHERE k.owner_ask_channel_ref = ? AND k.owner_ask_ref = ?`,
    )
    .bind(ev.channelRef, ev.threadRef)
    .first<{
      id: string;
      store_id: string | null;
      store_name: string | null;
      question: string;
      kind: string | null;
      question_ref: string | null;
      question_channel_ref: string | null;
      asked_by: string | null;
    }>();
  if (!k) return { kind: "ignored", reason: "owner_thread_without_question" };
  if (!ev.text) return { kind: "ignored", reason: "empty_answer" };

  const dup = await db.prepare("SELECT 1 FROM knowledge_answers WHERE answer_ref = ?").bind(ev.messageRef).first();
  if (dup) return { kind: "ignored", reason: "duplicate" };

  // 答え直しは前の回答を指して積む(前の回答と出典は残る)
  const prev = await db
    .prepare("SELECT id FROM knowledge_answers WHERE knowledge_id = ? ORDER BY answered_at DESC, created_at DESC LIMIT 1")
    .bind(k.id)
    .first<{ id: string }>();
  const answerId = deps.newId();
  await db
    .prepare(
      `INSERT INTO knowledge_answers (id, knowledge_id, answer, answered_by_staff_id, answered_at, replaces_answer_id, answer_ref)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(answerId, k.id, ev.text, sender.id, ev.sentAt, prev?.id ?? null, ev.messageRef)
    .run();

  let repliedToStaff = false;
  if (k.question_channel_ref && k.question_ref) {
    const text = `オーナーから答えが来ました。\n${ev.text}${sourceLabel(sender.display_name, ev.sentAt)}`;
    repliedToStaff = await deps.slack
      .postMessage(k.question_channel_ref, text, k.question_ref)
      .then((r) => r.ok)
      .catch(() => false);
  }
  // 同じ質問で待っていた人にも返す
  const { results: waiters } = await db
    .prepare("SELECT channel_ref, message_ref FROM knowledge_waiters WHERE knowledge_id = ? ORDER BY created_at")
    .bind(k.id)
    .all<{ channel_ref: string; message_ref: string }>();
  for (const w of waiters) {
    await deps.slack
      .postMessage(w.channel_ref, `オーナーから答えが来ました。\n${ev.text}${sourceLabel(sender.display_name, ev.sentAt)}`, w.message_ref)
      .catch(() => undefined);
  }

  // 判断の答えはルール候補にする(有効にするのはオーナーの承認だけ)
  const candidate = await createRuleCandidate(db, deps, k, { id: answerId, text: ev.text });

  const who = k.asked_by ? `${k.asked_by}さん` : "質問した人";
  const others = waiters.length ? `(同じことを聞いていた${waiters.length}人にも返しました)` : "";
  const lines = [repliedToStaff ? `${who}に返し、引き継ぎ帳に残しました。${others}` : `引き継ぎ帳に残しました(${who}への返事は送れませんでした)。`];
  if (candidate) {
    lines.push(
      `判断の答えなので、ルール候補にしました: ルール${candidate.ruleNo}「${candidate.naturalText}」`,
      "店舗ページで承認すると、次から報告・写真の検出と引き継ぎ帳の答えの基準になります。",
    );
  }
  await deps.slack.postMessage(ev.channelRef, lines.join("\n"), ev.threadRef).catch(() => undefined);
  return {
    kind: "owner_answer",
    knowledgeId: k.id,
    answerId,
    repliedToStaff,
    ruleCandidate: candidate ? { ruleId: candidate.ruleId, ruleNo: candidate.ruleNo } : null,
  };
}
