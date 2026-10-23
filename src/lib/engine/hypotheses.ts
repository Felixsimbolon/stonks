import { decompose, volumeSignal } from "./decompose";
import { clamp01, dayDiff } from "./stats";
import type {
  CompanyEvent,
  Decomposition,
  Evidence,
  HypothesisResult,
  HypothesisType,
  Investigation,
  InvestigationInput,
  Verdict,
} from "./types";

// Every hypothesis is scored as the share of the move it accounts for, so the
// scores compete instead of all being "supported" at once:
//   market_beta + sector_rotation + (stock-specific part) = the whole move,
// and earnings / dividend / liquidity / noise compete for the stock-specific part.

/** Below this stock-specific share, stock-level explanations are not needed. */
export const NOT_NEEDED_BELOW = 0.15;

export function verdictFromScore(score: number): Verdict {
  if (score >= 0.5) return "supported";
  if (score >= 0.25) return "partial";
  if (score >= 0.1) return "weak";
  return "refuted";
}

class EvidenceBoard {
  readonly items: Evidence[] = [];

  add(e: Omit<Evidence, "id">): string {
    const id = `E${this.items.length + 1}`;
    this.items.push({ id, ...e });
    return id;
  }
}

interface Ctx {
  input: InvestigationInput;
  d: Decomposition;
  board: EvidenceBoard;
  ids: Record<"total" | "market" | "beta" | "marketPart" | "sectorPart" | "breadth" | "stockSpecific" | "z" | "volume", string>;
}

type Test = (ctx: Ctx) => HypothesisResult;

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;
const share = (x: number) => `${Math.round(x * 100)}%`;

function result(type: HypothesisType, score: number, rationale: string, evidenceIds: string[]): HypothesisResult {
  return { type, score, verdict: verdictFromScore(score), rationale, evidenceIds };
}

function untested(type: HypothesisType, rationale: string): HypothesisResult {
  return { type, score: 0, verdict: "untested", rationale, evidenceIds: [] };
}

/** Stock-level hypotheses only make sense when something stock-specific is left. */
function notNeeded(type: HypothesisType, { d, ids }: Ctx): HypothesisResult | null {
  if (d.shares.stockSpecific >= NOT_NEEDED_BELOW) return null;
  return {
    type,
    score: 0,
    verdict: "not_needed",
    rationale: `Market and sector account for ${share(1 - d.shares.stockSpecific)} of the move; nothing stock-specific left to explain.`,
    evidenceIds: [ids.stockSpecific],
  };
}

const covers = (input: InvestigationInput, type: CompanyEvent["type"]) =>
  input.events !== undefined && (input.eventTypesCovered?.includes(type) ?? true);

const marketBeta: Test = ({ input, d, ids }) =>
  result(
    "market_beta",
    d.shares.market,
    `IHSG ${pct(input.move.marketRet)} × β ${input.move.beta.toFixed(2)} = ${pct(d.market)}, ${share(d.shares.market)} of the ${pct(d.total)} move.`,
    [ids.total, ids.market, ids.beta, ids.marketPart],
  );

const sectorRotation: Test = ({ d, ids }) => {
  if (d.sector === null || d.breadth === null) {
    return untested("sector_rotation", `Only ${d.peerCount} peers have data on the move date; need at least 3.`);
  }
  const breadthFactor = 0.5 + 0.5 * clamp01((d.breadth - 0.5) / 0.4);
  return result(
    "sector_rotation",
    d.shares.sector * breadthFactor,
    `Peers moved ${pct(d.sector)} beyond their own beta (${share(d.shares.sector)} of the move); ${share(d.breadth)} of ${d.peerCount} peers moved the same way.`,
    [ids.sectorPart, ids.breadth],
  );
};

const earnings: Test = (ctx) => {
  const { input, d, board, ids } = ctx;
  if (!covers(input, "earnings_report")) return untested("earnings", "No earnings release dates available.");
  const skip = notNeeded("earnings", ctx);
  if (skip) return skip;

  const { move, events = [], sources } = input;
  const report = events.find(
    (e) => e.type === "earnings_report" && dayDiff(e.date, move.date) >= 0 && dayDiff(e.date, move.date) <= 3,
  );
  const id = board.add({
    kind: "earnings_in_window",
    label: "Earnings report within 3 days before the move",
    value: report?.date ?? "none",
    source: sources.events ?? "unknown",
  });
  if (!report) return result("earnings", 0, "No earnings report in the 3 days before the move.", [id]);

  const strength = 0.5 + 0.5 * clamp01((Math.abs(d.stockSpecificZ) - 1) / 2);
  return result(
    "earnings",
    d.shares.stockSpecific * strength,
    `Earnings report on ${report.date}, ${dayDiff(report.date, move.date)} day(s) before a ${d.stockSpecificZ.toFixed(1)}σ stock-specific move.`,
    [id, ids.stockSpecific, ids.z],
  );
};

const dividend: Test = (ctx) => {
  const { input, d, board, ids } = ctx;
  if (!covers(input, "ex_dividend")) return untested("dividend", "No dividend data available.");
  const skip = notNeeded("dividend", ctx);
  if (skip) return skip;

  const { move, events = [], bars, sources } = input;
  const src = sources.events ?? "unknown";
  const ex = events.find((e) => e.type === "ex_dividend" && e.date === move.date);
  const exId = board.add({ kind: "ex_dividend_on_date", label: "Ex-dividend on move date", value: ex ? "yes" : "no", source: src });
  if (!ex) return result("dividend", 0, "The move date is not an ex-dividend date.", [exId]);
  if (d.stockSpecific >= 0) {
    return result("dividend", 0, "Ex-dividend date, but the stock-specific part was not a drop.", [exId, ids.stockSpecific]);
  }
  if (ex.dividendPerShare === undefined) {
    return result("dividend", d.shares.stockSpecific * 0.5, "Ex-dividend date; dividend size unknown.", [exId, ids.stockSpecific]);
  }

  const idx = bars.findIndex((b) => b.date === move.date);
  const dividendYield = ex.dividendPerShare / bars[idx - 1].close;
  const yId = board.add({ kind: "dividend_yield", label: "Dividend / previous close", value: dividendYield, source: src });
  const consistency = 1 - clamp01(Math.abs(d.stockSpecific + dividendYield) / Math.max(dividendYield, 0.01));
  return result(
    "dividend",
    d.shares.stockSpecific * (0.3 + 0.7 * consistency),
    `Expected mechanical drop ≈ ${pct(-dividendYield)}; stock-specific part was ${pct(d.stockSpecific)}.`,
    [exId, yId, ids.stockSpecific],
  );
};

const liquidity: Test = (ctx) => {
  const skip = notNeeded("liquidity", ctx);
  if (skip) return skip;
  const { input, d, ids } = ctx;
  const vs =
    d.relativeVolume === null
      ? `${input.move.volumeRatio.toFixed(1)}× its 20-day average (no peer comparison)`
      : `${input.move.volumeRatio.toFixed(1)}× its average, ${d.relativeVolume.toFixed(1)}× what peers saw the same day`;
  return result(
    "liquidity",
    d.shares.stockSpecific * volumeSignal(d, input.move.volumeRatio),
    `Volume was ${vs}. Volume alone does not show who was buying or selling.`,
    [ids.volume, ids.stockSpecific],
  );
};

const noise: Test = (ctx) => {
  const skip = notNeeded("noise", ctx);
  if (skip) return skip;
  const { d, ids } = ctx;
  return result(
    "noise",
    d.shares.stockSpecific * clamp01((2.5 - Math.abs(d.stockSpecificZ)) / 1.5),
    `The stock-specific part is ${d.stockSpecificZ.toFixed(1)}σ of its normal daily variation.`,
    [ids.stockSpecific, ids.z],
  );
};

const TESTS: Test[] = [marketBeta, sectorRotation, earnings, dividend, liquidity, noise];

const RANK: Record<Verdict, number> = { supported: 0, partial: 0, weak: 0, refuted: 0, not_needed: 1, untested: 2 };

export function investigate(input: InvestigationInput): Investigation {
  const { move, sources } = input;
  const d = decompose(move, input.bars, input.marketBars, input.peers);
  const board = new EvidenceBoard();
  const ids: Ctx["ids"] = {
    total: board.add({ kind: "return", label: "Stock return", value: d.total, source: sources.stock }),
    market: board.add({ kind: "market_return", label: "IHSG return", value: move.marketRet, source: sources.market }),
    beta: board.add({ kind: "beta", label: "Beta vs IHSG (pre-move)", value: move.beta, source: sources.stock }),
    marketPart: board.add({ kind: "market_part", label: "Market part of the move", value: d.market, source: "engine" }),
    sectorPart: board.add({ kind: "sector_part", label: "Sector part (median beta-adjusted peer return)", value: d.sector, source: sources.peers }),
    breadth: board.add({ kind: "peer_breadth", label: "Peers moving the same way", value: d.breadth, source: sources.peers }),
    stockSpecific: board.add({ kind: "stock_specific_part", label: "Stock-specific part", value: d.stockSpecific, source: "engine" }),
    z: board.add({ kind: "stock_specific_z", label: "Stock-specific part in σ", value: d.stockSpecificZ, source: "engine" }),
    volume: board.add({ kind: "volume_ratio", label: "Volume vs 20-day average", value: move.volumeRatio, source: sources.stock }),
  };

  const hypotheses = TESTS.map((t) => t({ input, d, board, ids })).sort(
    (a, b) => RANK[a.verdict] - RANK[b.verdict] || b.score - a.score,
  );
  return { ticker: input.ticker, move, decomposition: d, evidence: board.items, hypotheses };
}
