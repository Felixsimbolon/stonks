import { dailyReturns, median } from "./stats";
import type { Bar, FlowPoint, GroupData, HypothesisResult, HypothesisType, Investigation, Move } from "./types";

// A tiny, deterministic rule language for "what would prove this story wrong".
// Rules are stored as JSON and re-evaluated every day after the market closes.

export type FalsifierMetric =
  | "cum_abnormal_return" // sum of beta-adjusted returns after the move day
  | "spread_vs_peer_median" // stock cum return minus median peer cum return after the move day
  | "retracement" // share of the move given back (1 = fully reversed, negative = extended)
  | "avg_volume_ratio" // avg volume after the move / pre-move baseline volume
  | "foreign_flow_ratio" // net foreign flow after the move / net foreign flow on the move day
  | "spread_vs_group_median"; // stock cum return minus median conglomerate-group member cum return

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
  flows?: FlowPoint[];
  groups?: GroupData[];
}

export type FalsifierStatus = "pending" | "triggered" | "survived";

export interface FalsifierEvaluation {
  status: FalsifierStatus;
  daysObserved: number;
  triggeredOn?: string;
}

export function windowOf(rule: FalsifierRule): number {
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
    case "spread_vs_group_median": {
      const stock = cumAfter(bars, move.date, n);
      const memberCums = (data.groups ?? []).flatMap((g) =>
        Object.values(g.members)
          .map((m) => cumAfter(m, move.date, n))
          .filter((x): x is number => x !== null),
      );
      if (stock === null || memberCums.length === 0) return null;
      return stock - median(memberCums);
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
    case "foreign_flow_ratio": {
      const flows = data.flows ?? [];
      const day = flows.find((f) => f.date === move.date)?.net;
      const after = flows.filter((f) => f.date > move.date).slice(0, n);
      if (!day || after.length < n || after.some((f) => f.net === null)) return null;
      return after.reduce((a, f) => a + f.net!, 0) / day;
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

export interface FalsifierPath {
  metric: FalsifierMetric;
  /** Session dates after the move, one per window day (only those already observed). */
  dates: string[];
  /** The metric after n sessions, n = 1..dates.length (null where not computable). */
  values: (number | null)[];
  /** Threshold line(s): one for > and <, two (±) for abs>. */
  thresholds: number[];
}

/**
 * The day-by-day path of a falsifier's metric, for charting it against its
 * threshold. Compound rules chart their first price-based component.
 */
export function falsifierPath(rule: FalsifierRule, data: PostMoveData): FalsifierPath | null {
  const simple = "all" in rule ? rule.all.find((r) => !("all" in r) && r.metric !== "avg_volume_ratio") ?? rule.all[0] : rule;
  if (!simple || "all" in simple) return null;
  const after = data.bars.filter((b) => b.date > data.move.date).slice(0, simple.window);
  const values = after.map((_, i) => metricValue(simple.metric, data, i + 1));
  return {
    metric: simple.metric,
    dates: after.map((b) => b.date),
    values,
    thresholds: simple.op === "abs>" ? [simple.value, -simple.value] : [simple.value],
  };
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

/**
 * Default falsifiers per hypothesis type, parameterized by the move itself.
 * Thresholds are what chance alone reaches 95% of the time over the window:
 * a bootstrap of the stock's own pre-move abnormal returns (fat tails and
 * all), falling back to 2 robust σ × √n when there isn't enough history.
 */
export function defaultFalsifiers({ move, decomposition }: Investigation, hypothesis: HypothesisResult): Falsifier[] {
  const dir = Math.sign(move.ret) || 1;
  const band = (n: 3 | 5) => move.drift?.[n];
  const drift = (n: 3 | 5) => band(n)?.abs ?? 2 * move.residualStd * Math.sqrt(n);
  const driftUp = (n: 3 | 5) => band(n)?.hi ?? drift(n);
  const driftDown = (n: 3 | 5) => band(n)?.lo ?? -drift(n);
  const stockDrift = (n: 5) => decomposition.stockSpecificDrift?.abs ?? 2 * decomposition.stockSpecificStd * Math.sqrt(n);
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

  switch (hypothesis.type) {
    case "market_beta":
      return [{
        hypothesisType: "market_beta",
        description: `The stock keeps moving on its own: beta-adjusted return beyond ±${pct(drift(5))} within 5 trading days, more than chance alone reaches 95% of the time.`,
        rule: { metric: "cum_abnormal_return", window: 5, op: "abs>", value: drift(5) },
      }];
    case "sector_rotation": {
      const gap = Math.max(0.03, stockDrift(5));
      return [{
        hypothesisType: "sector_rotation",
        description: `The stock decouples from its subsector: return gap vs peer median beyond ±${pct(gap)} within 5 trading days.`,
        rule: { metric: "spread_vs_peer_median", window: 5, op: "abs>", value: gap },
      }];
    }
    case "foreign_flow":
      return [{
        hypothesisType: "foreign_flow",
        description: "Foreigners reverse: over the next 5 sessions they undo more than half of the move-day flow.",
        rule: { metric: "foreign_flow_ratio", window: 5, op: "<", value: -0.5 },
      }];
    case "news":
      return [{
        hypothesisType: "news",
        description: "The market gives back more than half the move within 5 trading days, so the news did not stick.",
        rule: { metric: "retracement", window: 5, op: ">", value: 0.5 },
      }];
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
        description: `The move keeps going: beta-adjusted return extends another ${pct(Math.abs(dir > 0 ? driftUp(5) : driftDown(5)))} in the same direction within 5 trading days, more than chance alone reaches 95% of the time.`,
        rule: dir > 0
          ? { metric: "cum_abnormal_return", window: 5, op: ">", value: driftUp(5) }
          : { metric: "cum_abnormal_return", window: 5, op: "<", value: driftDown(5) },
      }];
    case "broker_concentration":
      return [{
        hypothesisType: "broker_concentration",
        description: "Activity returns to normal but the price keeps moving the same way, so it wasn't just a few brokers pushing it.",
        rule: {
          all: [
            { metric: "avg_volume_ratio", window: 3, op: "<", value: 1.2 },
            dir > 0
              ? { metric: "cum_abnormal_return", window: 3, op: ">", value: driftUp(3) }
              : { metric: "cum_abnormal_return", window: 3, op: "<", value: driftDown(3) },
          ],
        },
      }];
    case "exchange_action":
      return [{
        hypothesisType: "exchange_action",
        description: "The market gives back more than half the move within 5 trading days, so the post-suspension repricing didn't hold.",
        rule: { metric: "retracement", window: 5, op: ">", value: 0.5 },
      }];
    case "group_contagion": {
      const gap = Math.max(0.03, stockDrift(5));
      return [{
        hypothesisType: "group_contagion",
        description: `The stock decouples from its group: return gap vs the group median beyond ±${pct(gap)} within 5 trading days.`,
        rule: { metric: "spread_vs_group_median", window: 5, op: "abs>", value: gap },
      }];
    }
    case "liquidity":
      return [{
        hypothesisType: "liquidity",
        description: "Volume returns to normal but the price keeps moving in the same direction.",
        rule: {
          all: [
            { metric: "avg_volume_ratio", window: 3, op: "<", value: 1.2 },
            dir > 0
              ? { metric: "cum_abnormal_return", window: 3, op: ">", value: driftUp(3) }
              : { metric: "cum_abnormal_return", window: 3, op: "<", value: driftDown(3) },
          ],
        },
      }];
  }
}

/** Falsifiers for every hypothesis that is still standing. */
export function falsifiersFor(investigation: Investigation): Falsifier[] {
  return investigation.hypotheses
    .filter((h) => h.verdict !== "refuted" && h.verdict !== "untested" && h.verdict !== "not_needed")
    .flatMap((h) => defaultFalsifiers(investigation, h));
}
