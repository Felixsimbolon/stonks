import { NotCachedError, TTL, type FetchMode } from "@/lib/sectors";
import { sectorsGet } from "@/lib/sectors/client";
import {
  parseCompanyList,
  parseDetail,
  parseFinancials,
  parseOwnership,
  parsePerformance,
  parsePrices,
  type CompanyListResponse,
  type DetailResponse,
  type FinancialsResponse,
  type OwnershipResponse,
  type PerformanceResponse,
  type PriceResponse,
} from "./parse";
import type {
  CommodityPrice,
  MiningCompanyRef,
  MiningDetail,
  MiningFinancials,
  MiningPerformance,
  Ownership,
} from "./types";

// Sectors mining extension. Data is annual (reserves, production, licenses,
// financials), so responses are cached for 30 days. Like everything else,
// nothing is fetched unless `refresh` is set; otherwise cache misses throw
// NotCachedError (use ifFetched to turn that into undefined).

const MONTH = TTL.monthly;

function opts(mode: FetchMode, extra: { allowNotFound?: boolean; ttlMs?: number } = {}) {
  return { ttlMs: extra.ttlMs ?? MONTH, cacheOnly: !mode.refresh, allowNotFound: extra.allowNotFound };
}

/** The mining-extension record for an IDX ticker, or null if it is not a mining company. */
export async function findMiningCompany(symbol: string, mode: FetchMode = {}): Promise<MiningCompanyRef | null> {
  const s = symbol.toUpperCase();
  const res = await sectorsGet<CompanyListResponse>(`/mining/companies/?keyword=${s}&limit=30`, opts(mode));
  // keyword also matches names and slugs, so require an exact ticker match.
  return parseCompanyList(res).find((c) => c.symbol === s) ?? null;
}

/** Mining companies Sectors has financials for (the ones a cost curve can include). */
export async function listCompaniesWithFinancials(mode: FetchMode = {}): Promise<MiningCompanyRef[]> {
  const res = await sectorsGet<CompanyListResponse>(`/mining/companies/?has_financials=true&limit=30`, opts(mode));
  return parseCompanyList(res);
}

export async function getMiningDetail(slug: string, mode: FetchMode = {}): Promise<MiningDetail | null> {
  const res = await sectorsGet<DetailResponse | null>(`/mining/companies/${slug}/`, opts(mode, { allowNotFound: true }));
  return res ? parseDetail(res) : null;
}

export async function getMiningPerformance(
  slug: string,
  year?: number,
  mode: FetchMode = {},
): Promise<MiningPerformance | null> {
  const q = year ? `?year=${year}` : "";
  const res = await sectorsGet<PerformanceResponse | null>(
    `/mining/companies/performance/${slug}/${q}`,
    opts(mode, { allowNotFound: true }),
  );
  return res ? parsePerformance(res) : null;
}

export async function getMiningFinancials(
  slug: string,
  year?: number,
  mode: FetchMode = {},
): Promise<MiningFinancials | null> {
  const q = year ? `?year=${year}` : "";
  const res = await sectorsGet<FinancialsResponse | null>(
    `/mining/companies/financials/${slug}/${q}`,
    opts(mode, { allowNotFound: true }),
  );
  return res ? parseFinancials(res) : null;
}

export async function getOwnership(slug: string, mode: FetchMode = {}): Promise<Ownership | null> {
  const res = await sectorsGet<OwnershipResponse | null>(
    `/mining/companies/ownership/${slug}/`,
    opts(mode, { allowNotFound: true }),
  );
  return res ? parseOwnership(res) : null;
}

/** Monthly benchmark prices (bi-weekly for recent coal). Max 3-year range per call. */
export async function getCommodityPrices(
  commodity: string,
  startYear: number,
  endYear: number,
  mode: FetchMode = {},
): Promise<CommodityPrice[]> {
  const res = await sectorsGet<PriceResponse | null>(
    `/mining/commodities/${commodity.toLowerCase()}/price/?start_year=${startYear}&end_year=${endYear}`,
    opts(mode, { allowNotFound: true, ttlMs: TTL.weekly }),
  );
  return res ? parsePrices(res) : [];
}

/**
 * Resolve to undefined when the data was never fetched (read-only mode).
 * Distinct from null, which the getters return when Sectors has no data.
 */
export async function ifFetched<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof NotCachedError) return undefined;
    throw e;
  }
}
