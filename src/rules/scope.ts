// ルールを適用する店(migrations 0012)。「このルールはどの店に効くか」の読み方をここ一つに揃える。
//
//   rule_stores に行があるルール → その店だけ
//   行がなく store_id が NULL    → 全店(これから増える店も含む)
//   行がなく store_id がある     → その店だけ
//
// 読む側(夜の突き合わせ・写真の照合・引き継ぎ帳の検索・朝の要約・ルール一覧)は、この SQL の断片で絞る。
// 変えるのは「どのルールを渡すか」だけで、プロンプトや判断は触らない。

/** WHERE に入れる断片。店の id を2回 bind する(同じ値) */
export function ruleAppliesSql(alias = "r"): string {
  return `(EXISTS (SELECT 1 FROM rule_stores rs WHERE rs.rule_id = ${alias}.id AND rs.store_id = ?)
    OR (NOT EXISTS (SELECT 1 FROM rule_stores rs WHERE rs.rule_id = ${alias}.id) AND (${alias}.store_id IS NULL OR ${alias}.store_id = ?)))`;
}

/** SELECT に入れる断片: 適用する店の id をカンマ区切りで(rule_stores に行があるときだけ。なければ NULL) */
export function scopeStoresSql(alias = "r"): string {
  return `(SELECT group_concat(rs.store_id) FROM rule_stores rs WHERE rs.rule_id = ${alias}.id)`;
}

export type RuleScope = { kind: "all" } | { kind: "stores"; storeIds: string[] };

/** 行の値(store_id と scope_store_ids)から、適用する店を読む */
export function scopeOf(r: { store_id: string | null; scope_store_ids?: string | null }): RuleScope {
  const ids = (r.scope_store_ids ?? "").split(",").filter(Boolean);
  if (ids.length) return { kind: "stores", storeIds: ids };
  return r.store_id ? { kind: "stores", storeIds: [r.store_id] } : { kind: "all" };
}

/** 画面のピル: 「全店」/「天神店のみ」/「天神店、薬院店」(中黒は使わない。30 の書き方) */
export function scopeLabel(scope: RuleScope, stores: { id: string; name: string }[]): string {
  if (scope.kind === "all") return "全店";
  const names = scope.storeIds.map((id) => stores.find((s) => s.id === id)?.name ?? id);
  return names.length === 1 ? `${names[0]}のみ` : names.join("、");
}

/**
 * フォームの選択(checkbox name="stores"。値は "all" か店の id)を読む。
 * - 「全店」が入っていれば全店
 * - どの店にもチェックがなければ null(受けない)
 * - 知らない店が混ざっていれば null(受けない)
 * 全部の店に個別にチェックしても「全店」にはしない(11/5 橋本: 店ごとの設備に結びついたルールが、新しい店に勝手に効かないように)
 */
export function parseScopeChoice(raw: unknown, knownStoreIds: string[]): RuleScope | null {
  const values = (Array.isArray(raw) ? raw : raw == null ? [] : [raw]).filter((v): v is string => typeof v === "string");
  if (values.includes("all")) return { kind: "all" };
  const ids = [...new Set(values)];
  if (ids.length === 0 || ids.some((id) => !knownStoreIds.includes(id))) return null;
  return { kind: "stores", storeIds: ids };
}

/**
 * 適用する店を書く(承認のときと、あとから変えるとき)。
 *   全店        → store_id NULL、rule_stores の行なし、target {"scope":"all_stores"}
 *   1店だけ     → store_id をその店、行なし、target {"store": id}
 *   2店以上     → rule_stores にその店の行(store_id は生まれた店のまま)、target {"stores":[…]}
 * 呼ぶ側が、候補か有効かの確認と console.log を行う
 */
export function scopeStatements(db: D1Database, ruleId: string, scope: RuleScope): D1PreparedStatement[] {
  const out: D1PreparedStatement[] = [db.prepare("DELETE FROM rule_stores WHERE rule_id = ?").bind(ruleId)];
  if (scope.kind === "all") {
    out.push(db.prepare("UPDATE rules SET store_id = NULL, target = ? WHERE id = ?").bind(JSON.stringify({ scope: "all_stores" }), ruleId));
  } else if (scope.storeIds.length === 1) {
    out.push(db.prepare("UPDATE rules SET store_id = ?, target = ? WHERE id = ?").bind(scope.storeIds[0], JSON.stringify({ store: scope.storeIds[0] }), ruleId));
  } else {
    for (const id of scope.storeIds) out.push(db.prepare("INSERT INTO rule_stores (rule_id, store_id) VALUES (?, ?)").bind(ruleId, id));
    out.push(db.prepare("UPDATE rules SET target = ? WHERE id = ?").bind(JSON.stringify({ stores: scope.storeIds }), ruleId));
  }
  return out;
}
