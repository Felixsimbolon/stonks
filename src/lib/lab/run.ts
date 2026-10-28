import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { getCompanyEvents, getDailyBars, getIndexBars, getPeers, NotCachedError, todayWib } from "@/lib/sectors";
import { listWatchlist } from "@/lib/views";
import { runBacktest, type BacktestReport, type TickerHistory } from "./backtest";

// Loading stored history for the backtest and keeping its latest report.
// Read-only: never calls Sectors.

const REPORT_PATH = "data/reports/backtest-latest.json";

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
  mkdirSync("data/reports", { recursive: true });
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  return report;
}

export function readLatestReport(): BacktestReport | null {
  try {
    return JSON.parse(readFileSync(REPORT_PATH, "utf8")) as BacktestReport;
  } catch {
    return null;
  }
}
