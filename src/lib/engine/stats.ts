import type { Bar } from "./types";

export interface DatedValue {
  date: string;
  value: number;
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation. */
export function std(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Standard deviation estimated from the median absolute deviation. Unlike
 * std(), a few crash days in the sample barely move it, so thresholds stay
 * meaningful right after a volatile stretch.
 */
export function robustStd(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = median(xs);
  const mad = median(xs.map((x) => Math.abs(x - m)));
  return mad > 0 ? 1.4826 * mad : std(xs);
}

/** Volume on bars[idx] relative to the mean of the `window` bars before it. */
export function volumeRatioAt(bars: Bar[], idx: number, window: number): number | null {
  if (idx < 1) return null;
  const prior = bars.slice(Math.max(0, idx - window), idx).map((b) => b.volume);
  const avg = mean(prior);
  return avg > 0 ? bars[idx].volume / avg : null;
}

export function zscore(x: number, sample: number[]): number {
  const sd = std(sample);
  if (!Number.isFinite(sd) || sd === 0) return 0;
  return (x - mean(sample)) / sd;
}

/** Simple close-to-close returns. The first bar has no return and is dropped. */
export function dailyReturns(bars: Bar[]): DatedValue[] {
  const out: DatedValue[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close;
    if (prev > 0) out.push({ date: bars[i].date, value: bars[i].close / prev - 1 });
  }
  return out;
}

/** Inner-join two dated series on date. */
export function align(a: DatedValue[], b: DatedValue[]): { date: string; a: number; b: number }[] {
  const bByDate = new Map(b.map((x) => [x.date, x.value]));
  const out: { date: string; a: number; b: number }[] = [];
  for (const x of a) {
    const y = bByDate.get(x.date);
    if (y !== undefined) out.push({ date: x.date, a: x.value, b: y });
  }
  return out;
}

/** Ordinary least squares y = alpha + beta * x. */
export function ols(x: number[], y: number[]): { alpha: number; beta: number; residuals: number[] } {
  const mx = mean(x);
  const my = mean(y);
  let cov = 0;
  let varX = 0;
  for (let i = 0; i < x.length; i++) {
    cov += (x[i] - mx) * (y[i] - my);
    varX += (x[i] - mx) ** 2;
  }
  const beta = varX === 0 ? 0 : cov / varX;
  const alpha = my - beta * mx;
  const residuals = y.map((yi, i) => yi - alpha - beta * x[i]);
  return { alpha, beta, residuals };
}

// ── Heavy-tailed significance ────────────────────────────────────────────
// Daily stock returns have fat tails, so a normal model overstates how rare a
// big day is. We score robust z-scores against a Student t with 4 degrees of
// freedom, rescaled to unit variance (t4 has variance 2).

/** CDF of Student's t with ν = 4 (closed form). */
export function studentT4Cdf(t: number): number {
  const k = 1 + (t * t) / 4;
  return 0.5 + (3 / 8) * (t / Math.sqrt(k)) * (1 - (t * t) / (12 * k));
}

/** Two-sided tail probability of a unit-variance z under the t(4) model. */
export function heavyTailP(z: number): number {
  return Math.min(1, 2 * (1 - studentT4Cdf(Math.abs(z) * Math.SQRT2)));
}

/** One-sided (upper) tail probability of a unit-variance z under the t(4) model. */
export function heavyTailUpperP(z: number): number {
  return Math.min(1, 1 - studentT4Cdf(z * Math.SQRT2));
}

// ── Bootstrap ────────────────────────────────────────────────────────────

/** Deterministic PRNG (LCG) so bootstrap results are reproducible. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export interface DriftBand {
  lo: number; // 5th percentile of the n-day sum
  hi: number; // 95th percentile
  abs: number; // 95th percentile of |sum|
}

/**
 * How far n days of these residuals add up to by chance alone: resample the
 * history with replacement, sum n draws, and read off the 5%/95% bounds.
 */
export function bootstrapDrift(residuals: number[], n: number, draws = 2000, seed = 7): DriftBand | null {
  if (residuals.length < 20) return null;
  const rand = seededRandom(seed + n);
  const sums: number[] = [];
  const abs: number[] = [];
  for (let i = 0; i < draws; i++) {
    let s = 0;
    for (let k = 0; k < n; k++) s += residuals[Math.floor(rand() * residuals.length)];
    sums.push(s);
    abs.push(Math.abs(s));
  }
  sums.sort((a, b) => a - b);
  abs.sort((a, b) => a - b);
  return { lo: quantile(sums, 0.05), hi: quantile(sums, 0.95), abs: quantile(abs, 0.95) };
}

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Calendar-day difference b - a for YYYY-MM-DD strings. */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}
