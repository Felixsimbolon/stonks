import { asc, count, eq } from "drizzle-orm";
import { headlineRecord, recordNote, type Tally, type TrackRow } from "@/lib/casebook/logic";
import { getCase, getTrackRecord, listCases, type CaseView } from "@/lib/casebook/store";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { windowOf, type HypothesisType, type Move } from "@/lib/engine";
import { investigateMove, scanTicker, type InvestigationResult } from "@/lib/pipeline";
import { getAssetBacking, loadCostCurve, type AssetBackingView, type CostCurveView } from "@/lib/mining/service";
import { creditsUsed, getPeers, NotCachedError } from "@/lib/sectors";

// Serializable data for pages. Everything here is safe to hand to client
// components. Read-only: these never call Sectors (see app/actions.ts).

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
  dataThrough: string | null;
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
        dataThrough: last?.date ?? null,
      });
    } catch (e) {
      rows.push({ ticker, prices: [], last: null, change: null, moves: [], dataThrough: null, error: errorMessage(e) });
    }
  }
  return rows;
}

export interface TickerView {
  ticker: string;
  prices: PricePoint[];
  moves: MoveSummary[];
  selected: string | null;
  dataThrough: string | null;
  result: (InvestigationResult & { windows: number[] }) | null;
  /** The case file for the selected move, if one was filed. */
  caseFile: CaseView | null;
  /** Per explanation: a one-line track record from closed cases, or null. */
  trackNotes: Partial<Record<HypothesisType, string | null>>;
  /** Mining asset backing; null when this doesn't look like a mining issuer. */
  assetBacking: AssetBackingView | null;
  error?: string;
}

const MINING_SUBSECTOR = /coal|mining|metal|mineral|gold|nickel|tin|copper/i;

/**
 * Asset backing for the ticker page, from stored data only. Shown when Sectors'
 * mining data has the ticker, or when its subsector looks like mining (so the
 * "fetch" prompt doesn't appear on banks and telcos).
 */
async function assetBackingFor(ticker: string): Promise<AssetBackingView | null> {
  const view = await getAssetBacking(ticker);
  if (view.status === "ready") return view;
  if (view.status === "not_mining") return null;
  let subSector: string | null = null;
  try {
    subSector = (await getPeers(ticker)).subSector;
  } catch (e) {
    if (!(e instanceof NotCachedError)) throw e;
  }
  return subSector && MINING_SUBSECTOR.test(subSector) ? view : null;
}

export async function getMiningView(): Promise<CostCurveView> {
  return loadCostCurve();
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
    const caseFile = move ? await getCase(ticker, move.date) : null;
    const record = await getTrackRecord();
    const trackNotes = Object.fromEntries(record.map((row) => [row.type, recordNote(row)]));
    return {
      ticker,
      prices: scan.bars.slice(-120).map((b) => ({ date: b.date, close: b.close })),
      moves: moves.map(summarize),
      selected: move?.date ?? null,
      dataThrough: scan.bars.at(-1)?.date ?? null,
      result,
      caseFile,
      trackNotes,
      assetBacking: await assetBackingFor(ticker),
    };
  } catch (e) {
    return {
      ticker,
      prices: [],
      moves: [],
      selected: null,
      dataThrough: null,
      result: null,
      caseFile: null,
      trackNotes: {},
      assetBacking: null,
      error: errorMessage(e),
    };
  }
}

export interface CasesView {
  cases: CaseView[];
  record: TrackRow[];
  headline: Tally;
}

export async function getCasesView(): Promise<CasesView> {
  const cases = await listCases();
  const record = await getTrackRecord(cases);
  return { cases, record, headline: headlineRecord(record) };
}

export async function countOpenCases(): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.investigations)
    .where(eq(schema.investigations.status, "open"));
  return row?.n ?? 0;
}
