import { Layout } from "./Layout";
import type { JstDate } from "../lib/time";
import { RulesSection, type RuleRow } from "./RulesSection";

export type StoreRow = {
  id: string;
  name: string;
  cleaning_type: "daily" | "weekly";
  opening_hours: string;
  closed_days: string;
};

export type BoardRow = {
  area_name: string;
  status: "done" | "pending" | "carried_over" | "no_assignee";
};

const CLEANING_TYPE_LABEL = { daily: "毎日の店", weekly: "週次巡回の店" } as const;
const STATUS_LABEL = { done: "完了", pending: "未清掃", carried_over: "繰り越し", no_assignee: "対応者不在" } as const;

export function isClosedDay(closedDaysJson: string, today: JstDate): boolean {
  try {
    const c = JSON.parse(closedDaysJson) as { weekdays?: number[]; dates?: string[] };
    return (c.weekdays ?? []).includes(today.weekday) || (c.dates ?? []).includes(today.iso);
  } catch {
    return false;
  }
}

export function StorePage(props: { store: StoreRow; board: BoardRow[]; today: JstDate; isDemo: boolean; rules?: RuleRow[] }) {
  const { store, board, today, isDemo } = props;
  const closed = isClosedDay(store.closed_days, today);
  return (
    <Layout title={`${store.name} — 今日のボード`}>
      <header>
        {isDemo && <span class="badge demo">デモ(架空のデータ)</span>}
        <h1>{store.name}</h1>
        <div class="meta">
          <span>{CLEANING_TYPE_LABEL[store.cleaning_type]}</span>
          <span>営業 {store.opening_hours}</span>
        </div>
      </header>

      <section class="card" aria-labelledby="board-title">
        <h2 id="board-title">
          今日のボード <span class="meta" style="display:inline">{today.label}</span>
          {closed && (
            <>
              {" "}
              <span class="badge">休業日</span>
            </>
          )}
        </h2>
        {board.length === 0 ? (
          <p class="empty">今日のボードはまだありません。</p>
        ) : (
          <ul class="board">
            {board.map((b) => (
              <li>
                <span>{b.area_name}</span>
                <span class={`status ${b.status}`}>{STATUS_LABEL[b.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <RulesSection storeId={store.id} rules={props.rules ?? []} />
    </Layout>
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
        {props.isDemo && <span class="badge demo">デモ(架空のデータ)</span>}
        <h1>店舗の一覧</h1>
      </header>
      <section class="card">
        {props.stores.length === 0 ? (
          <p class="empty">店舗はまだありません。</p>
        ) : (
          <ul class="stores">
            {props.stores.map((s) => (
              <li>
                <a href={`/stores/${s.id}`}>
                  {s.name} <span class="meta" style="display:inline">{CLEANING_TYPE_LABEL[s.cleaning_type]}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Layout>
  );
}
