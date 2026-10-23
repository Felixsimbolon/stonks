import type { Bar } from "../types";

// Deterministic synthetic price series for engine tests. Real Sectors fixtures
// get recorded into data/fixtures once the MCP connection is live.

export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function normal(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export function tradingDates(n: number, start = "2026-01-05"): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  while (out.length < n) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function barsFromReturns(dates: string[], returns: number[], volumes: number[], start = 1000): Bar[] {
  let close = start;
  return dates.map((date, i) => {
    const prev = close;
    if (i > 0) close = prev * (1 + returns[i]);
    return { date, open: prev, high: Math.max(prev, close), low: Math.min(prev, close), close, volume: volumes[i] };
  });
}

export interface Scenario {
  dates: string[];
  marketReturns: number[];
  market: Bar[];
  /** Build a stock series with the given beta, idiosyncratic vol, and per-date overrides. */
  stock: (opts: {
    seed: number;
    beta?: number;
    vol?: number;
    shocks?: Record<string, number>; // extra return on a date
    volumeShocks?: Record<string, number>; // volume multiplier on a date
  }) => Bar[];
}

export function scenario(n = 160, seed = 42): Scenario {
  const rand = rng(seed);
  const dates = tradingDates(n);
  const marketReturns = dates.map((_, i) => (i === 0 ? 0 : 0.008 * normal(rand)));
  const market = barsFromReturns(dates, marketReturns, dates.map(() => 1e9));
  return {
    dates,
    marketReturns,
    market,
    stock: ({ seed: s, beta = 1, vol = 0.01, shocks = {}, volumeShocks = {} }) => {
      const r = rng(s);
      const rets = dates.map((d, i) => (i === 0 ? 0 : beta * marketReturns[i] + vol * normal(r) + (shocks[d] ?? 0)));
      const vols = dates.map((d) => 1e6 * (1 + 0.2 * normal(r) ** 2) * (volumeShocks[d] ?? 1));
      return barsFromReturns(dates, rets, vols);
    },
  };
}
