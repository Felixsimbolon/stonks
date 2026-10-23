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

export function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Calendar-day difference b - a for YYYY-MM-DD strings. */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}
