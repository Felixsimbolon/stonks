import { and, asc, between, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Bar, CompanyEvent } from "@/lib/engine";
import { sectorsGet } from "./client";
import {
  parseDaily,
  parseDividendEvents,
  parseIndexDaily,
  parsePeers,
  type CorporateActions,
  type DailyRow,
  type IndexDailyRow,
  type PeersReport,
} from "./parse";

export { creditsUsed, SectorsError } from "./client";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const TTL = { daily: DAY, weekly: 7 * DAY, monthly: 30 * DAY } as const;

const MAX_RANGE_DAYS = 90; // Sectors clamps daily/index-daily ranges to 90 days
const RECHECK_MS = HOUR; // don't re-ask for "today" more often than this

const iso = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (date: string, n: number) => iso(new Date(Date.parse(date) + n * DAY));
export const todayWib = () => iso(new Date(Date.now() + 7 * HOUR));

/** Split [from, to] (inclusive) into ranges of at most MAX_RANGE_DAYS calendar days. */
export function chunkRange(from: string, to: string): [string, string][] {
  const out: [string, string][] = [];
  for (let start = from; start <= to; start = addDays(start, MAX_RANGE_DAYS)) {
    const end = addDays(start, MAX_RANGE_DAYS - 1);
    out.push([start, end < to ? end : to]);
  }
  return out;
}

/**
 * Return stored bars for `key` in [from, to], fetching only the parts not yet
 * stored. Past bars never change, so they are fetched once and kept forever.
 */
async function ensureBars(
  key: string,
  from: string,
  to: string,
  fetchChunk: (start: string, end: string) => Promise<Bar[]>,
): Promise<Bar[]> {
  const today = todayWib();
  if (to > today) to = today;

  const [cov] = await db.select().from(schema.barCoverage).where(eq(schema.barCoverage.ticker, key));
  const missing: [string, string][] = [];
  if (!cov) {
    missing.push([from, to]);
  } else {
    if (from < cov.from) missing.push([from, addDays(cov.from, -1)]);
    const recentlyChecked = Date.now() - cov.checkedAt.getTime() < RECHECK_MS;
    if (to > cov.through && !recentlyChecked) missing.push([addDays(cov.through, 1), to]);
  }

  for (const [a, b] of missing) {
    for (const [start, end] of chunkRange(a, b)) {
      const bars = await fetchChunk(start, end);
      for (const bar of bars) {
        await db
          .insert(schema.priceBars)
          .values({ ticker: key, ...bar })
          .onConflictDoUpdate({
            target: [schema.priceBars.ticker, schema.priceBars.date],
            set: { open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume },
          });
      }
    }
  }

  if (missing.length > 0) {
    // Today's bar may still change until the close, so it never counts as settled.
    const settled = to >= today ? addDays(today, -1) : to;
    const row = {
      ticker: key,
      from: cov && cov.from < from ? cov.from : from,
      through: cov && cov.through > settled ? cov.through : settled,
      checkedAt: new Date(),
    };
    await db.insert(schema.barCoverage).values(row).onConflictDoUpdate({ target: schema.barCoverage.ticker, set: row });
  }

  return db
    .select({
      date: schema.priceBars.date,
      open: schema.priceBars.open,
      high: schema.priceBars.high,
      low: schema.priceBars.low,
      close: schema.priceBars.close,
      volume: schema.priceBars.volume,
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
};

export function getDailyBars(ticker: string, from: string, to: string): Promise<Bar[]> {
  const t = ticker.toUpperCase();
  return ensureBars(t, from, to, async (start, end) =>
    parseDaily(await sectorsGet<DailyRow[]>(`/daily/${t}/?start=${start}&end=${end}`, { ttlMs: 0 })),
  );
}

/** Index bars are stored under `^CODE` so they never collide with a stock ticker. */
export function getIndexBars(code: string, from: string, to: string): Promise<Bar[]> {
  const c = code.toLowerCase();
  return ensureBars(`^${c.toUpperCase()}`, from, to, async (start, end) =>
    parseIndexDaily(await sectorsGet<IndexDailyRow[]>(`/index-daily/${c}/?start=${start}&end=${end}`, { ttlMs: 0 })),
  );
}

export async function getPeers(ticker: string): Promise<{ subSector: string | null; peers: string[] }> {
  const report = await sectorsGet<PeersReport>(`/company/report/${ticker.toUpperCase()}/?sections=peers`, {
    ttlMs: TTL.monthly,
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
): Promise<{ events: CompanyEvent[]; covers: CompanyEvent["type"][] }> {
  const actions = await sectorsGet<CorporateActions>(`/company/corporate-actions/${ticker.toUpperCase()}/`, {
    ttlMs: TTL.weekly,
  });
  return { events: parseDividendEvents(actions), covers: ["ex_dividend"] };
}
