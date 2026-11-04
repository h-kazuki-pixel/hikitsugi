// reset-demo(demo の D1 を作り直す)の DROP の一覧に、マイグレーションで作る名前の書き忘れがないこと。
// 11/4: 0011 で count_events を足したのに一覧に足し忘れ、作り直しのあと 0011 が「もうある」で落ちて seed が入らなかった
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const migrationsDir = join(root, "migrations");
const resetSql = readFileSync(join(root, "scripts/ci/reset-demo.sql"), "utf8");

// コメントを除いてから読む(コメントの中の CREATE を拾わない)
const strip = (sql: string) => sql.replace(/--.*$/gm, "");

function createdNames(): { name: string; kind: "TABLE" | "VIEW"; file: string }[] {
  const out: { name: string; kind: "TABLE" | "VIEW"; file: string }[] = [];
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = strip(readFileSync(join(migrationsDir, file), "utf8"));
    for (const m of sql.matchAll(/CREATE\s+(TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)/gi)) {
      out.push({ kind: m[1]!.toUpperCase() as "TABLE" | "VIEW", name: m[2]!, file });
    }
    // 名前を変えた表も、変えたあとの名前で残る
    for (const m of sql.matchAll(/ALTER\s+TABLE\s+\w+\s+RENAME\s+TO\s+["`]?(\w+)/gi)) out.push({ kind: "TABLE", name: m[1]!, file });
  }
  return out;
}

function droppedNames(kind: "TABLE" | "VIEW"): Set<string> {
  const re = new RegExp(`DROP\\s+${kind}\\s+IF\\s+EXISTS\\s+["\`]?(\\w+)`, "gi");
  return new Set([...strip(resetSql).matchAll(re)].map((m) => m[1]!));
}

describe("reset-demo の DROP の一覧", () => {
  it("マイグレーションで作る表とビューを、すべて消す", () => {
    const created = createdNames();
    expect(created.length).toBeGreaterThan(0);
    const missing = created.filter((c) => !droppedNames(c.kind).has(c.name)).map((c) => `${c.kind} ${c.name}(${c.file})`);
    expect(missing, "scripts/ci/reset-demo.sql に DROP を足してください").toEqual([]);
  });

  it("マイグレーションの記録(d1_migrations)も消して、0001 から当て直す", () => {
    expect(droppedNames("TABLE").has("d1_migrations")).toBe(true);
  });
});
