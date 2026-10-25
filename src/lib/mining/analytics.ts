import type { License, MiningFinancials, Ownership } from "./types";

// Pure asset-backing math for mining issuers. Everything here describes what
// backs a company (reserves, licenses, unit costs); none of it is a valuation
// or a recommendation.

export const TONS_PER_MT = 1_000_000;

// ── Reserves ─────────────────────────────────────────────────────────────

/** Years of reserves at the current production rate. */
export function reserveLife(reservesMt: number | null, productionMt: number | null): number | null {
  if (reservesMt === null || productionMt === null || productionMt <= 0) return null;
  return reservesMt / productionMt;
}

export interface ReservePoint {
  year: number;
  reservesMt: number | null;
  productionMt: number | null;
}

/**
 * Reserve replacement for a year: reserves added (net change plus what was
 * mined) per ton mined. Above 1, the company found or reclassified more than
 * it dug up; below 1, reserves are being drawn down.
 */
export function reserveReplacement(prev: ReservePoint, cur: ReservePoint): number | null {
  if (prev.reservesMt === null || cur.reservesMt === null || cur.productionMt === null || cur.productionMt <= 0) {
    return null;
  }
  return (cur.reservesMt - prev.reservesMt + cur.productionMt) / cur.productionMt;
}

// ── Licenses ─────────────────────────────────────────────────────────────

export interface LicenseRunway {
  count: number;
  totalAreaHa: number;
  expired: number;
  /** The license that expires first among those still valid. */
  nearest: License | null;
  /** Share of licensed area (still valid today) expiring within N years. */
  expiringShare: { within1y: number; within3y: number; within5y: number };
  /** Licensed area by expiry year, for a timeline. */
  byYear: { year: number; areaHa: number; count: number }[];
}

const yearsBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (365.25 * 86_400_000);

export function licenseRunway(licenses: License[], today: string): LicenseRunway {
  const dated = licenses.filter((l) => l.expiry !== null);
  const valid = dated.filter((l) => l.expiry! >= today);
  const area = (ls: License[]) => ls.reduce((a, l) => a + (l.areaHa ?? 0), 0);
  const validArea = area(valid);
  const within = (years: number) =>
    validArea > 0 ? area(valid.filter((l) => yearsBetween(today, l.expiry!) <= years)) / validArea : 0;

  const byYearMap = new Map<number, { areaHa: number; count: number }>();
  for (const l of dated) {
    const y = Number(l.expiry!.slice(0, 4));
    const cur = byYearMap.get(y) ?? { areaHa: 0, count: 0 };
    byYearMap.set(y, { areaHa: cur.areaHa + (l.areaHa ?? 0), count: cur.count + 1 });
  }

  return {
    count: licenses.length,
    totalAreaHa: area(licenses),
    expired: dated.length - valid.length,
    nearest: [...valid].sort((a, b) => a.expiry!.localeCompare(b.expiry!))[0] ?? null,
    expiringShare: { within1y: within(1), within3y: within(3), within5y: within(5) },
    byYear: [...byYearMap.entries()].map(([year, v]) => ({ year, ...v })).sort((a, b) => a.year - b.year),
  };
}

// ── Unit economics ───────────────────────────────────────────────────────

/** Share of revenue from coal lines (breakdown keys mentioning coal), or null without a breakdown. */
export function coalRevenueShare(fin: MiningFinancials): number | null {
  const entries = Object.entries(fin.revenueBreakdown);
  if (entries.length === 0 || !fin.revenueUsd) return null;
  const coal = entries.filter(([k]) => /coal/i.test(k)).reduce((a, [, v]) => a + v, 0);
  return coal / fin.revenueUsd;
}

export interface UnitEconomics {
  aspPerTon: number; // revenue per ton sold, USD
  costPerTon: number; // cost of revenue per ton sold, USD (incl. royalty, freight)
  marginPerTon: number;
}

/** Per-ton economics from annual financials and sales volume (Mt). */
export function unitEconomics(fin: MiningFinancials, salesMt: number | null): UnitEconomics | null {
  if (!salesMt || salesMt <= 0 || fin.revenueUsd === null || fin.costOfRevenueUsd === null) return null;
  const tons = salesMt * TONS_PER_MT;
  const aspPerTon = fin.revenueUsd / tons;
  const costPerTon = fin.costOfRevenueUsd / tons;
  return { aspPerTon, costPerTon, marginPerTon: aspPerTon - costPerTon };
}

/** IDR the market pays per ton of reserves (market cap ÷ reserves). */
export function marketCapPerTon(marketCapIdr: number | null, reservesMt: number | null): number | null {
  if (!marketCapIdr || !reservesMt || reservesMt <= 0) return null;
  return marketCapIdr / (reservesMt * TONS_PER_MT);
}

// ── Cost curve ───────────────────────────────────────────────────────────

/** Below this coal share of revenue, cost per ton mixes in other businesses. */
export const MIN_COAL_SHARE = 0.6;
/** A parent owning at least this much of another curve member consolidates it. */
export const CONSOLIDATION_PCT = 50;

export interface CurveCandidate {
  symbol: string;
  slug: string;
  name: string;
  year: number | null;
  salesMt: number | null;
  economics: UnitEconomics | null;
  coalShare: number | null;
}

export interface Exclusion {
  slug: string;
  reason: string;
}

/**
 * Decide which companies stay off the curve so that each ton is counted once
 * and every bar is a coal cost:
 *  - no usable sales or cost data;
 *  - mostly non-coal revenue;
 *  - consolidated with another member (≥50% owned): the one with the lower
 *    coal share is dropped (ties drop the parent).
 */
export function curveExclusions(candidates: CurveCandidate[], ownership: Map<string, Ownership>): Exclusion[] {
  const out = new Map<string, string>();
  for (const c of candidates) {
    if (!c.economics) out.set(c.slug, `No sales volume or cost data${c.year ? ` for ${c.year}` : ""}.`);
    else if (c.coalShare !== null && c.coalShare < MIN_COAL_SHARE) {
      out.set(c.slug, `Mostly non-coal revenue (${Math.round(c.coalShare * 100)}% coal); its cost per ton would mix businesses.`);
    }
  }

  const bySlug = new Map(candidates.map((c) => [c.slug, c]));
  for (const parent of candidates) {
    for (const sub of ownership.get(parent.slug)?.subsidiaries ?? []) {
      const child = bySlug.get(sub.slug);
      if (!child || (sub.pct ?? 0) < CONSOLIDATION_PCT) continue;
      if (out.has(parent.slug) || out.has(child.slug)) continue;
      const drop = (child.coalShare ?? 0) > (parent.coalShare ?? 0) ? parent : child;
      const keep = drop === parent ? child : parent;
      out.set(
        drop.slug,
        `${parent.symbol} owns ${sub.pct}% of ${child.symbol}; counted once, under ${keep.symbol}, to avoid double counting.`,
      );
    }
  }
  return [...out.entries()].map(([slug, reason]) => ({ slug, reason }));
}

export interface CurveSegment {
  symbol: string;
  slug: string;
  name: string;
  salesMt: number;
  costPerTon: number;
  aspPerTon: number;
  x0: number; // cumulative Mt before this company
  x1: number; // cumulative Mt after
}

export interface CostCurve {
  segments: CurveSegment[];
  totalMt: number;
}

/** Cheapest producer first; each bar's width is its sales volume. */
export function buildCurve(candidates: CurveCandidate[], exclusions: Exclusion[]): CostCurve {
  const excluded = new Set(exclusions.map((e) => e.slug));
  let x = 0;
  const segments = candidates
    .filter((c) => !excluded.has(c.slug) && c.economics && c.salesMt)
    .sort((a, b) => a.economics!.costPerTon - b.economics!.costPerTon)
    .map((c) => {
      const seg = {
        symbol: c.symbol,
        slug: c.slug,
        name: c.name,
        salesMt: c.salesMt!,
        costPerTon: c.economics!.costPerTon,
        aspPerTon: c.economics!.aspPerTon,
        x0: x,
        x1: x + c.salesMt!,
      };
      x = seg.x1;
      return seg;
    });
  return { segments, totalMt: x };
}

/** How the curve looks at a benchmark price: volume whose unit cost is above it. */
export function underwaterAt(curve: CostCurve, priceUsd: number): { mt: number; share: number; symbols: string[] } {
  const under = curve.segments.filter((s) => s.costPerTon > priceUsd);
  const mt = under.reduce((a, s) => a + s.salesMt, 0);
  return { mt, share: curve.totalMt > 0 ? mt / curve.totalMt : 0, symbols: under.map((s) => s.symbol) };
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
