import {
  brierScore,
  isResolved,
  outcomes,
  reliabilityBins,
  type CalibrationPoint,
  type FalsifierState,
  type ReliabilityBin,
} from "@/lib/casebook/logic";
import {
  eventStudy,
  evaluateFalsifier,
  falsifiersFor,
  investigate,
  legacyFlag,
  measureMove,
  windowOf,
  type Bar,
  type CompanyEvent,
  type FalsifierRule,
  type HypothesisType,
  type Move,
  type PostMoveData,
} from "@/lib/engine";

// The outside judge. Replays the engine over stored history, one session at
// a time, using only data before each session for the baseline (the same
// no-look-ahead rule as live), then checks what happened next. It never
// grades itself: the outcomes are later prices, and the placebo test runs the
// same falsifiers on quiet sessions, where nothing should break.

export interface TickerHistory {
  ticker: string;
  bars: Bar[];
  market: Bar[];
  peers: Record<string, Bar[]>;
  events?: CompanyEvent[];
}

export interface BacktestReport {
  generatedAt: string;
  tickers: {
    ticker: string;
    sessions: number;
    from: string | null;
    to: string | null;
    flagsNew: number;
    flagsOld: number;
    per60New: number;
    per60Old: number;
  }[];
  /** Falsifiers placed on quiet sessions: how often they "break" by chance. */
  placebo: { sessions: number; breakRateNew: number | null; breakRateLegacy: number | null; target: number };
  /** Real flagged moves: how often each kind of explanation's falsifier broke. */
  falsifiers: { type: HypothesisType; standing: number; held: number; broke: number }[];
  calibration: { points: number; brier: number | null; bins: ReliabilityBin[] };
  /** After a flagged move, did the stock keep going or give some back? CAR over sessions +1..+5. */
  drift: {
    up: { n: number; meanCar: number | null; continued: number | null };
    down: { n: number; meanCar: number | null; continued: number | null };
  };
  notes: string[];
}

const POST = 5; // sessions after a move needed to resolve its falsifiers
const PLACEBO_EVERY = 5; // use every 5th quiet session as a placebo

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null);

/** The market-beta falsifier's rule with the old 2σ√n threshold, for the placebo comparison. */
function legacyMarketRule(move: Move): FalsifierRule {
  return { metric: "cum_abnormal_return", window: 5, op: "abs>", value: 2 * move.residualStd * Math.sqrt(5) };
}

function newMarketRule(move: Move): FalsifierRule {
  return { metric: "cum_abnormal_return", window: 5, op: "abs>", value: move.drift?.[5]?.abs ?? 2 * move.residualStd * Math.sqrt(5) };
}

export function runBacktest(histories: TickerHistory[], generatedAt = new Date().toISOString()): BacktestReport {
  const tickers: BacktestReport["tickers"] = [];
  const falsifierTally = new Map<HypothesisType, { standing: number; held: number; broke: number }>();
  const points: CalibrationPoint[] = [];
  let placeboN = 0;
  let placeboNewBreaks = 0;
  let placeboLegacyBreaks = 0;
  const driftUp: number[] = [];
  const driftDown: number[] = [];

  for (const h of histories) {
    const { bars, market, peers } = h;
    let sessions = 0;
    let flagsNew = 0;
    let flagsOld = 0;
    let quiet = 0;

    // Leave POST sessions at the end so every falsifier window can resolve.
    for (let i = 1; i < bars.length - POST; i++) {
      const move = measureMove(h.ticker, bars, market, bars[i].date);
      if (!move) continue;
      sessions++;
      if (legacyFlag(move)) flagsOld++;
      const post: PostMoveData = { move, bars, marketBars: market, peers };

      if (move.triggers.length === 0) {
        // Placebo: a quiet session, so the "market moved it" falsifier should rarely break.
        if (quiet++ % PLACEBO_EVERY === 0) {
          placeboN++;
          if (evaluateFalsifier(newMarketRule(move), post).status === "triggered") placeboNewBreaks++;
          if (evaluateFalsifier(legacyMarketRule(move), post).status === "triggered") placeboLegacyBreaks++;
        }
        continue;
      }

      flagsNew++;
      const inv = investigate({
        ticker: h.ticker,
        move,
        bars,
        marketBars: market,
        peers,
        events: h.events,
        eventTypesCovered: h.events ? ["ex_dividend"] : undefined,
        sources: { stock: "backtest", market: "backtest", peers: "backtest" },
      });

      // Resolve each falsifier with the sessions that followed.
      const states: FalsifierState[] = falsifiersFor(inv).map((f, id) => {
        const ev = evaluateFalsifier(f.rule, post);
        return {
          id,
          hypothesisType: f.hypothesisType,
          description: f.description,
          window: windowOf(f.rule),
          status: ev.status,
          daysObserved: ev.daysObserved,
          triggeredOn: ev.triggeredOn ?? null,
        };
      });
      if (!isResolved(states)) continue;
      const o = outcomes(inv.hypotheses, states);
      for (const hyp of inv.hypotheses) {
        const res = o[hyp.type];
        if (res !== "held" && res !== "broke") continue;
        const t = falsifierTally.get(hyp.type) ?? { standing: 0, held: 0, broke: 0 };
        t.standing++;
        t[res]++;
        falsifierTally.set(hyp.type, t);
        if (hyp.probability !== undefined) points.push({ type: hyp.type, p: hyp.probability, held: res === "held" });
      }

      const after = eventStudy(move, bars, market).windows.find((w) => w.label === "after the move");
      if (after?.complete) (move.ret >= 0 ? driftUp : driftDown).push(after.car);
    }

    tickers.push({
      ticker: h.ticker,
      sessions,
      from: bars[0]?.date ?? null,
      to: bars.at(-1)?.date ?? null,
      flagsNew,
      flagsOld,
      per60New: sessions ? (flagsNew / sessions) * 60 : 0,
      per60Old: sessions ? (flagsOld / sessions) * 60 : 0,
    });
  }

  const continued = (xs: number[], sign: 1 | -1) => (xs.length ? xs.filter((x) => Math.sign(x) === sign).length / xs.length : null);
  const totalSessions = tickers.reduce((a, t) => a + t.sessions, 0);
  const notes: string[] = [];
  if (totalSessions < 300) notes.push(`Only ${totalSessions} sessions could be tested; backfill more history for firmer numbers.`);
  if (points.length < 30) notes.push(`Only ${points.length} calibration points; the Brier score and bins are indicative at best.`);
  notes.push("Historical moves are tested without foreign flow, news, broker or suspension data, which Sectors only provides on request per move.");

  return {
    generatedAt,
    tickers,
    placebo: {
      sessions: placeboN,
      breakRateNew: placeboN ? placeboNewBreaks / placeboN : null,
      breakRateLegacy: placeboN ? placeboLegacyBreaks / placeboN : null,
      target: 0.05,
    },
    falsifiers: [...falsifierTally.entries()].map(([type, t]) => ({ type, ...t })).sort((a, b) => b.standing - a.standing),
    calibration: { points: points.length, brier: brierScore(points), bins: reliabilityBins(points) },
    drift: {
      up: { n: driftUp.length, meanCar: mean(driftUp), continued: continued(driftUp, 1) },
      down: { n: driftDown.length, meanCar: mean(driftDown), continued: continued(driftDown, -1) },
    },
    notes,
  };
}
