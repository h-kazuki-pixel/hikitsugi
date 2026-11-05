// ルールを適用する店(migrations 0012、src/rules/scope.ts)。架空の3店 A・B・C で確かめる
import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runNightCheck } from "../src/agent/night";
import { app } from "../src/index";
import type { ModelCall } from "../src/knowledge/agent";
import { searchKnowledge } from "../src/knowledge/search";
import { activeJudgmentRules } from "../src/report/process";
import { parseScopeChoice, scopeLabel, scopeOf } from "../src/rules/scope";
import { demoEnv } from "./helpers";

let proxy: Awaited<ReturnType<typeof demoEnv>>;
beforeAll(async () => {
  proxy = await demoEnv();
  const db = proxy.env.DB;
  await db.batch([
    ...["a", "b", "c"].map((x) =>
      db.prepare("INSERT OR IGNORE INTO stores (id, name, opening_hours, cleaning_type) VALUES (?, ?, '24時間', 'daily')").bind(`st_${x}`, `架空${x.toUpperCase()}店`),
    ),
    db.prepare("INSERT OR IGNORE INTO staff (id, display_name, slack_user_id, role) VALUES ('staff_scope', 'スコープ', 'U_DEMO_SCOPE', 'staff')"),
  ]);
});
afterAll(async () => {
  // 架空の3店は後のテスト(seed の件数など)に残さない
  const d = proxy.env.DB;
  await d.batch([
    d.prepare("DELETE FROM entries WHERE staff_id = 'staff_scope'"),
    d.prepare("DELETE FROM rule_stores WHERE rule_id IN (SELECT id FROM rules WHERE natural_text LIKE '架空のルール%')"),
    d.prepare("DELETE FROM rules WHERE natural_text LIKE '架空のルール%'"),
    d.prepare("DELETE FROM staff WHERE id = 'staff_scope'"),
    d.prepare("DELETE FROM stores WHERE id IN ('st_a', 'st_b', 'st_c')"),
  ]);
  await proxy?.dispose();
});
const db = () => proxy.env.DB;

const post = (path: string, body: Record<string, string | string[]>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) for (const x of Array.isArray(v) ? v : [v]) p.append(k, x);
  return app.request(path, { method: "POST", body: p, headers: { "content-type": "application/x-www-form-urlencoded" } }, proxy.env);
};

async function rule(id: string, no: number, storeId: string | null, status: "candidate" | "active") {
  await db()
    .prepare("INSERT OR IGNORE INTO rules (id, rule_no, store_id, natural_text, action, origin, status, activated_at) VALUES (?, ?, ?, ?, 'judgment_basis', 'interview', ?, '2026-11-01T00:00:00Z')")
    .bind(id, no, storeId, `架空のルール${no}`, status)
    .run();
}

// 3つの読む側で、その店にルールが渡るか
async function visibleIn(ruleId: string, storeId: string): Promise<{ check: boolean; search: boolean; night: boolean }> {
  const check = (await activeJudgmentRules(db(), storeId)).some((r) => r.id === ruleId);
  const search = (await searchKnowledge(db(), storeId, "架空のルール", { limit: 50 })).some((h) => h.id === `rule:${ruleId}`);
  // 夜の突き合わせ: その店に入室を1件入れ、read_rules を呼ばせて返った一覧を見る
  await db().prepare("INSERT OR IGNORE INTO entries (id, store_id, staff_id, unlocked_at, received_at, source) VALUES (?, ?, 'staff_scope', '2026-11-05T09:00:00Z', '2026-11-05T09:00:00Z', 'simulated')").bind(`e_${storeId}`, storeId).run();
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const turns: Anthropic.ContentBlock[][] = [[{ type: "tool_use", id: "t1", name: "read_rules", input: {} } as Anthropic.ContentBlock], [{ type: "tool_use", id: "t2", name: "finish", input: { summary: "" } } as Anthropic.ContentBlock]];
  const call: ModelCall = async (params) => {
    requests.push(structuredClone(params));
    return { id: "m", type: "message", role: "assistant", model: "fake", content: turns.shift()!, stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } as unknown as Anthropic.Message;
  };
  await runNightCheck(db(), { storeId, storeName: storeId, date: "2026-11-05", now: "2026-11-05T12:30:00Z", toneSample: null }, { call, newId: () => crypto.randomUUID() });
  const no = (await db().prepare("SELECT rule_no FROM rules WHERE id = ?").bind(ruleId).first<{ rule_no: number }>())!.rule_no;
  const toolResult = (requests[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0]!.content as string;
  const night = (JSON.parse(toolResult) as { rule_no: number }[]).some((r) => r.rule_no === no);
  return { check, search, night };
}

describe("適用する店の読み方(rules/scope.ts)", () => {
  it("rule_stores に行(A・C)→ A と C でだけ読まれ、B では読まれない", async () => {
    await rule("r_ac", 201, "st_a", "active");
    await db().prepare("INSERT INTO rule_stores (rule_id, store_id) VALUES ('r_ac', 'st_a'), ('r_ac', 'st_c')").run();
    expect(await visibleIn("r_ac", "st_a")).toEqual({ check: true, search: true, night: true });
    expect(await visibleIn("r_ac", "st_c")).toEqual({ check: true, search: true, night: true });
    expect(await visibleIn("r_ac", "st_b")).toEqual({ check: false, search: false, night: false });
  });
  it("行なし・NULL → 3店すべて / 行なし・A → A だけ", async () => {
    await rule("r_all", 202, null, "active");
    await rule("r_a", 203, "st_a", "active");
    for (const s of ["st_a", "st_b", "st_c"]) expect((await visibleIn("r_all", s)).check, s).toBe(true);
    expect((await visibleIn("r_a", "st_a")).check).toBe(true);
    expect((await visibleIn("r_a", "st_b")).check).toBe(false);
    expect((await visibleIn("r_a", "st_c")).check).toBe(false);
  });
  it("ピルの書き方: 全店 / A店のみ / A店、C店(中黒は使わない)", () => {
    const stores = [{ id: "st_a", name: "架空A店" }, { id: "st_c", name: "架空C店" }];
    expect(scopeLabel(scopeOf({ store_id: null }), stores)).toBe("全店");
    expect(scopeLabel(scopeOf({ store_id: "st_a" }), stores)).toBe("架空A店のみ");
    expect(scopeLabel(scopeOf({ store_id: "st_a", scope_store_ids: "st_a,st_c" }), stores)).toBe("架空A店、架空C店");
  });
  it("フォームの読み方: 全店が入っていれば全店。チェックなし・知らない店は受けない。全部の店に個別のチェックは全店にしない", () => {
    const known = ["st_a", "st_b", "st_c"];
    expect(parseScopeChoice(["all", "st_a"], known)).toEqual({ kind: "all" });
    expect(parseScopeChoice(undefined, known)).toBeNull();
    expect(parseScopeChoice(["st_x"], known)).toBeNull();
    expect(parseScopeChoice(["st_a", "st_b", "st_c"], known)).toEqual({ kind: "stores", storeIds: ["st_a", "st_b", "st_c"] });
  });
});

describe("承認で適用する店を選ぶ / あとから変える", () => {
  it("承認で A・C を選ぶ → A と C に出て B には出ない。target も合わせる", async () => {
    await rule("r_cand", 204, "st_a", "candidate");
    const res = await post("/rules/r_cand/approve", { store: "st_a", stores: ["st_a", "st_c"] });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/stores/st_a?view=rules");
    expect(await db().prepare("SELECT status, store_id, target FROM rules WHERE id = 'r_cand'").first()).toEqual({ status: "active", store_id: "st_a", target: '{"stores":["st_a","st_c"]}' });
    expect((await visibleIn("r_cand", "st_a")).check).toBe(true);
    expect((await visibleIn("r_cand", "st_c")).search).toBe(true);
    expect(await visibleIn("r_cand", "st_b")).toEqual({ check: false, search: false, night: false });
  });
  it("承認で「全店」→ 3店すべて。store_id は NULL、行なし", async () => {
    await rule("r_cand_all", 205, "st_b", "candidate");
    await post("/rules/r_cand_all/approve", { store: "st_b", stores: ["all"] });
    expect(await db().prepare("SELECT status, store_id, target FROM rules WHERE id = 'r_cand_all'").first()).toEqual({ status: "active", store_id: null, target: '{"scope":"all_stores"}' });
    expect(await db().prepare("SELECT count(*) AS n FROM rule_stores WHERE rule_id = 'r_cand_all'").first()).toEqual({ n: 0 });
    for (const s of ["st_a", "st_b", "st_c"]) expect((await visibleIn("r_cand_all", s)).check, s).toBe(true);
  });
  it("あとから A・C → B に変える → A・C で読まれなくなり、B で読まれる", async () => {
    const res = await post("/rules/r_cand/stores", { store: "st_a", stores: ["st_b"] });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/stores/st_a?view=rules");
    expect(await db().prepare("SELECT store_id, target FROM rules WHERE id = 'r_cand'").first()).toEqual({ store_id: "st_b", target: '{"store":"st_b"}' });
    expect((await visibleIn("r_cand", "st_a")).check).toBe(false);
    expect((await visibleIn("r_cand", "st_c")).check).toBe(false);
    expect(await visibleIn("r_cand", "st_b")).toEqual({ check: true, search: true, night: true });
  });
  it("どの店にもチェックがない承認・存在しない店・候補でないルールは、受けない", async () => {
    await rule("r_keep", 206, "st_a", "candidate");
    await post("/rules/r_keep/approve", { store: "st_a" });
    expect(await db().prepare("SELECT status FROM rules WHERE id = 'r_keep'").first()).toEqual({ status: "candidate" });
    await post("/rules/r_keep/approve", { store: "st_a", stores: ["st_nowhere"] });
    expect(await db().prepare("SELECT status FROM rules WHERE id = 'r_keep'").first()).toEqual({ status: "candidate" });
    // 有効でないルールの範囲は変えられない
    await post("/rules/r_keep/stores", { store: "st_a", stores: ["st_b"] });
    expect(await db().prepare("SELECT store_id FROM rules WHERE id = 'r_keep'").first()).toEqual({ store_id: "st_a" });
    // 有効なルールでも、チェックなしなら変わらない
    await post("/rules/r_cand/stores", { store: "st_a" });
    expect(await db().prepare("SELECT store_id FROM rules WHERE id = 'r_cand'").first()).toEqual({ store_id: "st_b" });
  });
  it("ルール一覧に範囲のピルと「適用する店を変える」が出る。候補のカードに店のチェックボックスが出る", async () => {
    await rule("r_cand2", 207, "st_a", "candidate");
    const approvals = await (await app.request("/stores/st_a?view=approvals", {}, proxy.env)).text();
    expect(approvals).toContain("全店(これから増える店も)");
    expect(approvals).toContain('<input type="checkbox" name="stores" value="st_a" checked');
    const rules = await (await app.request("/stores/st_b?view=rules", {}, proxy.env)).text();
    expect(rules).toContain("架空B店のみ");
    expect(rules).toContain("適用する店を変える");
    expect(rules).toContain('action="/rules/r_cand/stores"');
  });
});
