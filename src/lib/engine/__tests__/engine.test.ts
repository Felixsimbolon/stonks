import { describe, expect, it } from "vitest";
import {
  detectMoves,
  evaluateFalsifier,
  falsifiersFor,
  investigate,
  measureMove,
  median,
  ols,
  std,
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

  it("returns null without enough history", () => {
    const bars = sc.stock({ seed: 1 });
    expect(measureMove("TEST", bars, sc.market, sc.dates[5])).toBeNull();
  });
});

describe("hypotheses", () => {
  const sc = scenario();
  const moveDate = sc.dates[150];

  function input(stockShock: number, peerShock: number, extra: Partial<InvestigationInput> = {}): InvestigationInput {
    const bars = sc.stock({ seed: 1, shocks: { [moveDate]: stockShock }, volumeShocks: { [moveDate]: 3 } });
    const peers = Object.fromEntries(
      [2, 3, 4, 5, 6].map((s) => [`P${s}`, sc.stock({ seed: s, shocks: { [moveDate]: peerShock } })]),
    );
    return {
      ticker: "TEST",
      move: measureMove("TEST", bars, sc.market, moveDate)!,
      bars,
      marketBars: sc.market,
      peers,
      events: [],
      sources,
      ...extra,
    };
  }

  it("ranks sector rotation first when peers moved together", () => {
    const inv = investigate(input(-0.06, -0.06));
    expect(inv.hypotheses[0].type).toBe("sector_rotation");
    expect(inv.hypotheses.find((h) => h.type === "noise")!.verdict).toBe("refuted");
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
    const f = falsifiersFor(move, inv.hypotheses).find((x) => x.hypothesisType === "sector_rotation")!;
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
