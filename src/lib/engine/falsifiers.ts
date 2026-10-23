import { dailyReturns, median } from "./stats";
import type { Bar, HypothesisResult, HypothesisType, Move } from "./types";

// A tiny, deterministic rule language for "what would prove this story wrong".
// Rules are stored as JSON and re-evaluated every day after the market closes.

export type FalsifierMetric =
  | "cum_abnormal_return" // sum of beta-adjusted returns after the move day
  | "spread_vs_peer_median" // stock cum return minus median peer cum return after the move day
  | "retracement" // share of the move given back (1 = fully reversed, negative = extended)
  | "avg_volume_ratio"; // avg volume after the move / pre-move baseline volume

export type FalsifierRule =
  | { metric: FalsifierMetric; window: number; op: ">" | "<" | "abs>"; value: number }
  | { all: FalsifierRule[] };

export interface Falsifier {
  hypothesisType: HypothesisType;
  description: string;
  rule: FalsifierRule;
}

export interface PostMoveData {
  move: Move;
  bars: Bar[];
  marketBars: Bar[];
  peers: Record<string, Bar[]>;
}

export type FalsifierStatus = "pending" | "triggered" | "survived";

export interface FalsifierEvaluation {
  status: FalsifierStatus;
  daysObserved: number;
  triggeredOn?: string;
}

function windowOf(rule: FalsifierRule): number {
  return "all" in rule ? Math.max(...rule.all.map(windowOf)) : rule.window;
}

/** Cumulative compound return over the first `n` returns dated after `date`. */
function cumAfter(bars: Bar[], date: string, n: number): number | null {
  const rs = dailyReturns(bars).filter((r) => r.date > date).slice(0, n);
  if (rs.length < n) return null;
  return rs.reduce((acc, r) => acc * (1 + r.value), 1) - 1;
}

function metricValue(metric: FalsifierMetric, data: PostMoveData, n: number): number | null {
  const { move, bars, marketBars, peers } = data;
  switch (metric) {
    case "cum_abnormal_return": {
      const stock = dailyReturns(bars).filter((r) => r.date > move.date).slice(0, n);
      const market = new Map(dailyReturns(marketBars).map((r) => [r.date, r.value]));
      if (stock.length < n) return null;
      return stock.reduce((acc, r) => acc + r.value - move.beta * (market.get(r.date) ?? 0), 0);
    }
    case "spread_vs_peer_median": {
      const stock = cumAfter(bars, move.date, n);
      const peerCums = Object.values(peers)
        .map((p) => cumAfter(p, move.date, n))
        .filter((x): x is number => x !== null);
      if (stock === null || peerCums.length === 0) return null;
      return stock - median(peerCums);
    }
    case "retracement": {
      const stock = cumAfter(bars, move.date, n);
      if (stock === null || move.ret === 0) return null;
      return -stock / move.ret;
    }
    case "avg_volume_ratio": {
      const idx = bars.findIndex((b) => b.date === move.date);
      const after = bars.slice(idx + 1, idx + 1 + n);
      if (idx < 0 || after.length < n || move.volumeRatio === 0) return null;
      const baseline = bars[idx].volume / move.volumeRatio;
      return after.reduce((a, b) => a + b.volume, 0) / n / baseline;
    }
  }
}

function holdsAt(rule: FalsifierRule, data: PostMoveData, n: number): boolean | null {
  if ("all" in rule) {
    const parts = rule.all.map((r) => holdsAt(r, data, Math.min(n, windowOf(r))));
    if (parts.some((p) => p === null)) return null;
    return parts.every(Boolean);
  }
  const v = metricValue(rule.metric, data, n);
  if (v === null) return null;
  if (rule.op === ">") return v > rule.value;
  if (rule.op === "<") return v < rule.value;
  return Math.abs(v) > rule.value;
}

export function evaluateFalsifier(rule: FalsifierRule, data: PostMoveData): FalsifierEvaluation {
  const window = windowOf(rule);
  const after = data.bars.filter((b) => b.date > data.move.date);
  const observable = Math.min(window, after.length);
  for (let n = 1; n <= observable; n++) {
    if (holdsAt(rule, data, n)) return { status: "triggered", daysObserved: n, triggeredOn: after[n - 1].date };
  }
  return { status: observable >= window ? "survived" : "pending", daysObserved: observable };
}

/** Default falsifiers per hypothesis type, parameterized by the move itself. */
export function defaultFalsifiers(move: Move, hypothesis: HypothesisResult): Falsifier[] {
  const dir = Math.sign(move.ret) || 1;
  const drift = (days: number) => 2 * move.residualStd * Math.sqrt(days);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

  switch (hypothesis.type) {
    case "market_beta":
      return [{
        hypothesisType: "market_beta",
        description: `The stock keeps moving on its own: beta-adjusted return beyond ±${pct(drift(5))} within 5 trading days.`,
        rule: { metric: "cum_abnormal_return", window: 5, op: "abs>", value: drift(5) },
      }];
    case "sector_rotation": {
      const gap = Math.max(0.03, drift(5));
      return [{
        hypothesisType: "sector_rotation",
        description: `The stock decouples from its subsector: return gap vs peer median beyond ±${pct(gap)} within 5 trading days.`,
        rule: { metric: "spread_vs_peer_median", window: 5, op: "abs>", value: gap },
      }];
    }
    case "earnings":
      return [{
        hypothesisType: "earnings",
        description: "The market gives back more than half the move within 5 trading days.",
        rule: { metric: "retracement", window: 5, op: ">", value: 0.5 },
      }];
    case "dividend":
    case "noise":
      return [{
        hypothesisType: hypothesis.type,
        description: `The move keeps going: beta-adjusted return extends another ${pct(drift(5))} in the same direction within 5 trading days.`,
        rule: dir > 0
          ? { metric: "cum_abnormal_return", window: 5, op: ">", value: drift(5) }
          : { metric: "cum_abnormal_return", window: 5, op: "<", value: -drift(5) },
      }];
    case "liquidity":
      return [{
        hypothesisType: "liquidity",
        description: "Volume returns to normal but the price keeps moving in the same direction.",
        rule: {
          all: [
            { metric: "avg_volume_ratio", window: 3, op: "<", value: 1.2 },
            dir > 0
              ? { metric: "cum_abnormal_return", window: 3, op: ">", value: drift(3) }
              : { metric: "cum_abnormal_return", window: 3, op: "<", value: -drift(3) },
          ],
        },
      }];
  }
}

/** Falsifiers for every hypothesis that is still standing. */
export function falsifiersFor(move: Move, hypotheses: HypothesisResult[]): Falsifier[] {
  return hypotheses
    .filter((h) => h.verdict !== "refuted" && h.verdict !== "untested")
    .flatMap((h) => defaultFalsifiers(move, h));
}
