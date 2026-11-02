// 製品の中の Claude 呼び出しの消費を残す(ログと D1 の両方)。本文・写真は残さない
// 記録に失敗しても本来の処理は止めない

export type UsageRecord = {
  kind: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  turns?: number;
  images?: number;
  store_id?: string | null;
  truncated?: boolean; // 出力が上限で切れた
};

export async function recordUsage(db: D1Database, u: UsageRecord, extra: Record<string, unknown> = {}): Promise<void> {
  console.log(JSON.stringify({ claude: u.kind, model: u.model, input_tokens: u.input_tokens, output_tokens: u.output_tokens, turns: u.turns ?? 1, images: u.images ?? 0, truncated: !!u.truncated, ...extra }));
  if (u.truncated) console.error(`Claude の出力が上限で切れました(${u.kind}、出力 ${u.output_tokens} トークン)`);
  await db
    .prepare("INSERT INTO claude_usage (id, kind, model, input_tokens, output_tokens, turns, images, store_id, truncated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), u.kind, u.model, u.input_tokens, u.output_tokens, u.turns ?? 1, u.images ?? 0, u.store_id ?? null, u.truncated ? 1 : 0)
    .run()
    .catch((e: unknown) => console.error(`消費の記録に失敗しました: ${e instanceof Error ? e.message : String(e)}`));
}
