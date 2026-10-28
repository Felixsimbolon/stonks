import { describe, expect, it } from "vitest";
import { scenario } from "../../engine/__tests__/fixtures";
import { runBacktest } from "../backtest";

describe("backtest", () => {
  const sc = scenario(400, 21);
  const shockDates = [200, 260, 330].map((i) => sc.dates[i]);
  const bars = sc.stock({
    seed: 4,
    shocks: Object.fromEntries(shockDates.map((d) => [d, -0.07])),
    volumeShocks: Object.fromEntries(shockDates.map((d) => [d, 4])),
  });
  const peers = Object.fromEntries([5, 6, 7].map((s) => [`P${s}`, sc.stock({ seed: s })]));
  const report = runBacktest([{ ticker: "TEST", bars, market: sc.market, peers }], "2026-10-28T00:00:00Z");

  it("replays every session it can and finds the planted moves", () => {
    const t = report.tickers[0];
    expect(t.sessions).toBeGreaterThan(300);
    expect(t.flagsNew).toBeGreaterThanOrEqual(3);
    // the new rules flag far fewer sessions than the old fixed thresholds
    expect(t.per60New).toBeLessThan(t.per60Old);
  });

  it("runs the placebo on quiet sessions with a false-break rate near the target", () => {
    expect(report.placebo.sessions).toBeGreaterThan(30);
    expect(report.placebo.breakRateNew!).toBeLessThan(0.15);
  });

  it("tallies falsifier outcomes and post-move drift", () => {
    expect(report.falsifiers.length).toBeGreaterThan(0);
    expect(report.drift.down.n).toBeGreaterThan(0);
    expect(report.generatedAt).toBe("2026-10-28T00:00:00Z");
  });
});
