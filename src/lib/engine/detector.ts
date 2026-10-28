import {
  align,
  bootstrapDrift,
  dailyReturns,
  heavyTailP,
  heavyTailUpperP,
  median,
  ols,
  robustStd,
  volumeRatioAt,
  zscore,
} from "./stats";
import type { Bar, Move, MoveTrigger } from "./types";

// Flagging an unusual session is a hypothesis test run every day, so the
// threshold is set by the false-alarm rate we accept, not by a round σ.
// Each session gets two p-values under a heavy-tailed (t4) model:
//   - abnormal return (beta-adjusted, robust σ), two-sided;
//   - volume (log ratio to its 20-session average vs its own history), upper tail.
// A session is flagged when either passes α/2 (Bonferroni over the two tests),
// with α chosen so a quiet stock produces about 0.5 false flags per 60 sessions.

export interface DetectorOptions {
  lookback: number; // trading days used to estimate beta and residual volatility
  volumeWindow: number; // trading days used for the volume baseline
  /** Per-session false-alarm rate across both tests. */
  alphaPerSession: number;
  /** Gaps this large are noted as a trigger when the session is flagged anyway. */
  gapThreshold: number;
}

export const DEFAULT_DETECTOR_OPTIONS: DetectorOptions = {
  lookback: 120,
  volumeWindow: 20,
  alphaPerSession: 0.5 / 60,
  gapThreshold: 0.03,
};

/** The original fixed rules (|z| ≥ 2, volume ≥ 2.5×, gap ≥ 3%), kept for the backtest's before/after. */
export function legacyFlag(m: Move): boolean {
  return Math.abs(m.abnormalZ) >= 2 || m.volumeRatio >= 2.5 || Math.abs(m.gap) >= 0.03;
}

/**
 * Possibly capped by an IDX auto-rejection limit or cut short by a trading
 * halt: no intraday range, or a large move that opened and closed at the
 * day's extreme. The true move may be larger than the close shows.
 */
export function isCensored(bar: Bar, ret: number): boolean {
  if (bar.high === bar.low) return true;
  if (Math.abs(ret) < 0.06 || bar.open !== bar.close) return false;
  return ret < 0 ? bar.close === bar.low : bar.close === bar.high;
}

/** Log volume ratio (vs the prior window's average) for each session in [from, to). */
function volumeLogRatios(bars: Bar[], from: number, to: number, window: number): number[] {
  const out: number[] = [];
  for (let i = Math.max(from, 1); i < to; i++) {
    const r = volumeRatioAt(bars, i, window);
    if (r !== null && r > 0) out.push(Math.log(r));
  }
  return out;
}

/**
 * Measure the move of `ticker` on `date` against the market. Returns null when
 * there is not enough history before the date to estimate a baseline.
 * Only data strictly before `date` is used for the baseline (no look-ahead).
 */
export function measureMove(
  ticker: string,
  bars: Bar[],
  marketBars: Bar[],
  date: string,
  opts: DetectorOptions = DEFAULT_DETECTOR_OPTIONS,
): Move | null {
  const idx = bars.findIndex((b) => b.date === date);
  if (idx < 1) return null;

  const pairs = align(dailyReturns(bars), dailyReturns(marketBars));
  const dayPair = pairs.find((p) => p.date === date);
  if (!dayPair) return null;

  const history = pairs.filter((p) => p.date < date).slice(-opts.lookback);
  if (history.length < 20) return null;

  const fit = ols(
    history.map((p) => p.b),
    history.map((p) => p.a),
  );
  const residualStd = robustStd(fit.residuals);
  const abnormalRet = dayPair.a - fit.beta * dayPair.b;
  const abnormalZ = residualStd > 0 ? abnormalRet / residualStd : 0;
  const pAbnormal = heavyTailP(abnormalZ);

  const priorVolumes = bars.slice(Math.max(0, idx - opts.volumeWindow), idx).map((b) => b.volume);
  const volumeRatio = volumeRatioAt(bars, idx, opts.volumeWindow) ?? 0;
  const volumeZ = zscore(bars[idx].volume, priorVolumes);
  const volHistory = volumeLogRatios(bars, idx - opts.lookback, idx, opts.volumeWindow);
  const volSd = robustStd(volHistory);
  const pVolume =
    volumeRatio > 0 && volHistory.length >= 20 && volSd > 0
      ? heavyTailUpperP((Math.log(volumeRatio) - median(volHistory)) / volSd)
      : 1;

  const gap = bars[idx].open / bars[idx - 1].close - 1;

  const half = opts.alphaPerSession / 2;
  const triggers: MoveTrigger[] = [];
  if (pAbnormal <= half) triggers.push("abnormal_return");
  if (pVolume <= half) triggers.push("volume_spike");
  if (triggers.length && Math.abs(gap) >= opts.gapThreshold) triggers.push("gap");

  const d3 = bootstrapDrift(fit.residuals, 3);
  const d5 = bootstrapDrift(fit.residuals, 5);

  return {
    ticker,
    date,
    ret: dayPair.a,
    marketRet: dayPair.b,
    beta: fit.beta,
    abnormalRet,
    residualStd,
    abnormalZ,
    volumeRatio,
    volumeZ,
    gap,
    triggers,
    pAbnormal,
    pVolume,
    pValue: Math.min(1, 2 * Math.min(pAbnormal, pVolume)),
    censored: isCensored(bars[idx], dayPair.a),
    drift: d3 && d5 ? { 3: d3, 5: d5 } : undefined,
  };
}

/** Scan the last `days` trading days and return the moves that tripped a trigger. */
export function detectMoves(
  ticker: string,
  bars: Bar[],
  marketBars: Bar[],
  days = 5,
  opts: DetectorOptions = DEFAULT_DETECTOR_OPTIONS,
): Move[] {
  return bars
    .slice(-days)
    .map((b) => measureMove(ticker, bars, marketBars, b.date, opts))
    .filter((m): m is Move => m !== null && m.triggers.length > 0);
}
