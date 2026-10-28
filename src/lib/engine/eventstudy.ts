import { dailyReturns, heavyTailP } from "./stats";
import type { Bar, Move } from "./types";

// An event study around a flagged move, the way empirical finance measures
// how a price reacts to an event: abnormal return (AR) per session relative
// to the move day, cumulated over standard windows (CAR), each with a
// t-statistic against the stock's own pre-move volatility.
//   [−5,−1]  run-up before the move (leakage, anticipation)
//   [−1,+1]  the event itself, with a day either side
//   [0,+1]   the move and the next session (a capped day often continues)
//   [+1,+5]  drift after the move (continuation vs reversal)

export interface AbnormalReturn {
  k: number; // session offset from the move day (0 = the move)
  date: string;
  ar: number;
}

export interface CarWindow {
  label: string;
  from: number;
  to: number;
  car: number;
  t: number;
  p: number;
  /** All sessions in the window are available. */
  complete: boolean;
  sessions: number;
}

export interface EventStudy {
  ars: AbnormalReturn[];
  windows: CarWindow[];
}

const WINDOWS: [string, number, number][] = [
  ["run-up", -5, -1],
  ["event", -1, 1],
  ["move + next session", 0, 1],
  ["after the move", 1, 5],
];

export function eventStudy(move: Move, bars: Bar[], marketBars: Bar[], span = 5): EventStudy {
  const stock = dailyReturns(bars);
  const market = new Map(dailyReturns(marketBars).map((r) => [r.date, r.value]));
  const i0 = stock.findIndex((r) => r.date === move.date);
  const ars: AbnormalReturn[] = [];
  if (i0 >= 0) {
    for (let k = -span; k <= span; k++) {
      const r = stock[i0 + k];
      const m = r ? market.get(r.date) : undefined;
      if (r && m !== undefined) ars.push({ k, date: r.date, ar: r.value - move.beta * m });
    }
  }
  const sigma = move.residualStd;
  const windows = WINDOWS.map(([label, from, to]) => {
    const inWin = ars.filter((a) => a.k >= from && a.k <= to);
    const car = inWin.reduce((s, a) => s + a.ar, 0);
    const t = sigma > 0 && inWin.length ? car / (sigma * Math.sqrt(inWin.length)) : 0;
    return { label, from, to, car, t, p: heavyTailP(t), complete: inWin.length === to - from + 1, sessions: inWin.length };
  });
  return { ars, windows };
}
