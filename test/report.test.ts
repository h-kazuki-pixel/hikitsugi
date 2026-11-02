// 報告の受け口: Slack アダプタ → 分類・構造化 → 原本と版1 → 畳み込み → ボード → スレッド返事
// Claude と Slack は差し替える(テストでは外に出ない)。D1 はローカルの seed 入り
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toReportEvent, type SlackMessageEvent } from "../src/channels/slack";
import { processReportEvent, type ProcessDeps } from "../src/report/process";
import { normalize, type StructureInput, type StructureResult } from "../src/report/structure";
import type { SlackClient } from "../src/slack/api";
import { demoEnv } from "./helpers";

let proxy: Awaited<ReturnType<typeof demoEnv>>;
beforeAll(async () => {
  proxy = await demoEnv();
});
afterAll(async () => {
  await proxy?.dispose();
});
const db = () => proxy.env.DB;

// 2026-11-01 18:25 JST = 09:25 UTC
const BASE = Date.UTC(2026, 10, 1, 9, 25) / 1000;
const ts = (offsetSec: number) => (BASE + offsetSec).toFixed(6);

function msg(over: Partial<SlackMessageEvent> = {}): SlackMessageEvent {
  return { type: "message", user: "U_DEMO_AOI", channel: "C_DEMO_TENJIN", channel_type: "channel", text: "トイレとゴミ終わりました", ts: ts(0), ...over };
}

function fakes(result: Partial<StructureResult>) {
  const posted: { channel: string; text: string; thread?: string }[] = [];
  const inputs: StructureInput[] = [];
  const slack: SlackClient = {
    async postMessage(channel, text, thread) {
      posted.push({ channel, text, thread });
      return { ok: true, ts: "1.0" };
    },
    async fetchImage() {
      return { base64: "aGVsbG8=", mediaType: "image/jpeg" };
    },
  };
  const deps: ProcessDeps = {
    slack,
    structure: async (input) => {
      inputs.push(input);
      return { result: normalize(result, input.areas.map((a) => a.id)), usage: { model: "test-model", input_tokens: 1, output_tokens: 1 } };
    },
  };
  return { deps, posted, inputs };
}

const REPORT: Partial<StructureResult> = {
  categories: ["cleaning_report"],
  areas: ["tenjin_toilet", "tenjin_trash", "存在しない箇所"],
  supplies_out: [],
  trouble: null,
  memo: null,
  confidence: 0.8,
  clarify_question: "トイレットペーパーが残り1つに見えますが、合ってますか?",
  reply: "おつかれさま。トイレとゴミ、受け付けました。トイレットペーパーが残り1つに見えますが、合ってますか?",
};

describe("Slack アダプタ", () => {
  it("写真つき投稿を共通イベントにする(縮小版の URL・送信時刻は ts から)", () => {
    const ev = toReportEvent(
      msg({ subtype: "file_share", text: "", files: [{ id: "F1", mimetype: "image/jpeg", thumb_1024: "https://files.example/t1024", url_private_download: "https://files.example/full" }] }),
    );
    expect(ev).toMatchObject({ senderRef: "U_DEMO_AOI", channelRef: "C_DEMO_TENJIN", sentAt: "2026-11-01T09:25:00.000Z", isDirect: false, isReplyInThread: false });
    expect(ev?.images).toEqual([{ id: "F1", url: "https://files.example/t1024", mimetype: "image/jpeg", name: undefined }]);
  });

  it("ボットの投稿・編集・参加・本文も写真もない投稿は弾く", () => {
    expect(toReportEvent(msg({ bot_id: "B1" }))).toBeNull();
    expect(toReportEvent(msg({ subtype: "bot_message" }))).toBeNull();
    expect(toReportEvent(msg({ subtype: "message_changed" }))).toBeNull();
    expect(toReportEvent(msg({ subtype: "channel_join" }))).toBeNull();
    expect(toReportEvent(msg({ text: "  " }))).toBeNull();
    expect(toReportEvent({ type: "file_shared" })).toBeNull();
  });

  it("スレッドの中の返事と DM を見分ける", () => {
    expect(toReportEvent(msg({ thread_ts: ts(-60), ts: ts(0) }))).toMatchObject({ isReplyInThread: true, threadRef: ts(-60) });
    expect(toReportEvent(msg({ channel_type: "im", channel: "D1" }))).toMatchObject({ isDirect: true });
  });
});

describe("報告の処理", () => {
  it("清掃報告: 原本と版1を積み、ボードを完了にし、スレッドに受付を返す", async () => {
    const { deps, posted, inputs } = fakes(REPORT);
    const ev = toReportEvent(msg({ subtype: "file_share", files: [{ id: "F10", mimetype: "image/jpeg", thumb_1024: "https://files.example/x" }] }))!;
    const out = await processReportEvent(db(), ev, deps);

    expect(out).toMatchObject({ kind: "report", mergedInto: null, areas: ["tenjin_toilet", "tenjin_trash"], boardUpdated: 2, replied: true });
    expect(inputs[0]).toMatchObject({ storeName: "サンプル自習室 天神店", senderName: "あおい", images: [{ mediaType: "image/jpeg" }] });
    expect(posted).toEqual([{ channel: "C_DEMO_TENJIN", text: REPORT.reply, thread: ts(0) }]);

    if (out.kind !== "report") throw new Error();
    const cur = await db().prepare("SELECT sender_staff_id, version, areas, basis, image_ids FROM reports_current WHERE id = ?").bind(out.reportId).first();
    expect(cur).toEqual({ sender_staff_id: "staff_aoi", version: 1, areas: '["tenjin_toilet","tenjin_trash"]', basis: "structuring", image_ids: '["F10"]' });

    const board = await db().prepare("SELECT area_id, status FROM board_items WHERE store_id = 'tenjin' AND date = '2026-11-01' ORDER BY area_id").all();
    expect(board.results).toEqual([
      { area_id: "tenjin_drink", status: "pending" },
      { area_id: "tenjin_floor", status: "pending" },
      { area_id: "tenjin_toilet", status: "done" },
      { area_id: "tenjin_trash", status: "done" },
    ]);
  });

  it("同じ送信が二度届いても一度しか処理しない", async () => {
    const { deps, posted } = fakes(REPORT);
    expect(await processReportEvent(db(), toReportEvent(msg())!, deps)).toEqual({ kind: "ignored", reason: "duplicate" });
    expect(posted).toEqual([]);
  });

  it("5分以内の送り直しは畳み込む(元の送信も残し、最初の報告に結ぶ)", async () => {
    const first = await db().prepare("SELECT id FROM reports WHERE message_ref = ?").bind(ts(0)).first<{ id: string }>();
    const { deps } = fakes({ ...REPORT, areas: ["tenjin_drink"] });
    const out = await processReportEvent(db(), toReportEvent(msg({ ts: ts(120), text: "ドリンクも" }))!, deps);
    expect(out).toMatchObject({ kind: "report", mergedInto: first!.id, boardUpdated: 1 });
    const n = await db().prepare("SELECT count(*) AS n FROM reports WHERE sender_ref = 'U_DEMO_AOI' AND sent_at LIKE '2026-11-01%'").first<{ n: number }>();
    expect(n?.n).toBe(2);
    const done = await db().prepare("SELECT done_report_id FROM board_items WHERE id = 'tenjin:2026-11-01:tenjin_drink'").first();
    expect(done).toEqual({ done_report_id: first!.id });

    // 5分を過ぎたら別の報告
    const later = await processReportEvent(db(), toReportEvent(msg({ ts: ts(600), text: "床も" }))!, fakes({ ...REPORT, areas: ["tenjin_floor"] }).deps);
    expect(later).toMatchObject({ kind: "report", mergedInto: null });
  });

  it("オーナー・副担当の投稿は報告として数えない(Claude も呼ばない)", async () => {
    const { deps, inputs } = fakes(REPORT);
    expect(await processReportEvent(db(), toReportEvent(msg({ user: "U_DEMO_OWNER", ts: ts(900) }))!, deps)).toEqual({ kind: "ignored", reason: "operator_post" });
    expect(inputs).toEqual([]);
  });

  it("報告でない投稿(質問・雑談)は原本を作らず、返事もしない", async () => {
    const { deps, posted } = fakes({ categories: ["question"], areas: [], reply: "" });
    const out = await processReportEvent(db(), toReportEvent(msg({ ts: ts(1200), text: "暖房上げていい?" }))!, deps);
    expect(out).toEqual({ kind: "not_report", categories: ["question"], findingId: null });
    expect(posted).toEqual([]);
    expect(await db().prepare("SELECT 1 FROM reports WHERE message_ref = ?").bind(ts(1200)).first()).toBeNull();
  });

  it("トラブルは検出事項にし、オーナーに DM で知らせる(承認なし)", async () => {
    const { deps, posted } = fakes({ ...REPORT, categories: ["cleaning_report", "request_trouble"], trouble: "ゴミ置き場に粗大ゴミが放置", reply: "おつかれさま。受け付けました。" });
    const out = await processReportEvent(db(), toReportEvent(msg({ user: "U_DEMO_HARUTO", ts: ts(1500) }))!, deps);
    if (out.kind !== "report" || !out.findingId) throw new Error("トラブルが検出されていない");
    const f = await db().prepare("SELECT kind, target_staff_id, status FROM findings WHERE id = ?").bind(out.findingId).first();
    expect(f).toEqual({ kind: "trouble", target_staff_id: "staff_haruto", status: "active" });
    expect(posted.map((p) => p.channel)).toEqual(["U_DEMO_OWNER", "C_DEMO_TENJIN"]);
    expect(posted[0]!.text).toContain("ゴミ置き場に粗大ゴミが放置");
  });

  it("知らないチャンネル・DM・スレッドの返事は今は扱わない", async () => {
    const { deps } = fakes(REPORT);
    expect(await processReportEvent(db(), toReportEvent(msg({ channel: "C_DEMO_OTHER" }))!, deps)).toEqual({ kind: "ignored", reason: "unknown_channel" });
    expect(await processReportEvent(db(), toReportEvent(msg({ channel_type: "im" }))!, deps)).toEqual({ kind: "ignored", reason: "direct_message" });
    expect(await processReportEvent(db(), toReportEvent(msg({ thread_ts: ts(0), ts: ts(30) }))!, deps)).toEqual({ kind: "ignored", reason: "thread_reply" });
  });
});
