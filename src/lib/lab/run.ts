import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCompanyEvents, getDailyBars, getIndexBars, getPeers, NotCachedError, todayWib } from "@/lib/sectors";
import { listWatchlist } from "@/lib/views";
import { runBacktest, type BacktestReport, type TickerHistory } from "./backtest";

// Loading stored history for the backtest and keeping its latest report in
// the database (so it also works on hosts with a read-only filesystem).
// Read-only with respect to Sectors: never calls the API.

const REPORT_KEY = "backtest-latest";

async function cached<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof NotCachedError) return undefined;
    throw e;
  }
}

export async function loadHistories(): Promise<TickerHistory[]> {
  const to = todayWib();
  const market = await getIndexBars("ihsg", "2000-01-01", to);
  const out: TickerHistory[] = [];
  for (const t of await listWatchlist()) {
    const bars = await getDailyBars(t, "2000-01-01", to);
    const peerInfo = await cached(getPeers(t));
    const peers: TickerHistory["peers"] = {};
    for (const p of peerInfo?.peers ?? []) {
      const b = await getDailyBars(p, "2000-01-01", to);
      if (b.length) peers[p] = b;
    }
    const events = (await cached(getCompanyEvents(t)))?.events;
    out.push({ ticker: t, bars, market, peers, events });
  }
  return out;
}

export async function runAndSaveBacktest(): Promise<BacktestReport> {
  const report = runBacktest(await loadHistories());
  const row = { key: REPORT_KEY, payload: report, updatedAt: new Date() };
  await db.insert(schema.reports).values(row).onConflictDoUpdate({ target: schema.reports.key, set: row });
  return report;
}

export async function readLatestReport(): Promise<BacktestReport | null> {
  const [row] = await db.select().from(schema.reports).where(eq(schema.reports.key, REPORT_KEY));
  return row ? (row.payload as BacktestReport) : null;
}
