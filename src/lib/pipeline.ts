import {
  decompose,
  detectMoves,
  evaluateFalsifier,
  eventStudy,
  falsifierPath,
  falsifiersFor,
  investigate,
  type Bar,
  type Falsifier,
  type FalsifierEvaluation,
  type EventStudy,
  type FalsifierPath,
  type GroupData,
  type HypothesisType,
  type Investigation,
  type Move,
  type NewsItem,
  type PostMoveData,
  NOT_NEEDED_BELOW,
} from "@/lib/engine";
import {
  addDays,
  getCompanyEvents,
  getDailyBars,
  getForeignFlows,
  getIndexBars,
  getNews,
  getPeers,
  NotCachedError,
  SectorsError,
  type FetchMode,
  sourceOf,
  todayWib,
} from "@/lib/sectors";
import { getAffiliates, getBrokerDays, getGroupMembers, getSuspensions, surveillanceSource } from "@/lib/sectors/surveillance";

// Glue between Sectors data and the pure engine. Calls are sequential on
// purpose: the credit check is per call, and SQLite prefers one writer.
//
// Nothing here calls Sectors unless `refresh: true` is passed. Pages read the
// local store; fetching only happens when the user asks for it.

export const MARKET_INDEX = "ihsg";
const PEER_HISTORY_DAYS = 180;
// ~58 sessions of foreign flow before the move: one 90-day call for recent moves.
const FLOW_HISTORY_DAYS = 80;

export interface ScanResult {
  ticker: string;
  bars: Bar[];
  market: Bar[];
  moves: Move[];
}

/** Load (or with `refresh`, fetch) history and flag unusual moves in the last `scanDays` trading days. */
export async function scanTicker(
  ticker: string,
  { historyDays = 270, scanDays = 60, refresh = false }: { historyDays?: number; scanDays?: number } & FetchMode = {},
): Promise<ScanResult> {
  const to = todayWib();
  const from = addDays(to, -historyDays);
  const bars = await getDailyBars(ticker, from, to, { refresh });
  const market = await getIndexBars(MARKET_INDEX, from, to, { refresh });
  return { ticker: ticker.toUpperCase(), bars, market, moves: detectMoves(ticker.toUpperCase(), bars, market, scanDays) };
}

export interface InvestigationResult {
  investigation: Investigation;
  subSector: string | null;
  peerCount: number;
  falsifiers: (Falsifier & { evaluation: FalsifierEvaluation; path: FalsifierPath | null })[];
  /** Articles tagged with the ticker on the move day or the day before. */
  articles: NewsItem[];
  /** Abnormal returns around the move and CARs over standard windows. */
  event: EventStudy;
  /** Evidence that was never fetched; the hypotheses that need it show as untested. */
  missing: { peers: boolean; events: boolean; flows: boolean; news: boolean; brokers: boolean; suspensions: boolean; groups: boolean };
}

const MAX_GROUPS = 2;
const MAX_GROUP_MEMBERS = 6;

/**
 * Conglomerate groups of a stock with other listed members (outside its
 * subsector peers), each with short bar history around the move.
 * Returns undefined when group data was never fetched.
 */
async function loadGroups(
  ticker: string,
  move: Move,
  peerSet: Set<string>,
  mode: FetchMode,
): Promise<GroupData[] | undefined> {
  const affiliates = await orMissing(getAffiliates(ticker, mode));
  if (!affiliates) return undefined;
  const to = todayWib();
  const seen = new Set([ticker, ...peerSet]);
  const groups: GroupData[] = [];
  let budget = MAX_GROUP_MEMBERS;
  for (const name of affiliates.slice(0, MAX_GROUPS)) {
    const symbols = await orMissing(getGroupMembers(name, mode));
    if (!symbols) return undefined;
    const members: Record<string, Bar[]> = {};
    for (const m of symbols) {
      if (budget <= 0) break;
      if (seen.has(m)) continue;
      seen.add(m);
      try {
        const b = await getDailyBars(m, addDays(move.date, -10), to, mode);
        if (b.length > 0) {
          members[m] = b;
          budget--;
        }
      } catch (e) {
        if (e instanceof SectorsError && e.status === 404) continue;
        throw e;
      }
    }
    groups.push({ name, members });
  }
  return groups;
}

export async function investigateMove(
  scan: ScanResult,
  move: Move,
  { refresh = false, priors }: FetchMode & { priors?: Partial<Record<HypothesisType, number>> } = {},
): Promise<InvestigationResult> {
  const { ticker, bars, market } = scan;
  const to = todayWib();

  // ~120 trading days before the move, so peer betas and the stock-specific
  // volatility can be estimated. Stored bars are reused across moves and runs.
  const peerFrom = addDays(move.date, -PEER_HISTORY_DAYS);
  const peerInfo = await orMissing(getPeers(ticker, { refresh }));
  const peers: Record<string, Bar[]> = {};
  for (const p of peerInfo?.peers ?? []) {
    try {
      const peerBars = await getDailyBars(p, peerFrom, to, { refresh });
      if (peerBars.length > 0) peers[p] = peerBars;
    } catch (e) {
      if (e instanceof SectorsError && e.status === 404) continue; // delisted / renamed peer
      throw e;
    }
  }
  const peersMissing = !peerInfo || (peerInfo.peers.length > 0 && !Object.values(peers).some((b) => b.some((x) => x.date === move.date)));

  const eventInfo = await orMissing(getCompanyEvents(ticker, { refresh }));
  const { events, covers } = eventInfo ?? { events: undefined, covers: undefined };

  // Foreign flow and news only matter for the stock-specific part of the move.
  // Skip fetching them when market + sector already explain it (saves credits).
  const needStockEvidence = decompose(move, bars, market, peers).shares.stockSpecific >= NOT_NEEDED_BELOW;
  const stockMode = { refresh: refresh && needStockEvidence };
  const flows = await getForeignFlows(ticker, addDays(move.date, -FLOW_HISTORY_DAYS), to, stockMode);
  const newsTo = addDays(move.date, 1) < to ? addDays(move.date, 1) : to;
  const news = await orMissing(getNews(ticker, addDays(move.date, -2), newsTo, stockMode));

  // Surveillance desk: broker concentration, IDX suspensions, conglomerate group.
  const brokers = await orMissing(getBrokerDays(ticker, addDays(move.date, -13), move.date, stockMode));
  const suspTo = addDays(move.date, 3) < to ? addDays(move.date, 3) : to;
  const suspensions = await orMissing(getSuspensions(ticker, addDays(move.date, -10), suspTo, stockMode));
  const groups = await loadGroups(ticker, move, new Set(Object.keys(peers)), stockMode);

  const investigation = investigate({
    ticker,
    move,
    bars,
    marketBars: market,
    peers,
    events,
    eventTypesCovered: covers,
    flows: flows ?? undefined,
    news: news ?? undefined,
    brokers: brokers ?? undefined,
    suspensions: suspensions ?? undefined,
    groups,
    priors,
    sources: {
      stock: sourceOf.daily(ticker),
      market: sourceOf.index(MARKET_INDEX),
      peers: sourceOf.peers(ticker),
      events: sourceOf.corporateActions(ticker),
      flows: sourceOf.flows(ticker),
      news: sourceOf.news(ticker),
      brokers: surveillanceSource.brokers(ticker),
      suspensions: surveillanceSource.suspensions(ticker),
      groups: surveillanceSource.groups(ticker),
    },
  });

  const post = { move, bars, marketBars: market, peers, flows: flows ?? undefined, groups };
  const falsifiers = falsifiersFor(investigation).map((f) => ({
    ...f,
    evaluation: evaluateFalsifier(f.rule, post),
    path: falsifierPath(f.rule, post),
  }));

  return {
    investigation,
    subSector: peerInfo?.subSector ?? null,
    peerCount: Object.keys(peers).length,
    falsifiers,
    event: eventStudy(move, bars, market),
    articles: (news ?? []).filter((n) => {
      const day = n.timestamp.slice(0, 10);
      return day >= addDays(move.date, -1) && day <= move.date;
    }),
    missing: {
      peers: peersMissing,
      events: !eventInfo,
      flows: needStockEvidence && flows === null,
      news: needStockEvidence && news === null,
      brokers: needStockEvidence && brokers === null,
      suspensions: needStockEvidence && suspensions === null,
      groups: needStockEvidence && groups === undefined,
    },
  };
}

/**
 * Everything a frozen falsifier needs to be re-checked, from the local store
 * only (never calls Sectors). `asOf` is the latest stored session of the stock.
 */
export async function loadPostMoveData(ticker: string, move: Move): Promise<PostMoveData & { asOf: string | null }> {
  const t = ticker.toUpperCase();
  const to = todayWib();
  // A few sessions before the move so the move-day return can be computed.
  const from = addDays(move.date, -10);
  const bars = await getDailyBars(t, from, to);
  const marketBars = await getIndexBars(MARKET_INDEX, from, to);
  const peerInfo = await orMissing(getPeers(t));
  const peers: Record<string, Bar[]> = {};
  for (const p of peerInfo?.peers ?? []) {
    const peerBars = await getDailyBars(p, from, to);
    if (peerBars.length > 0) peers[p] = peerBars;
  }
  const flows = await getForeignFlows(t, from, to);
  const groups = await loadGroups(t, move, new Set(Object.keys(peers)), {});
  return { move, bars, marketBars, peers, flows: flows ?? undefined, groups, asOf: bars.at(-1)?.date ?? null };
}

/** Resolve to null when the data was never fetched (read-only mode). */
async function orMissing<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof NotCachedError) return null;
    throw e;
  }
}
