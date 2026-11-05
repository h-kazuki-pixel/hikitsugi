import { AppShell, Layout, type NavItem } from "./Layout";
import type { JstDate } from "../lib/time";
import { ApprovalsSection, DemoPanel, type DraftRow, type SentRow } from "./DraftsSection";
import { FindingsSection, whenWithWeekday, type FindingRow } from "./FindingsSection";
import { RulesSection, type RuleRow, type StoreOption } from "./RulesSection";
import { SuppliesSection, type SupplyRow } from "./SuppliesSection";
import { IconCheck, IconInbox, IconLayoutDashboard, IconListChecks, IconPackage, IconPlay, IconScanSearch } from "./icons";

export type StoreRow = {
  id: string;
  name: string;
  cleaning_type: "daily" | "weekly";
  opening_hours: string;
  closed_days: string;
};

export type BoardRow = {
  area_name: string;
  status: "done" | "pending" | "carried_over" | "no_assignee" | "needs_recheck";
  carried_from_date?: string | null;
  recheck_note?: string | null;
  done_basis?: "staff_word" | "photo" | null;
};

// 画面の区画(25): 一画面に見どころを一つ。省略時は、承認待ちが1件以上あれば approvals、なければ board
export const VIEWS = ["board", "approvals", "findings", "rules", "supplies", "demo"] as const;
export type View = (typeof VIEWS)[number];
export const VIEW_LABEL: Record<View, string> = {
  board: "今日のボード",
  approvals: "承認待ち",
  findings: "検出事項",
  rules: "ルール",
  supplies: "備品切れ",
  demo: "デモの操作",
};

export function pickView(raw: string | undefined, hasApprovals: boolean, isDemo: boolean): View {
  if (raw && (VIEWS as readonly string[]).includes(raw) && (raw !== "demo" || isDemo)) return raw as View;
  return hasApprovals ? "approvals" : "board";
}

const CLEANING_TYPE_LABEL = { daily: "毎日の店", weekly: "週次巡回の店" } as const;
const STATUS_LABEL = { done: "完了", pending: "未清掃", carried_over: "繰り越し", no_assignee: "対応者不在", needs_recheck: "要確認" } as const;

export function isClosedDay(closedDaysJson: string, today: JstDate): boolean {
  try {
    const c = JSON.parse(closedDaysJson) as { weekdays?: number[]; dates?: string[] };
    return (c.weekdays ?? []).includes(today.weekday) || (c.dates ?? []).includes(today.iso);
  } catch {
    return false;
  }
}

export type StorePageProps = {
  store: StoreRow;
  board: BoardRow[];
  today: JstDate;
  now?: Date;
  isDemo: boolean;
  view: View;
  rules?: RuleRow[];
  findings?: FindingRow[];
  drafts?: DraftRow[];
  supplies?: SupplyRow[];
  demoStaff?: { id: string; display_name: string }[];
  ownerName?: string | null;
  selectedFindingId?: string | null;
  sent?: SentRow | null;
  allStores?: StoreOption[]; // 適用する店の選択肢(全店の一覧)
};

function BoardView(props: { store: StoreRow; board: BoardRow[]; today: JstDate }) {
  const { store, board, today } = props;
  const closed = isClosedDay(store.closed_days, today);
  return (
    <div class="pane">
      <div class="ph">
        <h1>今日のボード</h1>
        <span class="cnt">{today.label}</span>
        {closed && <span class="pill closed">休業日</span>}
      </div>
      <p class="lead">
        {store.name}({CLEANING_TYPE_LABEL[store.cleaning_type]}、営業 {store.opening_hours})。Slack の報告から、箇所ごとの今日の状態を映します。
      </p>
      {board.length === 0 ? (
        <p class="empty">今日のボードはまだありません。</p>
      ) : (
        <ul class="board">
          {board.map((b) => (
            <li>
              <span>
                {b.area_name}
                {b.status === "needs_recheck" && b.recheck_note && <span class="note key">写真で見えたもの: {b.recheck_note}</span>}
              </span>
              <span class={`status ${b.status}`}>
                {STATUS_LABEL[b.status]}
                {b.status === "done" && b.done_basis === "staff_word" ? "(本人の申告)" : ""}
                {b.status === "done" && b.done_basis === "photo" ? "(写真で確認)" : ""}
                {b.status === "carried_over" && b.carried_from_date
                  ? `(${Number(b.carried_from_date.slice(5, 7))}/${Number(b.carried_from_date.slice(8, 10))}から)`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function StorePage(props: StorePageProps) {
  const { store, board, today, isDemo, view } = props;
  const rules = props.rules ?? [];
  const findings = props.findings ?? [];
  const drafts = props.drafts ?? [];
  const candidates = rules.filter((r) => r.status === "candidate");
  const approvals = drafts.length + candidates.length;
  const recheck = board.filter((b) => b.status === "needs_recheck").length;
  const activeRules = rules.filter((r) => r.status === "active").length;
  const href = (v: View) => `/stores/${store.id}?view=${v}`;

  const items: NavItem[] = [
    { key: "board", label: VIEW_LABEL.board, icon: <IconLayoutDashboard />, href: href("board"), count: recheck, countStyle: "warn" },
    { key: "approvals", label: VIEW_LABEL.approvals, icon: <IconInbox />, href: href("approvals"), count: approvals, countStyle: "badge" },
    { key: "findings", label: VIEW_LABEL.findings, icon: <IconScanSearch />, href: href("findings"), count: findings.length, countStyle: "plain" },
    { key: "rules", label: VIEW_LABEL.rules, icon: <IconListChecks />, href: href("rules"), count: activeRules, countStyle: "plain" },
    { key: "supplies", label: VIEW_LABEL.supplies, icon: <IconPackage />, href: href("supplies") },
    ...(isDemo ? [{ key: "demo", label: VIEW_LABEL.demo, icon: <IconPlay />, href: href("demo") } satisfies NavItem] : []),
  ];

  const body =
    view === "approvals" ? (
      <ApprovalsSection storeId={store.id} drafts={drafts} candidates={candidates} closedDays={store.closed_days} sent={props.sent} stores={props.allStores} />
    ) : view === "findings" ? (
      <FindingsSection storeId={store.id} findings={findings} selectedId={props.selectedFindingId} />
    ) : view === "rules" ? (
      <RulesSection storeId={store.id} rules={rules} closedDays={store.closed_days} stores={props.allStores} />
    ) : view === "supplies" ? (
      <SuppliesSection rows={props.supplies ?? []} />
    ) : view === "demo" ? (
      <DemoPanel storeId={store.id} staff={props.demoStaff ?? []} />
    ) : (
      <BoardView store={store} board={board} today={today} />
    );

  return (
    <AppShell
      title={`${store.name} — ${VIEW_LABEL[view]}`}
      storeName={store.name}
      crumb={VIEW_LABEL[view]}
      now={whenWithWeekday((props.now ?? new Date()).toISOString())}
      isDemo={isDemo}
      ownerName={props.ownerName ?? null}
      items={items}
      activeKey={view}
    >
      {body}
      {props.sent && (
        <div class="toast" role="status">
          <IconCheck />
          {props.sent.recipient_name ?? "スタッフ"}さんに送りました
        </div>
      )}
    </AppShell>
  );
}

export function NotFoundPage() {
  return (
    <Layout title="ページが見つかりません">
      <h1>ページが見つかりません</h1>
      <p>店舗が見つかりませんでした。URL をご確認ください。</p>
      <p>
        <a href="/">店舗の一覧へ</a>
      </p>
    </Layout>
  );
}

export function StoreListPage(props: { stores: Pick<StoreRow, "id" | "name" | "cleaning_type">[]; isDemo: boolean }) {
  return (
    <Layout title="店舗の一覧">
      <header>
        {props.isDemo && <span class="pill demo">デモ環境(架空のデータ)</span>}
        <h1>店舗の一覧</h1>
      </header>
      <section>
        {props.stores.length === 0 ? (
          <p class="empty">店舗はまだありません。</p>
        ) : (
          <ul class="stores">
            {props.stores.map((s) => (
              <li>
                <a href={`/stores/${s.id}`}>
                  {s.name}
                  <span class="sub">{CLEANING_TYPE_LABEL[s.cleaning_type]}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p class="meta" style="margin-top:16px">
        <a href="/stats">実稼働の数字</a> <a href="/usage">Claude の消費</a>
      </p>
    </Layout>
  );
}
