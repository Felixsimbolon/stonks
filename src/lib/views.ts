import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { windowOf, type Move } from "@/lib/engine";
import { investigateMove, scanTicker, type InvestigationResult } from "@/lib/pipeline";
import { creditsUsed } from "@/lib/sectors";

// Serializable data for pages. Everything here is safe to hand to client components.

export const TICKER_RE = /^[A-Z]{4}$/;

export async function listWatchlist(): Promise<string[]> {
  const rows = await db.select().from(schema.watchlist).orderBy(asc(schema.watchlist.addedAt));
  return rows.map((r) => r.ticker);
}

export async function addToWatchlist(ticker: string) {
  await db.insert(schema.watchlist).values({ ticker }).onConflictDoNothing();
}

export async function removeFromWatchlist(ticker: string) {
  await db.delete(schema.watchlist).where(eq(schema.watchlist.ticker, ticker));
}

export interface Credits {
  used: number;
  limit: number;
}

export async function getCredits(): Promise<Credits> {
  return { used: await creditsUsed(), limit: env.SECTORS_CREDIT_LIMIT };
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface PricePoint {
  date: string;
  close: number;
}

export interface MoveSummary {
  date: string;
  ret: number;
  abnormalZ: number;
}

const summarize = (m: Move): MoveSummary => ({ date: m.date, ret: m.ret, abnormalZ: m.abnormalZ });

export interface WatchRow {
  ticker: string;
  prices: PricePoint[];
  last: number | null;
  change: number | null;
  moves: MoveSummary[];
  error?: string;
}

export async function getWatchRows(tickers: string[]): Promise<WatchRow[]> {
  const rows: WatchRow[] = [];
  for (const ticker of tickers) {
    try {
      const scan = await scanTicker(ticker, { scanDays: 20 });
      const bars = scan.bars;
      const last = bars.at(-1);
      const prev = bars.at(-2);
      rows.push({
        ticker,
        prices: bars.slice(-60).map((b) => ({ date: b.date, close: b.close })),
        last: last?.close ?? null,
        change: last && prev ? last.close / prev.close - 1 : null,
        moves: scan.moves.map(summarize).reverse(),
      });
    } catch (e) {
      rows.push({ ticker, prices: [], last: null, change: null, moves: [], error: errorMessage(e) });
    }
  }
  return rows;
}

export interface TickerView {
  ticker: string;
  prices: PricePoint[];
  moves: MoveSummary[];
  selected: string | null;
  result: (InvestigationResult & { windows: number[] }) | null;
  error?: string;
}

export async function getTickerView(ticker: string, date?: string): Promise<TickerView> {
  try {
    const scan = await scanTicker(ticker, { scanDays: 60 });
    const moves = scan.moves;
    // Default to the most recent flagged move.
    const move = moves.find((m) => m.date === date) ?? moves.at(-1) ?? null;
    let result: TickerView["result"] = null;
    if (move) {
      const r = await investigateMove(scan, move);
      result = { ...r, windows: r.falsifiers.map((f) => windowOf(f.rule)) };
    }
    return {
      ticker,
      prices: scan.bars.slice(-120).map((b) => ({ date: b.date, close: b.close })),
      moves: moves.map(summarize),
      selected: move?.date ?? null,
      result,
    };
  } catch (e) {
    return { ticker, prices: [], moves: [], selected: null, result: null, error: errorMessage(e) };
  }
}
