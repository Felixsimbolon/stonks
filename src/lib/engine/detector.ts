import { align, dailyReturns, ols, robustStd, volumeRatioAt, zscore } from "./stats";
import type { Bar, Move, MoveTrigger } from "./types";

export interface DetectorOptions {
  lookback: number; // trading days used to estimate beta and residual volatility
  volumeWindow: number; // trading days used for the volume baseline
  abnormalZThreshold: number;
  volumeRatioThreshold: number;
  gapThreshold: number;
}

export const DEFAULT_DETECTOR_OPTIONS: DetectorOptions = {
  lookback: 120,
  volumeWindow: 20,
  abnormalZThreshold: 2,
  volumeRatioThreshold: 2.5,
  gapThreshold: 0.03,
};

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

  const priorVolumes = bars.slice(Math.max(0, idx - opts.volumeWindow), idx).map((b) => b.volume);
  const volumeRatio = volumeRatioAt(bars, idx, opts.volumeWindow) ?? 0;
  const volumeZ = zscore(bars[idx].volume, priorVolumes);

  const gap = bars[idx].open / bars[idx - 1].close - 1;

  const triggers: MoveTrigger[] = [];
  if (Math.abs(abnormalZ) >= opts.abnormalZThreshold) triggers.push("abnormal_return");
  if (volumeRatio >= opts.volumeRatioThreshold) triggers.push("volume_spike");
  if (Math.abs(gap) >= opts.gapThreshold) triggers.push("gap");

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
