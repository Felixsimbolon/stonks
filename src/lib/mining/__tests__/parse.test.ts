import { describe, expect, it } from "vitest";
import {
  normalizeUsd,
  parseCompanyList,
  parseDetail,
  parseFinancials,
  parseOwnership,
  parsePerformance,
  parsePrices,
} from "../parse";

// Payloads mirror real Sectors responses (PTBA, Oct 2026) and the docs examples.

describe("normalizeUsd", () => {
  it("keeps raw USD and scales documented millions", () => {
    expect(normalizeUsd(5_993_000_000)).toBe(5_993_000_000);
    expect(normalizeUsd(5993)).toBe(5_993_000_000);
    expect(normalizeUsd(-120)).toBe(-120_000_000);
    expect(normalizeUsd(null)).toBeNull();
    expect(normalizeUsd(undefined)).toBeNull();
  });
});

describe("mining parsers", () => {
  it("strips .JK from listed symbols and keeps null for unlisted ones", () => {
    const list = parseCompanyList({
      results: [
        { slug: "pt-bukit-asam-tbk", name: "PT Bukit Asam Tbk", symbol: "PTBA.JK", company_type: "Holding", commodity_type: ["Coal"] },
        { slug: "x", name: "X", symbol: null, company_type: "Trader", commodity_type: null },
      ],
    });
    expect(list[0]).toEqual({
      slug: "pt-bukit-asam-tbk",
      name: "PT Bukit Asam Tbk",
      symbol: "PTBA",
      companyType: "Holding",
      commodities: ["Coal"],
    });
    expect(list[1]).toMatchObject({ symbol: null, commodities: [] });
  });

  it("maps licenses from the company detail", () => {
    const d = parseDetail({
      slug: "pt-bukit-asam-tbk",
      name: "PT Bukit Asam Tbk",
      symbol: "PTBA.JK",
      company_type: "Holding",
      key_operation: "Coal Mining",
      commodity_type: ["Coal"],
      mining_license: [
        {
          license_type: "IUP",
          license_number: "1/1/IUP-PB/PMDN/2019",
          province: "Sumatera Selatan",
          city: "Kabupaten Muara Enim",
          license_effective_date: "2019-05-27",
          license_expiry_date: "2027-04-09",
          activity: "Operasi Produksi",
          licensed_area_ha: 4500,
          cnc: "CNC-2",
          commodity_type: "Coal",
        },
      ],
      mining_site_count: 0,
    });
    expect(d.symbol).toBe("PTBA");
    expect(d.licenses[0]).toEqual({
      type: "IUP",
      number: "1/1/IUP-PB/PMDN/2019",
      province: "Sumatera Selatan",
      city: "Kabupaten Muara Enim",
      effective: "2019-05-27",
      expiry: "2027-04-09",
      activity: "Operasi Produksi",
      areaHa: 4500,
      cleanAndClear: "CNC-2",
      commodity: "Coal",
    });
  });

  it("flattens performance stats and reserves", () => {
    const p = parsePerformance({
      year: 2024,
      available_years: [2023, 2024],
      data: [
        {
          year: 2024,
          commodity_type: "Coal",
          commodity_sub_type: "Sub-bituminous",
          commodity_stats: {
            unit: "Mt",
            production_volume: 43.28,
            sales_volume: 42.89,
            overburden_removal_volume: 269.63,
            strip_ratio: 6.23,
            resources_reserves: {
              measurement_year: 2024,
              total_reserves_Mt: 2933,
              proven_reserves_Mt: null,
              probable_reserves_Mt: null,
              total_resources_Mt: 5766,
            },
          },
        },
      ],
    });
    expect(p.availableYears).toEqual([2023, 2024]);
    expect(p.commodities[0]).toMatchObject({
      commodity: "Coal",
      production: 43.28,
      sales: 42.89,
      stripRatio: 6.23,
      reservesTotal: 2933,
      reservesProven: null,
      resourcesTotal: 5766,
      measurementYear: 2024,
    });
  });

  it("normalizes financials and their breakdowns", () => {
    const f = parseFinancials({
      year: 2024,
      available_years: [2023, 2024],
      data: {
        year: 2024,
        assets_usd: 5_993_000_000,
        revenue_usd: 5_320_000_000,
        revenue_breakdown: { coal_mining_and_trading: 5_108_610_000, logistics: 183_680_000, others: null },
        cost_of_revenue_usd: 3_853_630_000,
        cost_of_revenue_breakdown: { royalty: 1_020_160_000 },
        net_profit_usd: 1_327_000_000,
      },
    });
    expect(f.revenueUsd).toBe(5_320_000_000);
    expect(f.costOfRevenueUsd).toBe(3_853_630_000);
    expect(f.revenueBreakdown).toEqual({ coal_mining_and_trading: 5_108_610_000, logistics: 183_680_000 });
    expect(f.costBreakdown).toEqual({ royalty: 1_020_160_000 });
  });

  it("maps ownership links", () => {
    const o = parseOwnership({
      slug: "pt-adaro-andalan-indonesia-tbk",
      parents: [{ name: "PT Alamtri Resources Indonesia Tbk", slug: "pt-alamtri", symbol: "ADRO.JK", percentage_ownership: 15.37 }],
      subsidiaries: [],
    });
    expect(o.parents).toEqual([{ slug: "pt-alamtri", name: "PT Alamtri Resources Indonesia Tbk", symbol: "ADRO", pct: 15.37 }]);
  });

  it("sorts prices and drops empty points", () => {
    expect(
      parsePrices([
        { name: "Coal", date: "2024-02-01", price_usd_per_ton: 120 },
        { name: "Coal", date: "2024-01-01", price_usd_per_ton: 125.85 },
        { name: "Coal", date: "2024-03-01", price_usd_per_ton: null },
      ]),
    ).toEqual([
      { date: "2024-01-01", usdPerTon: 125.85 },
      { date: "2024-02-01", usdPerTon: 120 },
    ]);
  });
});
