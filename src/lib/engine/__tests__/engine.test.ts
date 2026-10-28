import { describe, expect, it } from "vitest";
import {
  bootstrapDrift,
  detectMoves,
  evaluateFalsifier,
  eventStudy,
  falsifierPath,
  falsifiersFor,
  heavyTailP,
  investigate,
  isCensored,
  legacyFlag,
  measureMove,
  median,
  ols,
  robustStd,
  std,
  studentT4Cdf,
  type InvestigationInput,
} from "..";
import { scenario } from "./fixtures";

const sources = { stock: "test:stock", market: "test:market", peers: "test:peers", events: "test:events" };

describe("stats", () => {
  it("computes median, std and ols", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(std([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
    const fit = ols([1, 2, 3, 4], [3, 5, 7, 9]);
    expect(fit.beta).toBeCloseTo(2);
    expect(fit.alpha).toBeCloseTo(1);
  });

  it("computes heavy-tailed p-values", () => {
    expect(studentT4Cdf(0)).toBeCloseTo(0.5);
    expect(studentT4Cdf(1e6)).toBeCloseTo(1, 5);
    expect(studentT4Cdf(-2)).toBeCloseTo(1 - studentT4Cdf(2), 10);
    // t4 critical value 2.776 at 97.5%
    expect(studentT4Cdf(2.776)).toBeCloseTo(0.975, 3);
    expect(heavyTailP(0)).toBeCloseTo(1);
    expect(heavyTailP(4)).toBeLessThan(heavyTailP(3));
    // fatter tails than the normal: a 3σ day is less rare than 0.27%
    expect(heavyTailP(3)).toBeGreaterThan(0.0027);
  });

  it("bootstraps drift bands deterministically", () => {
    const xs = Array.from({ length: 100 }, (_, i) => Math.sin(i) * 0.01);
    const a = bootstrapDrift(xs, 5)!;
    expect(bootstrapDrift(xs, 5)).toEqual(a);
    expect(a.lo).toBeLessThan(0);
    expect(a.hi).toBeGreaterThan(0);
    expect(a.abs).toBeGreaterThanOrEqual(Math.max(-a.lo, a.hi) * 0.9);
    expect(bootstrapDrift(xs.slice(0, 10), 5)).toBeNull();
  });

  it("robustStd ignores a few extreme days", () => {
    const calm = [0.01, -0.01, 0.005, -0.005, 0.012, -0.008, 0.003, -0.011, 0.007, -0.002];
    const withCrash = [...calm, -0.15];
    expect(std(withCrash) / std(calm)).toBeGreaterThan(3);
    expect(robustStd(withCrash) / robustStd(calm)).toBeLessThan(1.5);
  });
});

describe("detector", () => {
  const sc = scenario();
  const moveDate = sc.dates[150];

  it("flags an idiosyncratic shock with a volume spike", () => {
    const bars = sc.stock({ seed: 1, shocks: { [moveDate]: -0.07 }, volumeShocks: { [moveDate]: 4 } });
    const move = measureMove("TEST", bars, sc.market, moveDate)!;
    expect(move.triggers).toContain("abnormal_return");
    expect(move.triggers).toContain("volume_spike");
    expect(move.abnormalZ).toBeLessThan(-2);
    expect(move.beta).toBeGreaterThan(0.6);
    expect(move.beta).toBeLessThan(1.4);
  });

  it("does not flag an ordinary day", () => {
    const bars = sc.stock({ seed: 1 });
    expect(detectMoves("TEST", bars, sc.market, 1)).toHaveLength(0);
  });

  it("attaches p-values and bootstrap drift bands to a move", () => {
    const bars = sc.stock({ seed: 1, shocks: { [moveDate]: -0.07 } });
    const move = measureMove("TEST", bars, sc.market, moveDate)!;
    expect(move.pAbnormal!).toBeLessThan(0.001);
    expect(move.pValue!).toBeLessThanOrEqual(1);
    expect(move.drift![5].abs).toBeGreaterThan(move.drift![3].abs);
  });

  it("keeps false flags near the target on pure noise", () => {
    const long = scenario(420, 9);
    const bars = long.stock({ seed: 3 });
    // 300 quiet sessions; the target is ~0.5 per 60, i.e. ~2.5 expected
    const flags = detectMoves("TEST", bars, long.market, 300);
    expect(flags.length).toBeLessThanOrEqual(8);
    // the old fixed rules flag far more on the same noise
    const measured = bars.slice(-300).map((b) => measureMove("TEST", bars, long.market, b.date)!).filter(Boolean);
    expect(measured.filter(legacyFlag).length).toBeGreaterThan(flags.length);
  });

  it("marks sessions that look capped by a limit or a halt", () => {
    expect(isCensored({ date: "d", open: 5175, high: 5175, low: 5175, close: 5175, volume: 1 }, -0.148)).toBe(true);
    expect(isCensored({ date: "d", open: 100, high: 100, low: 92, close: 92, volume: 1 }, -0.08)).toBe(false);
    expect(isCensored({ date: "d", open: 92, high: 100, low: 92, close: 92, volume: 1 }, -0.08)).toBe(true);
    expect(isCensored({ date: "d", open: 101, high: 102, low: 99, close: 100, volume: 1 }, 0.01)).toBe(false);
  });

  it("returns null without enough history", () => {
    const bars = sc.stock({ seed: 1 });
    expect(measureMove("TEST", bars, sc.market, sc.dates[5])).toBeNull();
  });
});

describe("hypotheses", () => {
  const sc = scenario();
  const moveDate = sc.dates[150];

  function input(
    stockShock: number,
    peerShock: number,
    extra: Partial<InvestigationInput> = {},
    { stockVolume = 3, peerVolume = 1, s = sc } = {},
  ): InvestigationInput {
    const bars = s.stock({ seed: 1, shocks: { [moveDate]: stockShock }, volumeShocks: { [moveDate]: stockVolume } });
    const peers = Object.fromEntries(
      [2, 3, 4, 5, 6].map((seed) => [
        `P${seed}`,
        s.stock({ seed, shocks: { [moveDate]: peerShock }, volumeShocks: { [moveDate]: peerVolume } }),
      ]),
    );
    return {
      ticker: "TEST",
      move: measureMove("TEST", bars, s.market, moveDate)!,
      bars,
      marketBars: s.market,
      peers,
      events: [],
      sources,
      ...extra,
    };
  }

  const verdictOf = (inv: ReturnType<typeof investigate>, type: string) =>
    inv.hypotheses.find((h) => h.type === type)!.verdict;

  it("splits the move into parts that add up", () => {
    const { decomposition: d } = investigate(input(-0.06, -0.03));
    expect(d.market + d.sector! + d.stockSpecific).toBeCloseTo(d.total, 10);
    expect(d.shares.market + d.shares.sector + d.shares.stockSpecific).toBeCloseTo(1, 10);
  });

  it("ranks sector rotation first when peers moved together", () => {
    const inv = investigate(input(-0.06, -0.06));
    expect(inv.hypotheses[0].type).toBe("sector_rotation");
    expect(inv.hypotheses[0].verdict).toBe("supported");
    expect(verdictOf(inv, "noise")).toBe("not_needed");
  });

  it("lets only the market explanation win on a market-wide crash", () => {
    const crash = scenario(160, 42, { [moveDate]: -0.08 });
    const inv = investigate(input(0, 0, {}, { s: crash, peerVolume: 3 }));
    expect(inv.hypotheses[0].type).toBe("market_beta");
    expect(inv.hypotheses.filter((h) => h.verdict === "supported")).toHaveLength(1);
    expect(verdictOf(inv, "liquidity")).toBe("not_needed");
  });

  it("does not credit volume when peers had the same spike", () => {
    const sameSpike = investigate(input(-0.06, 0, {}, { stockVolume: 4, peerVolume: 4 }));
    const ownSpike = investigate(input(-0.06, 0, {}, { stockVolume: 4, peerVolume: 1 }));
    expect(sameSpike.decomposition.relativeVolume!).toBeLessThan(1.5);
    expect(verdictOf(sameSpike, "liquidity")).toBe("refuted");
    expect(ownSpike.hypotheses.find((h) => h.type === "liquidity")!.score).toBeGreaterThan(0.5);
  });

  it("refutes sector rotation when only the stock moved", () => {
    const inv = investigate(input(-0.06, 0));
    expect(inv.hypotheses.find((h) => h.type === "sector_rotation")!.verdict).toBe("refuted");
  });

  it("supports earnings when a report precedes the move", () => {
    const inv = investigate(input(0.07, 0, { events: [{ type: "earnings_report", date: sc.dates[149] }] }));
    expect(inv.hypotheses.find((h) => h.type === "earnings")!.verdict).toBe("supported");
  });

  it("marks event hypotheses untested when event data is missing", () => {
    const inv = investigate(input(-0.06, 0, { events: undefined }));
    expect(inv.hypotheses.find((h) => h.type === "earnings")!.verdict).toBe("untested");
    expect(inv.hypotheses.at(-1)!.verdict).toBe("untested");
  });

  function flowsAround(netOnMove: number) {
    return sc.dates.slice(80, 156).map((date, i) => ({
      date,
      net: date === moveDate ? netOnMove : (i % 2 ? 1 : -1) * 1e9,
      buy: 0,
      sell: 0,
      foreignShare: 0.4,
    }));
  }

  it("credits foreign flow when foreigners sold hard into a stock-specific drop", () => {
    const inv = investigate(input(-0.06, 0, { flows: flowsAround(-20e9), news: [] }));
    expect(verdictOf(inv, "foreign_flow")).toBe("supported");
    expect(verdictOf(inv, "news")).toBe("refuted");
  });

  it("does not credit foreign flow that went against the move", () => {
    const inv = investigate(input(-0.06, 0, { flows: flowsAround(20e9) }));
    expect(verdictOf(inv, "foreign_flow")).toBe("refuted");
  });

  it("marks flow and news untested when not fetched", () => {
    const inv = investigate(input(-0.06, 0));
    expect(verdictOf(inv, "foreign_flow")).toBe("untested");
    expect(verdictOf(inv, "news")).toBe("untested");
  });

  it("finds news on the move day", () => {
    const news = [{ timestamp: `${moveDate}T10:00:00`, title: "Big news", url: "https://x", tags: ["bearish"] }];
    const inv = investigate(input(-0.06, 0, { news }));
    expect(verdictOf(inv, "news")).toBe("supported");
  });

  // ── surveillance-desk explanations ──
  function brokerDays(concentratedSellOnMove: boolean) {
    const days = sc.dates.slice(141, 151).map((date, k) => {
      const onMove = date === moveDate;
      const rows = Array.from({ length: 10 }, (_, i) => {
        const big = onMove && concentratedSellOnMove && i < 3;
        const sell = big ? 50e9 : 5e9 + ((i + k) % 4) * 0.4e9;
        const buy = 5e9 + ((i * 3 + k) % 5) * 0.3e9;
        return { broker: `B${i}`, buyValue: buy, sellValue: sell, netValue: buy - sell };
      });
      return { date, rows };
    });
    return days;
  }

  it("credits concentrated selling by a few brokers on a stock-specific drop", () => {
    const inv = investigate(input(-0.06, 0, { brokers: brokerDays(true) }));
    expect(verdictOf(inv, "broker_concentration")).toBe("supported");
    expect(inv.evidence.find((e) => e.kind === "broker_top")!.value).toContain("B0");
  });

  it("refutes broker concentration when activity is spread as usual", () => {
    const inv = investigate(input(-0.06, 0, { brokers: brokerDays(false) }));
    expect(verdictOf(inv, "broker_concentration")).toBe("refuted");
  });

  it("reads a suspension just before the move as a cause and one just after as corroboration", () => {
    const before = investigate(input(-0.06, 0, { suspensions: [{ date: sc.dates[146], reason: "Cumulative price drop", url: null }] }));
    const after = investigate(input(-0.06, 0, { suspensions: [{ date: sc.dates[151], reason: "Cumulative price drop", url: null }] }));
    const none = investigate(input(-0.06, 0, { suspensions: [] }));
    const score = (inv: ReturnType<typeof investigate>) => inv.hypotheses.find((h) => h.type === "exchange_action")!.score;
    expect(score(before)).toBeGreaterThan(score(after));
    expect(score(after)).toBeGreaterThan(0);
    expect(verdictOf(none, "exchange_action")).toBe("refuted");
  });

  it("credits the conglomerate group when its other members fell too", () => {
    const members = Object.fromEntries([11, 12, 13].map((seed) => [`G${seed}`, sc.stock({ seed, shocks: { [moveDate]: -0.06 } })]));
    const inv = investigate(input(-0.06, 0, { groups: [{ name: "Test Group", members }] }));
    expect(verdictOf(inv, "group_contagion")).toBe("supported");
  });

  it("refutes the group when members didn't move, and when there is no group", () => {
    const members = Object.fromEntries([11, 12, 13].map((seed) => [`G${seed}`, sc.stock({ seed })]));
    expect(verdictOf(investigate(input(-0.06, 0, { groups: [{ name: "Test Group", members }] })), "group_contagion")).toBe("refuted");
    expect(verdictOf(investigate(input(-0.06, 0, { groups: [] })), "group_contagion")).toBe("refuted");
  });

  it("marks the new explanations untested when their data wasn't fetched", () => {
    const inv = investigate(input(-0.06, 0));
    for (const t of ["broker_concentration", "exchange_action", "group_contagion"]) expect(verdictOf(inv, t)).toBe("untested");
  });

  it("cites evidence that exists on the board", () => {
    const inv = investigate(input(-0.06, -0.06));
    const ids = new Set(inv.evidence.map((e) => e.id));
    for (const h of inv.hypotheses) for (const id of h.evidenceIds) expect(ids.has(id)).toBe(true);
  });
});

describe("falsifiers", () => {
  const sc = scenario();
  const moveDate = sc.dates[150];
  const peers = Object.fromEntries([2, 3, 4, 5].map((s) => [`P${s}`, sc.stock({ seed: s, shocks: { [moveDate]: -0.05 } })]));

  it("triggers when the stock decouples from peers after the move", () => {
    const after = Object.fromEntries(sc.dates.slice(151, 154).map((d) => [d, -0.03]));
    const bars = sc.stock({ seed: 1, shocks: { [moveDate]: -0.05, ...after } });
    const move = measureMove("TEST", bars, sc.market, moveDate)!;
    const inv = investigate({ ticker: "TEST", move, bars, marketBars: sc.market, peers, events: [], sources });
    const f = falsifiersFor(inv).find((x) => x.hypothesisType === "sector_rotation")!;
    const ev = evaluateFalsifier(f.rule, { move, bars, marketBars: sc.market, peers });
    expect(ev.status).toBe("triggered");
  });

  it("is pending while the window is still open", () => {
    const bars = sc.stock({ seed: 1, shocks: { [moveDate]: -0.05 } });
    const move = measureMove("TEST", bars, sc.market, moveDate)!;
    const cut = bars.slice(0, 153); // only 2 days after the move
    const ev = evaluateFalsifier(
      { metric: "retracement", window: 5, op: ">", value: 10 },
      { move, bars: cut, marketBars: sc.market, peers },
    );
    expect(ev).toEqual({ status: "pending", daysObserved: 2 });
  });

  it("charts a falsifier's metric day by day against its threshold", () => {
    const bars = sc.stock({ seed: 1, shocks: { [moveDate]: -0.05 } });
    const move = measureMove("TEST", bars, sc.market, moveDate)!;
    const path = falsifierPath(
      { metric: "retracement", window: 5, op: ">", value: 0.5 },
      { move, bars: bars.slice(0, 154), marketBars: sc.market, peers },
    )!;
    expect(path.dates).toEqual(sc.dates.slice(151, 154));
    expect(path.values).toHaveLength(3);
    expect(path.thresholds).toEqual([0.5]);
    const abs = falsifierPath({ metric: "cum_abnormal_return", window: 5, op: "abs>", value: 0.04 }, { move, bars, marketBars: sc.market, peers })!;
    expect(abs.thresholds).toEqual([0.04, -0.04]);
  });

  it("uses bootstrap bands for falsifier thresholds when the move has them", () => {
    const bars = sc.stock({ seed: 1, shocks: { [moveDate]: -0.05 } });
    const move = measureMove("TEST", bars, sc.market, moveDate)!;
    const inv = investigate({ ticker: "TEST", move, bars, marketBars: sc.market, peers, events: [], sources });
    const f = falsifiersFor(inv).find((x) => x.hypothesisType === "market_beta");
    if (f && !("all" in f.rule)) expect(f.rule.value).toBeCloseTo(move.drift![5].abs, 10);
  });

  it("measures abnormal returns and CARs around the move", () => {
    const after = Object.fromEntries(sc.dates.slice(151, 156).map((d) => [d, -0.01]));
    const bars = sc.stock({ seed: 1, shocks: { [moveDate]: -0.06, ...after } });
    const move = measureMove("TEST", bars, sc.market, moveDate)!;
    const es = eventStudy(move, bars, sc.market);
    expect(es.ars.map((a) => a.k)).toEqual([-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5]);
    const ev = es.windows.find((w) => w.label === "event")!;
    expect(ev.complete).toBe(true);
    expect(ev.car).toBeLessThan(-0.04);
    expect(ev.p).toBeLessThan(0.05);
    const drift = es.windows.find((w) => w.label === "after the move")!;
    expect(drift.car).toBeLessThan(0);
    // a window past the available data is marked incomplete
    const cut = eventStudy(move, bars.slice(0, 153), sc.market);
    expect(cut.windows.find((w) => w.label === "after the move")!.complete).toBe(false);
  });

  it("survives when nothing happens for the full window", () => {
    const bars = sc.stock({ seed: 1, shocks: { [moveDate]: -0.05 } });
    const move = measureMove("TEST", bars, sc.market, moveDate)!;
    const ev = evaluateFalsifier(
      { metric: "retracement", window: 5, op: ">", value: 10 },
      { move, bars, marketBars: sc.market, peers },
    );
    expect(ev.status).toBe("survived");
  });
});
