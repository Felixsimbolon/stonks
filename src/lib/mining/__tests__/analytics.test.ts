import { describe, expect, it } from "vitest";
import {
  buildCurve,
  coalRevenueShare,
  curveExclusions,
  licenseRunway,
  marketCapPerTon,
  median,
  reserveLife,
  reserveReplacement,
  underwaterAt,
  unitEconomics,
  type CurveCandidate,
} from "../analytics";
import type { License, MiningFinancials, Ownership } from "../types";

const license = (expiry: string | null, areaHa: number): License => ({
  type: "IUP",
  number: expiry ?? "n/a",
  province: null,
  city: null,
  effective: null,
  expiry,
  activity: "Operasi Produksi",
  areaHa,
  cleanAndClear: "CNC",
  commodity: "Coal",
});

const fin = (revenue: number, cost: number, breakdown: Record<string, number> = {}): MiningFinancials => ({
  year: 2024,
  availableYears: [2024],
  revenueUsd: revenue,
  costOfRevenueUsd: cost,
  netProfitUsd: null,
  assetsUsd: null,
  revenueBreakdown: breakdown,
  costBreakdown: {},
});

describe("reserves", () => {
  it("computes reserve life (PTBA 2024: 2,933 Mt / 43.28 Mt)", () => {
    expect(reserveLife(2933, 43.28)).toBeCloseTo(67.77, 1);
    expect(reserveLife(2933, 0)).toBeNull();
    expect(reserveLife(null, 40)).toBeNull();
  });

  it("computes reserve replacement", () => {
    // reserves fell by 20 while 40 was mined → 20 added per 40 mined
    expect(reserveReplacement({ year: 2023, reservesMt: 1000, productionMt: 40 }, { year: 2024, reservesMt: 980, productionMt: 40 })).toBe(0.5);
    expect(reserveReplacement({ year: 2023, reservesMt: null, productionMt: 40 }, { year: 2024, reservesMt: 980, productionMt: 40 })).toBeNull();
  });
});

describe("licenseRunway", () => {
  const today = "2026-10-25";
  const ls = [license("2027-04-09", 4500), license("2029-08-29", 2866), license("2035-09-07", 22937), license("2025-01-01", 100), license(null, 50)];

  it("finds the nearest valid expiry and counts expired ones", () => {
    const r = licenseRunway(ls, today);
    expect(r.count).toBe(5);
    expect(r.expired).toBe(1);
    expect(r.nearest?.expiry).toBe("2027-04-09");
    expect(r.totalAreaHa).toBe(4500 + 2866 + 22937 + 100 + 50);
  });

  it("shares expiring area by horizon over still-valid licenses", () => {
    const r = licenseRunway(ls, today);
    const valid = 4500 + 2866 + 22937;
    expect(r.expiringShare.within1y).toBeCloseTo(4500 / valid);
    expect(r.expiringShare.within3y).toBeCloseTo((4500 + 2866) / valid);
    expect(r.expiringShare.within5y).toBeCloseTo((4500 + 2866) / valid);
  });

  it("groups area by expiry year", () => {
    expect(licenseRunway(ls, today).byYear.map((b) => b.year)).toEqual([2025, 2027, 2029, 2035]);
  });
});

describe("unit economics", () => {
  it("derives per-ton revenue, cost and margin", () => {
    const u = unitEconomics(fin(5_320_000_000, 3_853_630_000), 65)!;
    expect(u.aspPerTon).toBeCloseTo(81.85, 1);
    expect(u.costPerTon).toBeCloseTo(59.29, 1);
    expect(u.marginPerTon).toBeCloseTo(u.aspPerTon - u.costPerTon);
    expect(unitEconomics(fin(1, 1), 0)).toBeNull();
  });

  it("measures the coal share of revenue from the breakdown", () => {
    expect(coalRevenueShare(fin(100, 50, { coal_mining_and_trading: 90, logistics: 10 }))).toBe(0.9);
    expect(coalRevenueShare(fin(100, 50))).toBeNull();
  });

  it("prices reserves per ton", () => {
    expect(marketCapPerTon(30e12, 3000)).toBe(10_000);
    expect(marketCapPerTon(null, 3000)).toBeNull();
  });

  it("takes a median", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBeNull();
  });
});

describe("cost curve", () => {
  const cand = (symbol: string, salesMt: number | null, cost: number, coalShare: number | null = 0.95): CurveCandidate => ({
    symbol,
    slug: symbol.toLowerCase(),
    name: symbol,
    year: 2024,
    salesMt,
    economics: salesMt ? { aspPerTon: 80, costPerTon: cost, marginPerTon: 80 - cost } : null,
    coalShare,
  });

  it("excludes missing data and mostly non-coal companies", () => {
    const ex = curveExclusions([cand("AAAA", null, 50), cand("BBBB", 10, 50, 0.3), cand("CCCC", 10, 50)], new Map());
    expect(ex.map((e) => e.slug).sort()).toEqual(["aaaa", "bbbb"]);
  });

  it("counts a consolidated pair once, keeping the purer coal company", () => {
    const own = new Map<string, Ownership>([
      ["dssa", { parents: [], subsidiaries: [{ slug: "gems", name: "GEMS", symbol: "GEMS", pct: 62 }] }],
    ]);
    const ex = curveExclusions([cand("DSSA", 40, 50, 0.7), cand("GEMS", 40, 45, 0.98)], own);
    expect(ex).toEqual([expect.objectContaining({ slug: "dssa" })]);
  });

  it("keeps both when the stake is a minority", () => {
    const own = new Map<string, Ownership>([
      ["adro", { parents: [], subsidiaries: [{ slug: "aadi", name: "AADI", symbol: "AADI", pct: 15.37 }] }],
    ]);
    expect(curveExclusions([cand("ADRO", 10, 50), cand("AADI", 60, 45)], own)).toEqual([]);
  });

  it("orders the curve by cost and accumulates volume", () => {
    const curve = buildCurve([cand("HIGH", 10, 70), cand("LOW", 30, 40), cand("MID", 20, 55)], []);
    expect(curve.segments.map((s) => s.symbol)).toEqual(["LOW", "MID", "HIGH"]);
    expect(curve.segments.map((s) => [s.x0, s.x1])).toEqual([
      [0, 30],
      [30, 50],
      [50, 60],
    ]);
    expect(curve.totalMt).toBe(60);
  });

  it("reports the volume above a benchmark price", () => {
    const curve = buildCurve([cand("HIGH", 10, 70), cand("LOW", 30, 40)], []);
    expect(underwaterAt(curve, 60)).toEqual({ mt: 10, share: 0.25, symbols: ["HIGH"] });
  });
});
