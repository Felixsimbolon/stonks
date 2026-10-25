import type {
  CommodityPrice,
  CommodityYear,
  License,
  MiningCompanyRef,
  MiningDetail,
  MiningFinancials,
  MiningPerformance,
  Ownership,
} from "./types";

// Pure mappers from Sectors v2 mining responses to domain types.

type Num = number | null | undefined;

export interface CompanyListResponse {
  results: { slug: string; name: string; symbol: string | null; company_type: string; commodity_type: string[] | null }[];
}

export interface DetailResponse {
  slug: string;
  name: string;
  symbol: string | null;
  company_type: string;
  key_operation?: string | null;
  commodity_type?: string[] | null;
  mining_license?: {
    license_type: string;
    license_number: string;
    province?: string | null;
    city?: string | null;
    license_effective_date?: string | null;
    license_expiry_date?: string | null;
    activity?: string | null;
    licensed_area_ha?: Num;
    cnc?: string | null;
    commodity_type?: string | null;
  }[];
  mining_site_count?: number | null;
}

export interface PerformanceResponse {
  year: number;
  available_years?: number[];
  data: {
    year: number;
    commodity_type: string;
    commodity_sub_type?: string | null;
    commodity_stats?: {
      unit?: string | null;
      production_volume?: Num;
      sales_volume?: Num;
      overburden_removal_volume?: Num;
      strip_ratio?: Num;
      resources_reserves?: {
        measurement_year?: number | null;
        total_reserves_Mt?: Num;
        proven_reserves_Mt?: Num;
        probable_reserves_Mt?: Num;
        total_resources_Mt?: Num;
      } | null;
    } | null;
  }[];
}

export interface FinancialsResponse {
  year: number;
  available_years?: number[];
  data: {
    year: number;
    assets_usd?: Num;
    revenue_usd?: Num;
    revenue_breakdown?: Record<string, Num> | null;
    cost_of_revenue_usd?: Num;
    cost_of_revenue_breakdown?: Record<string, Num> | null;
    net_profit_usd?: Num;
  };
}

export interface OwnershipResponse {
  slug: string;
  parents?: { name: string; slug: string; symbol: string | null; percentage_ownership: Num }[];
  subsidiaries?: { name: string; slug: string; symbol: string | null; percentage_ownership: Num }[];
}

export type PriceResponse = { name: string; date: string; price_usd_per_ton: Num }[];

export const stripJk = (s: string | null) => (s ? s.replace(/\.JK$/i, "").toUpperCase() : null);
const n = (x: Num): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/**
 * Sectors documents mining money as "USD millions" but its examples show raw
 * USD (e.g. 5,993,000,000). No mining company has revenue anywhere near
 * USD 100,000 million, so smaller values are read as millions.
 */
export function normalizeUsd(x: Num): number | null {
  const v = n(x);
  if (v === null) return null;
  return Math.abs(v) >= 1e5 ? v : v * 1e6;
}

export function parseCompanyList(res: CompanyListResponse): MiningCompanyRef[] {
  return res.results.map((r) => ({
    slug: r.slug,
    name: r.name,
    symbol: stripJk(r.symbol),
    companyType: r.company_type,
    commodities: r.commodity_type ?? [],
  }));
}

export function parseDetail(res: DetailResponse): MiningDetail {
  const licenses: License[] = (res.mining_license ?? []).map((l) => ({
    type: l.license_type,
    number: l.license_number,
    province: l.province ?? null,
    city: l.city ?? null,
    effective: l.license_effective_date ?? null,
    expiry: l.license_expiry_date ?? null,
    activity: l.activity ?? null,
    areaHa: n(l.licensed_area_ha),
    cleanAndClear: l.cnc ?? null,
    commodity: l.commodity_type ?? null,
  }));
  return {
    slug: res.slug,
    name: res.name,
    symbol: stripJk(res.symbol),
    companyType: res.company_type,
    commodities: res.commodity_type ?? [],
    keyOperation: res.key_operation ?? null,
    licenses,
    siteCount: res.mining_site_count ?? 0,
  };
}

export function parsePerformance(res: PerformanceResponse): MiningPerformance {
  const commodities: CommodityYear[] = res.data.map((d) => {
    const s = d.commodity_stats ?? {};
    const rr = s.resources_reserves ?? {};
    return {
      year: d.year,
      commodity: d.commodity_type,
      subType: d.commodity_sub_type ?? null,
      unit: s.unit ?? null,
      production: n(s.production_volume),
      sales: n(s.sales_volume),
      overburden: n(s.overburden_removal_volume),
      stripRatio: n(s.strip_ratio),
      reservesTotal: n(rr.total_reserves_Mt),
      reservesProven: n(rr.proven_reserves_Mt),
      reservesProbable: n(rr.probable_reserves_Mt),
      resourcesTotal: n(rr.total_resources_Mt),
      measurementYear: rr.measurement_year ?? null,
    };
  });
  return { year: res.year, availableYears: res.available_years ?? [res.year], commodities };
}

const cleanBreakdown = (b: Record<string, Num> | null | undefined) =>
  Object.fromEntries(
    Object.entries(b ?? {}).flatMap(([k, v]) => {
      const usd = normalizeUsd(v);
      return usd === null ? [] : [[k, usd]];
    }),
  );

export function parseFinancials(res: FinancialsResponse): MiningFinancials {
  const d = res.data;
  return {
    year: d.year ?? res.year,
    availableYears: res.available_years ?? [res.year],
    revenueUsd: normalizeUsd(d.revenue_usd),
    costOfRevenueUsd: normalizeUsd(d.cost_of_revenue_usd),
    netProfitUsd: normalizeUsd(d.net_profit_usd),
    assetsUsd: normalizeUsd(d.assets_usd),
    revenueBreakdown: cleanBreakdown(d.revenue_breakdown),
    costBreakdown: cleanBreakdown(d.cost_of_revenue_breakdown),
  };
}

export function parseOwnership(res: OwnershipResponse): Ownership {
  const link = (l: NonNullable<OwnershipResponse["parents"]>[number]) => ({
    slug: l.slug,
    name: l.name,
    symbol: stripJk(l.symbol),
    pct: n(l.percentage_ownership),
  });
  return { parents: (res.parents ?? []).map(link), subsidiaries: (res.subsidiaries ?? []).map(link) };
}

export function parsePrices(res: PriceResponse): CommodityPrice[] {
  return res
    .flatMap((r) => {
      const p = n(r.price_usd_per_ton);
      return p === null ? [] : [{ date: r.date, usdPerTon: p }];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}
