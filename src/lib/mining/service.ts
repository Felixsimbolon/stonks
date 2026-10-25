import { addDays, getDailyBars, todayWib, type FetchMode } from "@/lib/sectors";
import {
  buildCurve,
  coalRevenueShare,
  curveExclusions,
  licenseRunway,
  marketCapPerTon,
  median,
  reserveLife,
  reserveReplacement,
  unitEconomics,
  type CostCurve,
  type CurveCandidate,
  type LicenseRunway,
  type UnitEconomics,
} from "./analytics";
import {
  findMiningCompany,
  getCommodityPrices,
  getMiningDetail,
  getMiningFinancials,
  getMiningPerformance,
  getOwnership,
  ifFetched,
  listCompaniesWithFinancials,
} from "./fetch";
import type { CommodityPrice, CommodityYear, MiningCompanyRef, MiningDetail, MiningPerformance, Ownership } from "./types";

// Asset backing for mining issuers, assembled from the Sectors mining
// extension. Read-only unless `refresh` is passed (then only missing or
// expired pieces are fetched).

const HISTORY_YEARS = 3;

/** The commodity a company is mainly judged on: coal if present, else its first one. */
function primary(perf: MiningPerformance | null | undefined): CommodityYear | null {
  if (!perf) return null;
  return perf.commodities.find((c) => c.commodity === "Coal") ?? perf.commodities[0] ?? null;
}

/** Latest stored market cap (IDR) for a ticker; with refresh, fetches the last few sessions. */
async function latestMarketCap(symbol: string, mode: FetchMode): Promise<number | null> {
  const to = todayWib();
  const bars = await getDailyBars(symbol, addDays(to, -10), to, mode);
  return [...bars].reverse().find((b) => b.marketCap)?.marketCap ?? null;
}

// ── Cost curve ───────────────────────────────────────────────────────────

export interface CurveRow {
  symbol: string;
  slug: string;
  name: string;
  year: number | null;
  salesMt: number | null;
  productionMt: number | null;
  reservesMt: number | null;
  reserveLifeYears: number | null;
  stripRatio: number | null;
  economics: UnitEconomics | null;
  coalShare: number | null;
  marketCapIdr: number | null;
  capPerTonIdr: number | null;
  excluded: string | null;
}

export interface CostCurveView {
  /** "not_fetched": the company list itself was never loaded. */
  status: "ready" | "not_fetched";
  /** Some company's data is still missing; a refresh would complete it. */
  incomplete: boolean;
  rows: CurveRow[];
  curve: CostCurve;
  prices: CommodityPrice[];
  latestPrice: CommodityPrice | null;
}

export async function loadCostCurve(mode: FetchMode = {}): Promise<CostCurveView> {
  const empty: CostCurveView = {
    status: "not_fetched",
    incomplete: true,
    rows: [],
    curve: { segments: [], totalMt: 0 },
    prices: [],
    latestPrice: null,
  };
  const companies = await ifFetched(listCompaniesWithFinancials(mode));
  if (companies === undefined) return empty;

  let incomplete = false;
  const candidates: (CurveCandidate & { perf: CommodityYear | null; marketCapIdr: number | null })[] = [];
  const ownership = new Map<string, Ownership>();

  for (const c of companies.filter((x): x is MiningCompanyRef & { symbol: string } => x.symbol !== null)) {
    const fin = await ifFetched(getMiningFinancials(c.slug, undefined, mode));
    const perf = fin ? await ifFetched(getMiningPerformance(c.slug, fin.year, mode)) : null;
    const own = await ifFetched(getOwnership(c.slug, mode));
    if (fin === undefined || perf === undefined || own === undefined) incomplete = true;
    if (own) ownership.set(c.slug, own);

    const coal = primary(perf);
    candidates.push({
      symbol: c.symbol,
      slug: c.slug,
      name: c.name,
      year: fin?.year ?? null,
      salesMt: coal?.sales ?? null,
      economics: fin ? unitEconomics(fin, coal?.sales ?? null) : null,
      coalShare: fin ? coalRevenueShare(fin) : null,
      perf: coal,
      marketCapIdr: await latestMarketCap(c.symbol, mode),
    });
  }

  const exclusions = curveExclusions(candidates, ownership);
  const reason = new Map(exclusions.map((e) => [e.slug, e.reason]));
  const rows: CurveRow[] = candidates.map((c) => ({
    symbol: c.symbol,
    slug: c.slug,
    name: c.name,
    year: c.year,
    salesMt: c.salesMt,
    productionMt: c.perf?.production ?? null,
    reservesMt: c.perf?.reservesTotal ?? null,
    reserveLifeYears: reserveLife(c.perf?.reservesTotal ?? null, c.perf?.production ?? null),
    stripRatio: c.perf?.stripRatio ?? null,
    economics: c.economics,
    coalShare: c.coalShare,
    marketCapIdr: c.marketCapIdr,
    capPerTonIdr: marketCapPerTon(c.marketCapIdr, c.perf?.reservesTotal ?? null),
    excluded: reason.get(c.slug) ?? null,
  }));

  const year = Number(todayWib().slice(0, 4));
  const prices = (await ifFetched(getCommodityPrices("coal", year - 2, year, mode))) ?? [];
  if (prices.length === 0) incomplete = true;

  return {
    status: "ready",
    incomplete,
    rows,
    curve: buildCurve(candidates, exclusions),
    prices,
    latestPrice: prices.at(-1) ?? null,
  };
}

// ── One issuer ───────────────────────────────────────────────────────────

export interface ReserveYear {
  year: number;
  reservesMt: number | null;
  productionMt: number | null;
  replacement: number | null;
}

export interface CostPosition {
  rank: number;
  of: number;
  costPerTon: number;
  aspPerTon: number;
  latestPrice: CommodityPrice | null;
}

export interface AssetBackingView {
  status: "ready" | "not_fetched" | "not_mining";
  company: MiningDetail | null;
  latest: CommodityYear | null;
  history: ReserveYear[];
  reserveLifeYears: number | null;
  runway: LicenseRunway | null;
  capPerTonIdr: number | null;
  /** Median market cap per ton of reserves across cost-curve companies, when loaded. */
  peerCapPerTonIdr: number | null;
  costPosition: CostPosition | null;
  /** Why there is no cost position, when there isn't one. */
  costNote: string | null;
}

const NOT_MINING: AssetBackingView = {
  status: "not_mining",
  company: null,
  latest: null,
  history: [],
  reserveLifeYears: null,
  runway: null,
  capPerTonIdr: null,
  peerCapPerTonIdr: null,
  costPosition: null,
  costNote: null,
};

export async function getAssetBacking(symbol: string, mode: FetchMode = {}): Promise<AssetBackingView> {
  const ref = await ifFetched(findMiningCompany(symbol, mode));
  if (ref === undefined) return { ...NOT_MINING, status: "not_fetched" };
  if (ref === null) return NOT_MINING;

  const detail = (await ifFetched(getMiningDetail(ref.slug, mode))) ?? null;
  const latestPerf = await ifFetched(getMiningPerformance(ref.slug, undefined, mode));
  if (latestPerf === undefined) return { ...NOT_MINING, status: "not_fetched" };

  // Reserve history: the latest year plus up to two before it.
  const years = (latestPerf?.availableYears ?? []).filter((y) => y !== latestPerf?.year).sort((a, b) => b - a);
  const perfs: MiningPerformance[] = latestPerf ? [latestPerf] : [];
  for (const y of years.slice(0, HISTORY_YEARS - 1)) {
    const p = await ifFetched(getMiningPerformance(ref.slug, y, mode)); // sequential: one credit check at a time
    if (p) perfs.push(p);
  }
  perfs.sort((a, b) => a.year - b.year);
  const points = perfs.map((p) => {
    const c = primary(p);
    return { year: p.year, reservesMt: c?.reservesTotal ?? null, productionMt: c?.production ?? null };
  });
  const history = points.map((p, i) => ({ ...p, replacement: i > 0 ? reserveReplacement(points[i - 1], p) : null }));

  const latest = primary(latestPerf);
  const marketCap = await latestMarketCap(symbol, {}); // stored bars only
  const capPerTonIdr = marketCapPerTon(marketCap, latest?.reservesTotal ?? null);

  // Cost position and peer comparison come from the cost curve, if it was loaded.
  const curve = await loadCostCurve({});
  const peerCaps = curve.rows.map((r) => r.capPerTonIdr).filter((x): x is number => x !== null);
  const idx = curve.curve.segments.findIndex((s) => s.symbol === symbol.toUpperCase());
  const row = curve.rows.find((r) => r.symbol === symbol.toUpperCase());
  const seg = curve.curve.segments[idx];

  return {
    status: "ready",
    company: detail,
    latest,
    history,
    reserveLifeYears: reserveLife(latest?.reservesTotal ?? null, latest?.production ?? null),
    runway: detail ? licenseRunway(detail.licenses, todayWib()) : null,
    capPerTonIdr,
    peerCapPerTonIdr: median(peerCaps),
    costPosition: seg
      ? { rank: idx + 1, of: curve.curve.segments.length, costPerTon: seg.costPerTon, aspPerTon: seg.aspPerTon, latestPrice: curve.latestPrice }
      : null,
    costNote: seg
      ? null
      : row?.excluded
        ? row.excluded
        : curve.status === "not_fetched"
          ? "Load the coal cost curve to see where this company sits."
          : "Sectors has no mining financials for this company, so its cost per ton is unknown.",
  };
}
