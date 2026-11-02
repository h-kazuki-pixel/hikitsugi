// 投稿の分類と報告の構造化(設計書 5-2、仕様 4章)
//
// 1回の Claude 呼び出し(claude-sonnet-5-5、画像入力)で、
//   分類(清掃報告 / 質問 / 依頼・トラブル / その他。両方に当たれば両方)と
//   構造化(清掃箇所・備品切れ・トラブル・メモ・確信度・聞き返し)と、スレッドに返す受付の文を作る。
// 出力はツールの入力として受け取る(自由文を解析しない)。清掃箇所は店舗の areas の ID からしか選べない。

import Anthropic from "@anthropic-ai/sdk";

export const STRUCTURE_MODEL = "claude-sonnet-5-5";

export type Category = "cleaning_report" | "question" | "request_trouble" | "other";

export type StructureInput = {
  storeName: string;
  areas: { id: string; name: string }[];
  senderName: string | null; // 名簿にいなければ null
  toneSample: string | null;
  text: string;
  images: { base64: string; mediaType: string }[];
  imagesUnreadable: number; // 取り出せなかった写真の枚数
  rules: { no: number; text: string }[]; // 有効な「判断の基準」のルール(写真・本文と照合する)
};

export type StructureResult = {
  categories: Category[];
  areas: string[];
  supplies_out: string[];
  trouble: string | null;
  memo: string | null;
  confidence: number;
  clarify_question: string | null;
  reply: string;
  rule_matches: { rule_no: number; evidence: string }[];
  leftover: { area: string; what: string }[]; // 清掃後の写真に残っている汚れ・ゴミ(箇所ごと)
};

export type StructureUsage = { model: string; input_tokens: number; output_tokens: number };

export type Structurer = (input: StructureInput) => Promise<{ result: StructureResult; usage: StructureUsage }>;

const CATEGORIES: Category[] = ["cleaning_report", "question", "request_trouble", "other"];

function tool(areaIds: string[], ruleNos: number[]): Anthropic.Tool {
  return {
    name: "record_post",
    description: "店舗チャンネルの投稿を分類し、清掃報告なら構造化して記録する",
    input_schema: {
      type: "object",
      properties: {
        categories: {
          type: "array",
          items: { type: "string", enum: CATEGORIES },
          description:
            "cleaning_report=清掃をした報告(写真だけでも清掃後の写真なら報告) / question=スタッフからの質問 / request_trouble=備品の依頼・トラブル・違反の目撃 / other=雑談など。両方に当たれば両方入れる",
        },
        areas: {
          type: "array",
          items: areaIds.length ? { type: "string", enum: areaIds } : { type: "string" },
          description: "清掃した箇所。店舗の清掃箇所の ID から選ぶ。文や写真から読み取れないものは入れない",
        },
        supplies_out: {
          type: "array",
          items: { type: "string" },
          description: "切れている・切れそうだと確かに分かる備品(例: トイレットペーパー)。不確かなら入れずに clarify_question で聞く",
        },
        trouble: { type: ["string", "null"], description: "トラブル(ゴミ放置・汚れ・故障など)の内容。なければ null" },
        memo: { type: ["string", "null"], description: "その他オーナーが知っておくとよいこと。なければ null" },
        confidence: { type: "number", minimum: 0, maximum: 1, description: "構造化の確信度" },
        clarify_question: {
          type: ["string", "null"],
          description:
            "報告された内容に確信が持てない点があるときだけ、その1点を確かめる質問を1文で(例: 「トイレットペーパーが残り1つに見えますが、合ってますか?」)。疑問符は1つだけ。報告にない箇所や作業を尋ねない(「〜もやっていたら教えて」は不可)。迷う点が複数あっても、記録に一番効く1点だけにする。なければ null",
        },
        leftover: {
          type: "array",
          description:
            "清掃後の写真なのに、汚れ・ゴミ・紙くずが残っていると確かに見える箇所。見えないときは空。推測で入れない。入れた箇所は「完了」にならず「要確認」になり、スタッフに拾ってもらうよう頼む",
          items: {
            type: "object",
            properties: {
              area: areaIds.length ? { type: "string", enum: areaIds } : { type: "string" },
              what: { type: "string", description: "何がどこに残っているか(1文。例: 床に紙くずが数か所)" },
            },
            required: ["area", "what"],
          },
        },
        rule_matches: {
          type: "array",
          description:
            "判断の基準のルールに反している様子が写真や本文から確かに分かるときだけ入れる(例: 机上のみ可のルールがあり、床に置かれた加湿器が写っている)。見えないこと・推測は入れない。なければ空",
          items: {
            type: "object",
            properties: {
              rule_no: ruleNos.length ? { type: "integer", enum: ruleNos } : { type: "integer" },
              evidence: { type: "string", description: "何が写っている・書かれているか(1文。人を責める書き方にしない)" },
            },
            required: ["rule_no", "evidence"],
          },
        },
        reply: {
          type: "string",
          description:
            "清掃報告のときだけ、スレッドに返す受付の文。ねぎらい + 受け付けた箇所を1〜2文。質問は入れない(聞き返しは clarify_question に書くと、システムが後ろにつなげて送る)。責めない。清掃報告でなければ空文字",
        },
      },
      required: ["categories", "areas", "supplies_out", "trouble", "memo", "confidence", "clarify_question", "leftover", "rule_matches", "reply"],
    },
  };
}

function system(input: StructureInput): string {
  const areas = input.areas.map((a) => `- ${a.id}: ${a.name}`).join("\n");
  return [
    `あなたは無人自習室「${input.storeName}」の店舗チャンネルに届いた投稿を受け付ける係です。`,
    "投稿を分類し、清掃報告なら何をしたかを構造化して record_post に記録してください。",
    "どんな投稿でも、文章で答えずに必ず record_post を1回だけ呼んでください(報告でなければ categories にそう入れ、reply は空にします)。",
    "",
    "清掃箇所(この中からだけ選ぶ):",
    areas || "(なし)",
    "",
    "決まりごと:",
    "- 写真は清掃後の様子として見る。写っている場所から清掃箇所を判定する。写真から分かる備品の残量も拾う",
    "- 清掃後なのに汚れ・ゴミ・紙くずが残って見えるときは leftover に箇所と何が残っているかを入れる。その箇所は完了にならず、スタッフに拾ってもらう頼みをシステムが添える。「清掃後の写真で合ってますか」とは聞かない(写真は清掃後と決めてある)。leftover は trouble ではない(trouble は故障・放置された粗大ゴミ・違反など、スタッフの清掃の範囲を超えるもの)",
    "- 読み取れないことを推測で埋めない。迷ったら confidence を下げる",
    "- 聞き返しは1回、1つだけ。報告された内容のうち確かめないと記録が誤る1点だけを clarify_question に書く。報告にない箇所や作業を尋ねない。確かめることがなければ null",
    "- 受付の文(reply)はスタッフへの返事。ねぎらいを先に、短く、責めない。オーナーの口調に寄せる。reply には質問を書かない",
    input.toneSample ? `- オーナーの口調の例: 「${input.toneSample}」` : "",
    ...(input.rules.length
      ? [
          "",
          "判断の基準(オーナーが承認したルール。写真・本文がこれに反していないかを見る。反していても受付の文では触れない):",
          ...input.rules.map((r) => `- ルール${r.no}: ${r.text}`),
        ]
      : []),
  ]
    .filter((l) => l !== "")
    .join("\n");
}

function userContent(input: StructureInput): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = input.images.map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.mediaType as "image/jpeg", data: img.base64 },
  }));
  const lines = [
    `送信者: ${input.senderName ?? "(名簿にない人)"}`,
    `本文: ${input.text || "(本文なし)"}`,
    `写真: ${input.images.length}枚${input.imagesUnreadable ? `(ほかに取り出せなかった写真が${input.imagesUnreadable}枚)` : ""}`,
  ];
  blocks.push({ type: "text", text: lines.join("\n") });
  return blocks;
}

export function claudeStructurer(apiKey: string): Structurer {
  const client = new Anthropic({ apiKey });
  return async (input) => {
    const t = tool(
      input.areas.map((a) => a.id),
      input.rules.map((r) => r.no),
    );
    const res = await client.messages.create({
      model: STRUCTURE_MODEL,
      max_tokens: 1024,
      system: system(input),
      // claude-sonnet-5-5 は tool_choice で特定のツールを強制できない(400 になる)。自動に任せ、システム文で必ず呼ぶよう指示する
      tools: [t],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: userContent(input) }],
    });
    const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (!block) throw new Error("構造化の結果が返りませんでした");
    return {
      result: normalize(
        block.input as Partial<StructureResult>,
        input.areas.map((a) => a.id),
        input.rules.map((r) => r.no),
      ),
      usage: { model: res.model, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens },
    };
  };
}

// 聞き返しは1つだけ(仕様 4章「1回だけ聞き返す」)。モデルが2つ書いても、最初の問い1つに切る
export function singleQuestion(q: string | null | undefined): string | null {
  const t = (q ?? "").trim();
  if (!t) return null;
  const m = t.match(/^[^?？]*[?？]/);
  return (m ? m[0] : t).trim() || null;
}

// 受付の文から問いと「教えて」の文を落とす(スタッフに尋ねるのは clarify_question の1つだけにするため)
function withoutQuestions(reply: string): string {
  const sentences = reply.match(/[^。！!?？\n]+[。！!?？]?/g) ?? [];
  return sentences
    .filter((s) => !/[?？]$/.test(s.trim()) && !/教えて/.test(s))
    .join("")
    .trim();
}

// スレッドに返す文: 受付 + (あれば)聞き返し1つ
// 残っている汚れ・ゴミがあれば、問いの代わりに「拾ってもらえますか」を添える(聞き返しは1回なので、両方は送らない)
export function composeReply(
  result: Pick<StructureResult, "reply" | "clarify_question" | "leftover">,
  areaName: (id: string) => string = (id) => id,
): string {
  const ack = result.reply;
  if (!ack) return "";
  if (result.leftover.length) {
    const seen = result.leftover.map((l) => `${areaName(l.area)}の${l.what}`).join("、");
    return `${ack}\n${seen}が見えます。拾ってもらえますか? 終わったらこのスレッドに一言ください。`;
  }
  const q = result.clarify_question;
  return q ? `${ack}\n${q}` : ack;
}

// モデルの出力を DB に入れられる形に整える(知らない箇所 ID や範囲外の値は落とす)
export function normalize(raw: Partial<StructureResult>, areaIds: string[], ruleNos: number[] = []): StructureResult {
  const known = new Set(areaIds);
  const rules = new Set(ruleNos);
  const categories = (raw.categories ?? []).filter((c): c is Category => CATEGORIES.includes(c as Category));
  const conf = typeof raw.confidence === "number" ? Math.min(1, Math.max(0, raw.confidence)) : 0.5;
  return {
    categories: categories.length ? [...new Set(categories)] : ["other"],
    areas: [...new Set((raw.areas ?? []).filter((a) => known.has(a)))],
    supplies_out: (raw.supplies_out ?? []).filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim()),
    trouble: raw.trouble?.trim() || null,
    memo: raw.memo?.trim() || null,
    confidence: conf,
    clarify_question: singleQuestion(raw.clarify_question),
    reply: withoutQuestions((raw.reply ?? "").trim()),
    leftover: (raw.leftover ?? [])
      .filter((l) => l && known.has(String(l.area)) && typeof l.what === "string" && l.what.trim())
      .map((l) => ({ area: String(l.area), what: l.what.trim() })),
    // 照合に渡したルールの番号だけを残す(知らない番号は捨てる)
    rule_matches: (raw.rule_matches ?? [])
      .filter((m) => m && rules.has(Number(m.rule_no)) && typeof m.evidence === "string" && m.evidence.trim())
      .map((m) => ({ rule_no: Number(m.rule_no), evidence: m.evidence.trim() })),
  };
}
