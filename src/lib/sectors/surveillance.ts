import type { BrokerDay, Suspension } from "@/lib/engine";
import { sectorsGet } from "./client";
import { latestPublishedDate, TTL, type FetchMode } from "./index";
import { stripJk } from "./parse";

// Data for the surveillance-desk explanations: per-broker activity, IDX
// suspension notices, and conglomerate groups. Same rules as the rest of the
// data layer: nothing is fetched unless `refresh` is set.

// ── Response shapes (Sectors v2) ──

export interface BrokerSummaryResponse {
  symbol: string;
  data: {
    date: string;
    summary: { broker_code: string; bval: number | null; sval: number | null; nval: number | null }[];
  }[];
}

export interface SuspensionsResponse {
  results: { symbol: string; suspension_date: string; reason: string | null; pdf_url: string | null }[];
}

export interface OverviewResponse {
  overview?: { affiliates?: string[] | null } | null;
}

export interface ScreenerResponse {
  results: { symbol: string; company_name?: string }[];
}

// ── Pure parsers ──

export function parseBrokerSummary(res: BrokerSummaryResponse): BrokerDay[] {
  return res.data
    .map((d) => ({
      date: d.date,
      rows: d.summary.map((r) => {
        const buy = r.bval ?? 0;
        const sell = r.sval ?? 0;
        return { broker: r.broker_code, buyValue: buy, sellValue: sell, netValue: r.nval ?? buy - sell };
      }),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function parseSuspensions(res: SuspensionsResponse): Suspension[] {
  return res.results
    .map((r) => ({ date: r.suspension_date, reason: (r.reason ?? "no reason given").trim(), url: r.pdf_url }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function parseAffiliates(res: OverviewResponse): string[] {
  return [...new Set((res.overview?.affiliates ?? []).map((a) => a.trim()).filter(Boolean))];
}

export function parseScreenerSymbols(res: ScreenerResponse): string[] {
  return res.results.map((r) => stripJk(r.symbol));
}

// ── Fetchers ──

/** A window that ends before the latest published session never changes. */
const ttlFor = (to: string) => (to < latestPublishedDate() ? Infinity : TTL.daily);

/** Per-broker daily activity, up to 14 days per call. */
export async function getBrokerDays(ticker: string, from: string, to: string, { refresh = false }: FetchMode = {}) {
  const t = ticker.toUpperCase();
  const res = await sectorsGet<BrokerSummaryResponse | null>(`/broker-summary/${t}/?start=${from}&end=${to}`, {
    ttlMs: ttlFor(to),
    cacheOnly: !refresh,
    allowNotFound: true,
  });
  return res ? parseBrokerSummary(res) : [];
}

export async function getSuspensions(ticker: string, from: string, to: string, { refresh = false }: FetchMode = {}) {
  const t = ticker.toUpperCase();
  const res = await sectorsGet<SuspensionsResponse | null>(`/suspensions/?symbol=${t}&start=${from}&end=${to}&limit=30`, {
    ttlMs: ttlFor(to),
    cacheOnly: !refresh,
    allowNotFound: true,
  });
  return res ? parseSuspensions(res) : [];
}

/** Conglomerate groups / affiliates on record for a company (company report overview, 1 credit). */
export async function getAffiliates(ticker: string, { refresh = false }: FetchMode = {}) {
  const res = await sectorsGet<OverviewResponse | null>(`/company/report/${ticker.toUpperCase()}/?sections=overview`, {
    ttlMs: TTL.monthly,
    cacheOnly: !refresh,
    allowNotFound: true,
  });
  return res ? parseAffiliates(res) : [];
}

/** Listed companies in a group, largest first (company screener, 1 credit). */
export async function getGroupMembers(affiliate: string, { refresh = false }: FetchMode = {}) {
  const where = `affiliates in ['${affiliate.replace(/'/g, "''")}']`;
  const res = await sectorsGet<ScreenerResponse | null>(
    `/companies/?where=${encodeURIComponent(where)}&order_by=-market_cap&limit=20`,
    { ttlMs: TTL.monthly, cacheOnly: !refresh, allowNotFound: true },
  );
  return res ? parseScreenerSymbols(res) : [];
}

export const surveillanceSource = {
  brokers: (t: string) => `sectors:/v2/broker-summary/${t}/`,
  suspensions: (t: string) => `sectors:/v2/suspensions/?symbol=${t}`,
  groups: (t: string) => `sectors:/v2/company/report/${t}/?sections=overview + /v2/companies/?where=affiliates`,
};
