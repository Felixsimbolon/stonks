import { and, asc, between, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Bar, CompanyEvent, FlowPoint, NewsItem } from "@/lib/engine";
import { sectorsGet } from "./client";
import {
  parseDaily,
  parseDividendEvents,
  parseForeignFlow,
  parseIndexDaily,
  parseNews,
  parsePeers,
  type CorporateActions,
  type DailyRow,
  type ForeignFlowResponse,
  type IndexDailyRow,
  type NewsResponse,
  type PeersReport,
} from "./parse";

export { creditsUsed, NotCachedError, SectorsError } from "./client";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// How often each kind of Sectors data changes. The docs don't state an update
// schedule; these follow the nature of the data:
//  - daily / index-daily: one bar per trading day, published after the close.
//    Past bars never change, so they are stored forever (price_bars).
//  - company report peers: subsector membership changes rarely.
//  - corporate actions: new dividends are announced occasionally.
//  - foreign flow: one value per trading day, stored like bars.
//  - news: a window ending before the latest session is final; a window
//    reaching today can still gain articles (re-fetched after a day).
export const TTL = { daily: DAY, weekly: 7 * DAY, monthly: 30 * DAY } as const;

/** Hour (WIB) after which today's bar is assumed to be published. IDX closes ~16:00. */
const PUBLISH_HOUR_WIB = 18;
const MAX_RANGE_DAYS = 90; // Sectors clamps daily/index-daily ranges to 90 days

const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (date: string, n: number) => iso(new Date(Date.parse(date) + n * DAY));
const nowWib = () => new Date(Date.now() + 7 * HOUR);
export const todayWib = () => iso(nowWib());

/** The newest trading date whose daily bar should already exist. */
export function latestPublishedDate(): string {
  const now = nowWib();
  let d = now.getUTCHours() >= PUBLISH_HOUR_WIB ? iso(now) : addDays(iso(now), -1);
  while (isWeekend(d)) d = addDays(d, -1);
  return d;
}

const isWeekend = (date: string) => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());

/** Split [from, to] (inclusive) into ranges of at most MAX_RANGE_DAYS calendar days. */
export function chunkRange(from: string, to: string): [string, string][] {
  const out: [string, string][] = [];
  for (let start = from; start <= to; start = addDays(start, MAX_RANGE_DAYS)) {
    const end = addDays(start, MAX_RANGE_DAYS - 1);
    out.push([start, end < to ? end : to]);
  }
  return out;
}

export interface FetchMode {
  /** false (default): read only what is stored, never call Sectors. */
  refresh?: boolean;
}

/**
 * With `refresh`, fetch the parts of a daily series in [from, to] that are not
 * stored yet and already published: older history the store does not reach,
 * and new sessions since the last stored one. `key` names the series in
 * bar_coverage; `fetchAndStore` fetches one ≤90-day chunk and upserts it.
 */
async function ensureCoverage(
  key: string,
  from: string,
  to: string,
  fetchAndStore: (start: string, end: string) => Promise<void>,
  { refresh = false }: FetchMode,
): Promise<void> {
  if (!refresh) return;
  const published = latestPublishedDate();
  const upTo = to < published ? to : published;
  const [cov] = await db.select().from(schema.barCoverage).where(eq(schema.barCoverage.ticker, key));
  const missing: [string, string][] = [];
  if (!cov) {
    missing.push([from, upTo]);
  } else {
    if (from < cov.from) missing.push([from, addDays(cov.from, -1)]);
    if (upTo > cov.through) missing.push([addDays(cov.through, 1), upTo]);
  }

  for (const [a, b] of missing) {
    for (const [start, end] of chunkRange(a, b)) await fetchAndStore(start, end);
  }

  if (missing.length > 0) {
    // A published date with no data (holiday) still counts as covered, so it is asked for once.
    const row = {
      ticker: key,
      from: cov && cov.from < from ? cov.from : from,
      through: cov && cov.through > upTo ? cov.through : upTo,
      checkedAt: new Date(),
    };
    await db.insert(schema.barCoverage).values(row).onConflictDoUpdate({ target: schema.barCoverage.ticker, set: row });
  }
}

/** Stored bars for `key` in [from, to]; with `refresh`, missing published sessions are fetched first. */
async function ensureBars(
  key: string,
  from: string,
  to: string,
  fetchChunk: (start: string, end: string) => Promise<Bar[]>,
  mode: FetchMode,
): Promise<Bar[]> {
  await ensureCoverage(
    key,
    from,
    to,
    async (start, end) => {
      for (const bar of await fetchChunk(start, end)) {
        await db
          .insert(schema.priceBars)
          .values({ ticker: key, ...bar })
          .onConflictDoUpdate({
            target: [schema.priceBars.ticker, schema.priceBars.date],
            set: {
              open: bar.open,
              high: bar.high,
              low: bar.low,
              close: bar.close,
              volume: bar.volume,
              marketCap: bar.marketCap ?? null,
            },
          });
      }
    },
    mode,
  );

  return db
    .select({
      date: schema.priceBars.date,
      open: schema.priceBars.open,
      high: schema.priceBars.high,
      low: schema.priceBars.low,
      close: schema.priceBars.close,
      volume: schema.priceBars.volume,
      marketCap: schema.priceBars.marketCap,
    })
    .from(schema.priceBars)
    .where(and(eq(schema.priceBars.ticker, key), between(schema.priceBars.date, from, to)))
    .orderBy(asc(schema.priceBars.date));
}

export const sourceOf = {
  daily: (ticker: string) => `sectors:/v2/daily/${ticker}/`,
  index: (code: string) => `sectors:/v2/index-daily/${code}/`,
  peers: (ticker: string) => `sectors:/v2/company/report/${ticker}/?sections=peers`,
  corporateActions: (ticker: string) => `sectors:/v2/company/corporate-actions/${ticker}/`,
  flows: (ticker: string) => `sectors:/v2/foreign-flow/${ticker}/`,
  news: (ticker: string) => `sectors:/v2/news/?symbols=${ticker}`,
};

/**
 * Daily foreign flow, stored like price bars (coverage key `FF:TICKER`).
 * Returns null when nothing is stored for the range and `refresh` is off.
 */
export async function getForeignFlows(
  ticker: string,
  from: string,
  to: string,
  mode: FetchMode = {},
): Promise<FlowPoint[] | null> {
  const t = ticker.toUpperCase();
  const key = `FF:${t}`;
  await ensureCoverage(
    key,
    from,
    to,
    async (start, end) => {
      const res = await sectorsGet<ForeignFlowResponse>(`/foreign-flow/${t}/?start=${start}&end=${end}`, { ttlMs: 0 });
      for (const p of parseForeignFlow(res)) {
        const row = { ticker: t, ...p };
        await db
          .insert(schema.foreignFlows)
          .values(row)
          .onConflictDoUpdate({ target: [schema.foreignFlows.ticker, schema.foreignFlows.date], set: row });
      }
    },
    mode,
  );

  const [cov] = await db.select().from(schema.barCoverage).where(eq(schema.barCoverage.ticker, key));
  if (!cov) return null;
  return db
    .select({
      date: schema.foreignFlows.date,
      net: schema.foreignFlows.net,
      buy: schema.foreignFlows.buy,
      sell: schema.foreignFlows.sell,
      foreignShare: schema.foreignFlows.foreignShare,
    })
    .from(schema.foreignFlows)
    .where(and(eq(schema.foreignFlows.ticker, t), between(schema.foreignFlows.date, from, to)))
    .orderBy(asc(schema.foreignFlows.date));
}

/**
 * Articles tagged with the ticker in [from, to] (max 30). Windows that end
 * before the latest published session never change, so they are cached for good.
 * Without `refresh`, throws NotCachedError if the window was never fetched.
 */
export async function getNews(ticker: string, from: string, to: string, { refresh = false }: FetchMode = {}): Promise<NewsItem[]> {
  const t = ticker.toUpperCase();
  const settled = to < latestPublishedDate();
  const res = await sectorsGet<NewsResponse>(`/news/?symbols=${t}&start=${from}&end=${to}&limit=30`, {
    ttlMs: settled ? Infinity : TTL.daily,
    cacheOnly: !refresh,
  });
  return parseNews(res);
}

export function getDailyBars(ticker: string, from: string, to: string, mode: FetchMode = {}): Promise<Bar[]> {
  const t = ticker.toUpperCase();
  return ensureBars(t, from, to, async (start, end) =>
    parseDaily(await sectorsGet<DailyRow[]>(`/daily/${t}/?start=${start}&end=${end}`, { ttlMs: 0 })),
    mode,
  );
}

/** Index bars are stored under `^CODE` so they never collide with a stock ticker. */
export function getIndexBars(code: string, from: string, to: string, mode: FetchMode = {}): Promise<Bar[]> {
  const c = code.toLowerCase();
  return ensureBars(`^${c.toUpperCase()}`, from, to, async (start, end) =>
    parseIndexDaily(await sectorsGet<IndexDailyRow[]>(`/index-daily/${c}/?start=${start}&end=${end}`, { ttlMs: 0 })),
    mode,
  );
}

/** Without `refresh`, throws NotCachedError if peers were never fetched. */
export async function getPeers(
  ticker: string,
  { refresh = false }: FetchMode = {},
): Promise<{ subSector: string | null; peers: string[] }> {
  const report = await sectorsGet<PeersReport>(`/company/report/${ticker.toUpperCase()}/?sections=peers`, {
    ttlMs: TTL.monthly,
    cacheOnly: !refresh,
  });
  return parsePeers(report);
}

/**
 * Company events Sectors can date precisely. Only dividends for now: the
 * quarterly-dates endpoint gives period ends (e.g. 2026-03-31), not release
 * dates, so earnings timing cannot be tested from it.
 */
export async function getCompanyEvents(
  ticker: string,
  { refresh = false }: FetchMode = {},
): Promise<{ events: CompanyEvent[]; covers: CompanyEvent["type"][] }> {
  const actions = await sectorsGet<CorporateActions>(`/company/corporate-actions/${ticker.toUpperCase()}/`, {
    ttlMs: TTL.weekly,
    cacheOnly: !refresh,
  });
  return { events: parseDividendEvents(actions), covers: ["ex_dividend"] };
}
