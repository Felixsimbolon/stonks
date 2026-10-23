import { clamp01, dailyReturns, median, ols, robustStd, volumeRatioAt } from "./stats";
import type { Bar, Decomposition, Move } from "./types";

export const MIN_PEERS = 3;
const LOOKBACK = 120;
const VOLUME_WINDOW = 20;

interface PeerModel {
  beta: number;
  returns: Map<string, number>;
  volumeRatio: number | null; // on the move date
}

function peerModel(bars: Bar[], market: Map<string, number>, date: string): PeerModel {
  const rets = dailyReturns(bars);
  const hist = rets.filter((r) => r.date < date && market.has(r.date)).slice(-LOOKBACK);
  // Too little history for a stable beta: assume the peer moves one-for-one with the index.
  const beta =
    hist.length >= 20
      ? ols(
          hist.map((r) => market.get(r.date)!),
          hist.map((r) => r.value),
        ).beta
      : 1;
  const idx = bars.findIndex((b) => b.date === date);
  return {
    beta,
    returns: new Map(rets.map((r) => [r.date, r.value])),
    volumeRatio: idx > 0 ? volumeRatioAt(bars, idx, VOLUME_WINDOW) : null,
  };
}

/** Median beta-adjusted peer return on a date, or null with fewer than MIN_PEERS peers. */
function sectorFactor(models: PeerModel[], market: Map<string, number>, date: string): number | null {
  const m = market.get(date);
  if (m === undefined) return null;
  const xs = models.flatMap((p) => {
    const r = p.returns.get(date);
    return r === undefined ? [] : [r - p.beta * m];
  });
  return xs.length >= MIN_PEERS ? median(xs) : null;
}

/**
 * Split the move into market, sector and stock-specific parts. The stock is
 * assumed to load one-for-one on its sector after removing its own beta.
 */
export function decompose(move: Move, bars: Bar[], marketBars: Bar[], peers: Record<string, Bar[]>): Decomposition {
  const market = new Map(dailyReturns(marketBars).map((r) => [r.date, r.value]));
  const models = Object.values(peers).map((p) => peerModel(p, market, move.date));

  const marketPart = move.beta * move.marketRet;
  const sector = sectorFactor(models, market, move.date);
  const stockSpecific = move.ret - marketPart - (sector ?? 0);

  // Volatility of the stock-specific part before the move. Falls back to the
  // market-model residual when peers lack history on enough days.
  const history = dailyReturns(bars)
    .filter((r) => r.date < move.date && market.has(r.date))
    .slice(-LOOKBACK)
    .flatMap((r) => {
      const s = sectorFactor(models, market, r.date);
      return s === null ? [] : [r.value - move.beta * market.get(r.date)! - s];
    });
  const stockSpecificStd = history.length >= 20 ? robustStd(history) : move.residualStd;

  const dir = Math.sign(move.ret) || 1;
  const pushes = [marketPart, sector ?? 0, stockSpecific].map((c) => Math.max(0, c * dir));
  const totalPush = pushes.reduce((a, b) => a + b, 0);
  const shares =
    totalPush > 0
      ? { market: pushes[0] / totalPush, sector: pushes[1] / totalPush, stockSpecific: pushes[2] / totalPush }
      : { market: 0, sector: 0, stockSpecific: 1 };

  const peerAbnormal = models.flatMap((p) => {
    const r = p.returns.get(move.date);
    return r === undefined ? [] : [r - p.beta * move.marketRet];
  });
  const breadth =
    peerAbnormal.length >= MIN_PEERS ? peerAbnormal.filter((x) => Math.sign(x) === dir).length / peerAbnormal.length : null;

  const peerVolumes = models.flatMap((p) => (p.volumeRatio === null ? [] : [p.volumeRatio]));
  const relativeVolume = peerVolumes.length >= MIN_PEERS ? move.volumeRatio / median(peerVolumes) : null;

  return {
    total: move.ret,
    market: marketPart,
    sector,
    stockSpecific,
    shares,
    peerCount: peerAbnormal.length,
    breadth,
    stockSpecificStd,
    stockSpecificZ: stockSpecificStd > 0 ? stockSpecific / stockSpecificStd : 0,
    relativeVolume,
  };
}

/**
 * How strongly the volume evidence points at flow (0..1). Volume must be high
 * both against the stock's own average and against what peers saw that day:
 * a quiet day for peers should not make ordinary volume look special.
 */
export function volumeSignal(d: Decomposition, volumeRatio: number): number {
  const elevated = Math.min(volumeRatio, d.relativeVolume ?? volumeRatio);
  return clamp01((elevated - 1) / 2);
}
