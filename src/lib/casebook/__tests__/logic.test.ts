import { describe, expect, it } from "vitest";
import type { FalsifierEvaluation, HypothesisResult } from "@/lib/engine";
import {
  advance,
  brierScore,
  calibrationPoints,
  closingDate,
  closingMessage,
  headlineRecord,
  isResolved,
  outcomes,
  priorsFromTrackRecord,
  recordNote,
  reliabilityBins,
  trackRecord,
  type ClosedCase,
  type FalsifierState,
} from "../logic";

const h = (type: HypothesisResult["type"], verdict: HypothesisResult["verdict"]): HypothesisResult => ({
  type,
  verdict,
  score: 0.5,
  rationale: "",
  evidenceIds: [],
});

const f = (id: number, type: FalsifierState["hypothesisType"], extra: Partial<FalsifierState> = {}): FalsifierState => ({
  id,
  hypothesisType: type,
  description: "The stock decouples from its subsector.",
  window: 5,
  status: "pending",
  daysObserved: 0,
  triggeredOn: null,
  ...extra,
});

const evals = (entries: [number, FalsifierEvaluation][]) => new Map(entries);

describe("advance", () => {
  it("records a break on the trigger date", () => {
    const { next, events } = advance(
      [f(1, "sector_rotation")],
      evals([[1, { status: "triggered", daysObserved: 2, triggeredOn: "2026-10-19" }]]),
      "2026-10-23",
    );
    expect(next[0]).toMatchObject({ status: "triggered", triggeredOn: "2026-10-19", daysObserved: 2 });
    expect(events).toEqual([
      expect.objectContaining({ kind: "falsifier_broke", date: "2026-10-19", hypothesisType: "sector_rotation" }),
    ]);
  });

  it("records a hold dated at the latest session", () => {
    const { next, events } = advance(
      [f(1, "market_beta")],
      evals([[1, { status: "survived", daysObserved: 5 }]]),
      "2026-10-23",
    );
    expect(next[0].status).toBe("survived");
    expect(events[0]).toMatchObject({ kind: "falsifier_held", date: "2026-10-23" });
  });

  it("keeps watching pending falsifiers without events", () => {
    const { next, events } = advance([f(1, "noise")], evals([[1, { status: "pending", daysObserved: 3 }]]), "2026-10-23");
    expect(next[0]).toMatchObject({ status: "pending", daysObserved: 3 });
    expect(events).toEqual([]);
  });

  it("never re-evaluates a resolved falsifier", () => {
    const resolved = f(1, "market_beta", { status: "survived", daysObserved: 5 });
    const { next, events } = advance(
      [resolved],
      evals([[1, { status: "triggered", daysObserved: 6, triggeredOn: "2026-10-30" }]]),
      "2026-10-30",
    );
    expect(next[0]).toBe(resolved);
    expect(events).toEqual([]);
  });

  it("sorts events by market date", () => {
    const { events } = advance(
      [f(1, "market_beta"), f(2, "sector_rotation")],
      evals([
        [1, { status: "survived", daysObserved: 5 }],
        [2, { status: "triggered", daysObserved: 1, triggeredOn: "2026-10-17" }],
      ]),
      "2026-10-23",
    );
    expect(events.map((e) => e.date)).toEqual(["2026-10-17", "2026-10-23"]);
  });
});

describe("resolution and outcomes", () => {
  const hyps = [h("market_beta", "supported"), h("sector_rotation", "weak"), h("noise", "refuted")];

  it("is resolved only when nothing is pending", () => {
    expect(isResolved([f(1, "market_beta", { status: "survived" }), f(2, "noise")])).toBe(false);
    expect(isResolved([f(1, "market_beta", { status: "survived" }), f(2, "noise", { status: "triggered" })])).toBe(true);
  });

  it("maps falsifier states to per-hypothesis outcomes, ignoring refuted ones", () => {
    const o = outcomes(hyps, [
      f(1, "market_beta", { status: "survived" }),
      f(2, "sector_rotation", { status: "triggered", triggeredOn: "2026-10-19" }),
    ]);
    expect(o).toEqual({ market_beta: "held", sector_rotation: "broke" });
  });

  it("reports pending while a falsifier is still open", () => {
    expect(outcomes(hyps, [f(1, "market_beta")])).toEqual({ market_beta: "pending" });
  });

  it("closes on the latest resolution date", () => {
    const states = [
      f(1, "market_beta", { status: "survived" }),
      f(2, "sector_rotation", { status: "triggered", triggeredOn: "2026-10-19" }),
    ];
    expect(closingDate(states, "2026-10-23")).toBe("2026-10-23");
    expect(closingDate([states[1]], "2026-10-23")).toBe("2026-10-19");
  });

  it("summarizes the close", () => {
    expect(closingMessage({ market_beta: "held", sector_rotation: "broke" })).toBe(
      "Case closed — held: Market moved it; broke: Sector moved it.",
    );
    expect(closingMessage({})).toBe("Case closed — no explanation was standing.");
  });
});

describe("priors and calibration", () => {
  it("turns the track record into smoothed prior weights", () => {
    const rows = trackRecord([
      ...Array.from({ length: 8 }, () => ({ hypotheses: [h("market_beta", "supported")], outcomes: { market_beta: "held" as const } })),
      { hypotheses: [h("news", "supported")], outcomes: { news: "broke" as const } },
    ]);
    const priors = priorsFromTrackRecord(rows);
    expect(priors.market_beta!).toBeCloseTo((8 + 1) / (8 + 2) / 0.5);
    expect(priors.news!).toBeCloseTo(1 / 3 / 0.5);
    expect(priors.market_beta!).toBeGreaterThan(1);
    expect(priors.news!).toBeLessThan(1);
  });

  it("scores stated probabilities against outcomes", () => {
    const closed: ClosedCase[] = [
      { hypotheses: [{ ...h("news", "supported"), probability: 0.9 }], outcomes: { news: "held" } },
      { hypotheses: [{ ...h("news", "weak"), probability: 0.2 }], outcomes: { news: "broke" } },
      { hypotheses: [{ ...h("noise", "weak"), probability: 0.6 }], outcomes: { noise: "pending" } },
      { hypotheses: [h("market_beta", "supported")], outcomes: { market_beta: "held" } },
    ];
    const pts = calibrationPoints(closed);
    expect(pts).toEqual([
      { type: "news", p: 0.9, held: true },
      { type: "news", p: 0.2, held: false },
    ]);
    expect(brierScore(pts)).toBeCloseTo((0.01 + 0.04) / 2);
    expect(brierScore([])).toBeNull();
    const bins = reliabilityBins(pts, 5);
    expect(bins[4]).toMatchObject({ n: 1, heldRate: 1 });
    expect(bins[1]).toMatchObject({ n: 1, heldRate: 0 });
    expect(bins[2].n).toBe(0);
  });
});

describe("track record", () => {
  const closed = (verdict: HypothesisResult["verdict"], outcome: "held" | "broke"): ClosedCase => ({
    hypotheses: [h("market_beta", verdict)],
    outcomes: { market_beta: outcome },
  });

  it("tallies held and broke per type and verdict", () => {
    const rows = trackRecord([
      closed("supported", "held"),
      closed("supported", "held"),
      closed("supported", "broke"),
      closed("partial", "broke"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].total).toEqual({ filed: 4, held: 2, broke: 2 });
    expect(rows[0].byVerdict.supported).toEqual({ filed: 3, held: 2, broke: 1 });
    expect(rows[0].byVerdict.partial).toEqual({ filed: 1, held: 0, broke: 1 });
  });

  it("ignores hypotheses that were not standing or never resolved", () => {
    const rows = trackRecord([
      { hypotheses: [h("noise", "refuted"), h("news", "supported")], outcomes: { news: "pending" } },
    ]);
    expect(rows).toEqual([]);
  });

  it("computes the headline from supported calls only", () => {
    const rows = trackRecord([closed("supported", "held"), closed("partial", "broke")]);
    expect(headlineRecord(rows)).toEqual({ filed: 1, held: 1, broke: 0 });
  });

  it("flags small samples in the note", () => {
    const few = trackRecord([closed("supported", "held"), closed("supported", "broke")]);
    expect(recordNote(few[0])).toBe("Track record: held 1 of 2 closed cases — too few to judge.");
    const many = trackRecord(Array.from({ length: 6 }, (_, i) => closed("supported", i < 4 ? "held" : "broke")));
    expect(recordNote(many[0])).toBe("Track record: held in 4 of 6 closed cases (67%).");
    expect(recordNote(undefined)).toBeNull();
  });
});
