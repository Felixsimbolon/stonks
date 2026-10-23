import {
  detectMoves,
  evaluateFalsifier,
  falsifiersFor,
  investigate,
  type Bar,
  type Falsifier,
  type FalsifierEvaluation,
  type Investigation,
  type Move,
} from "@/lib/engine";
import {
  addDays,
  getCompanyEvents,
  getDailyBars,
  getIndexBars,
  getPeers,
  SectorsError,
  sourceOf,
  todayWib,
} from "@/lib/sectors";

// Glue between Sectors data and the pure engine. Calls are sequential on
// purpose: the credit check is per call, and SQLite prefers one writer.

export const MARKET_INDEX = "ihsg";

export interface ScanResult {
  ticker: string;
  bars: Bar[];
  market: Bar[];
  moves: Move[];
}

/** Fetch history and flag unusual moves in the last `scanDays` trading days. */
export async function scanTicker(ticker: string, { historyDays = 270, scanDays = 60 } = {}): Promise<ScanResult> {
  const to = todayWib();
  const from = addDays(to, -historyDays);
  const bars = await getDailyBars(ticker, from, to);
  const market = await getIndexBars(MARKET_INDEX, from, to);
  return { ticker: ticker.toUpperCase(), bars, market, moves: detectMoves(ticker.toUpperCase(), bars, market, scanDays) };
}

export interface InvestigationResult {
  investigation: Investigation;
  subSector: string | null;
  peerCount: number;
  falsifiers: (Falsifier & { evaluation: FalsifierEvaluation })[];
}

export async function investigateMove(scan: ScanResult, move: Move): Promise<InvestigationResult> {
  const { ticker, bars, market } = scan;
  const to = todayWib();

  const { subSector, peers: peerTickers } = await getPeers(ticker);
  const peers: Record<string, Bar[]> = {};
  for (const p of peerTickers) {
    try {
      peers[p] = await getDailyBars(p, addDays(move.date, -10), to);
    } catch (e) {
      if (e instanceof SectorsError && e.status === 404) continue; // delisted / renamed peer
      throw e;
    }
  }

  const { events, covers } = await getCompanyEvents(ticker);

  const investigation = investigate({
    ticker,
    move,
    bars,
    marketBars: market,
    peers,
    events,
    eventTypesCovered: covers,
    sources: {
      stock: sourceOf.daily(ticker),
      market: sourceOf.index(MARKET_INDEX),
      peers: sourceOf.peers(ticker),
      events: sourceOf.corporateActions(ticker),
    },
  });

  const falsifiers = falsifiersFor(move, investigation.hypotheses).map((f) => ({
    ...f,
    evaluation: evaluateFalsifier(f.rule, { move, bars, marketBars: market, peers }),
  }));

  return { investigation, subSector, peerCount: Object.keys(peers).length, falsifiers };
}
