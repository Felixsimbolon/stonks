// Domain types for the Sectors mining extension, after parsing.
// Volumes are in the unit Sectors reports (Mt for coal); money is in USD.

export interface MiningCompanyRef {
  slug: string;
  name: string;
  symbol: string | null; // IDX ticker without .JK; null for unlisted companies
  companyType: string;
  commodities: string[];
}

export interface License {
  type: string; // IUP, IUPK, PKP2B, KK, …
  number: string;
  province: string | null;
  city: string | null;
  effective: string | null;
  expiry: string | null;
  activity: string | null; // "Eksplorasi" | "Operasi Produksi"
  areaHa: number | null;
  cleanAndClear: string | null;
  commodity: string | null;
}

export interface MiningDetail extends MiningCompanyRef {
  keyOperation: string | null;
  licenses: License[];
  siteCount: number;
}

export interface CommodityYear {
  year: number;
  commodity: string;
  subType: string | null;
  unit: string | null;
  production: number | null;
  sales: number | null;
  overburden: number | null;
  stripRatio: number | null;
  reservesTotal: number | null;
  reservesProven: number | null;
  reservesProbable: number | null;
  resourcesTotal: number | null;
  measurementYear: number | null;
}

export interface MiningPerformance {
  year: number;
  availableYears: number[];
  commodities: CommodityYear[];
}

export interface MiningFinancials {
  year: number;
  availableYears: number[];
  revenueUsd: number | null;
  costOfRevenueUsd: number | null;
  netProfitUsd: number | null;
  assetsUsd: number | null;
  revenueBreakdown: Record<string, number>;
  costBreakdown: Record<string, number>;
}

export interface OwnerLink {
  slug: string;
  name: string;
  symbol: string | null;
  pct: number | null;
}

export interface Ownership {
  parents: OwnerLink[];
  subsidiaries: OwnerLink[];
}

export interface CommodityPrice {
  date: string;
  usdPerTon: number;
}
