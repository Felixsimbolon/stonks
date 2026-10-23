import type { Bar, CompanyEvent } from "@/lib/engine";

// Pure mappers from Sectors v2 response shapes to engine types.

export interface DailyRow {
  symbol: string;
  date: string;
  close: number;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number;
  market_cap: number;
}

export interface IndexDailyRow {
  index_code: string;
  date: string;
  price: number;
}

export interface PeersReport {
  symbol: string;
  peers?: {
    peers_data: {
      companies: { symbol: string; group?: string[] }[];
      group_name?: { sub_sector?: string };
    };
  }[];
}

export interface CorporateActions {
  symbol: string;
  corporate_actions: {
    dividend: { ex_date: string; dividend_amount: number | null; dividend_yield: number | null }[] | null;
  };
}

export const stripJk = (symbol: string) => symbol.replace(/\.JK$/i, "").toUpperCase();

export function parseDaily(rows: DailyRow[]): Bar[] {
  return rows
    .map((r) => ({
      date: r.date,
      open: r.open ?? r.close,
      high: r.high ?? r.close,
      low: r.low ?? r.close,
      close: r.close,
      volume: r.volume,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Indices only have a closing level; OHLC collapse to it and volume is 0. */
export function parseIndexDaily(rows: IndexDailyRow[]): Bar[] {
  return rows
    .map((r) => ({ date: r.date, open: r.price, high: r.price, low: r.price, close: r.price, volume: 0 }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Same-subsector peers, excluding the company itself. */
export function parsePeers(report: PeersReport): { subSector: string | null; peers: string[] } {
  const self = stripJk(report.symbol);
  const data = report.peers?.[0]?.peers_data;
  const peers = (data?.companies ?? [])
    .filter((c) => c.group?.includes("sub_sector"))
    .map((c) => stripJk(c.symbol))
    .filter((s) => s !== self);
  return { subSector: data?.group_name?.sub_sector ?? null, peers: [...new Set(peers)] };
}

export function parseDividendEvents(actions: CorporateActions): CompanyEvent[] {
  return (actions.corporate_actions.dividend ?? []).map((d) => ({
    type: "ex_dividend" as const,
    date: d.ex_date,
    dividendPerShare: d.dividend_amount ?? undefined,
  }));
}
