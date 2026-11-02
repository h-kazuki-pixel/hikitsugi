import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSql } from "./apply-demo-slack-ids.mjs";

test("人とチャンネルの ID を UPDATE 文にする", () => {
  const { sql, count, errors } = buildSql("owner=UEXAMPLE1\r\naoi = UEXAMPLE2\n\n# メモ\ntenjin=CEXAMPLE3\n");
  assert.equal(count, 3);
  assert.deepEqual(errors, []);
  assert.match(sql, /UPDATE staff SET slack_user_id = 'UEXAMPLE1' WHERE id = 'staff_owner';/);
  assert.match(sql, /UPDATE stores SET slack_channel_id = 'CEXAMPLE3' WHERE id = 'tenjin';/);
});

test("形の違う ID・知らない名前は飛ばし、エラーに ID を出さない", () => {
  const { count, errors } = buildSql("sota=CEXAMPLE9\nfoo=UEXAMPLE1\nyakuin=x'; DROP TABLE staff;--\n");
  assert.equal(count, 0);
  assert.equal(errors.length, 3);
  for (const e of errors) assert.doesNotMatch(e, /EXAMPLE|DROP/);
});

test("未登録なら空の SQL", () => {
  assert.deepEqual(buildSql(undefined), { sql: "", count: 0, errors: [] });
});
