import { clamp01, dailyReturns, dayDiff, median } from "./stats";
import type {
  CompanyEvent,
  Evidence,
  HypothesisResult,
  HypothesisType,
  Investigation,
  InvestigationInput,
  Verdict,
} from "./types";

export function verdictFromScore(score: number): Verdict {
  if (score >= 0.7) return "supported";
  if (score >= 0.45) return "partial";
  if (score >= 0.2) return "weak";
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

type Test = (input: InvestigationInput, board: EvidenceBoard) => HypothesisResult;

const pct = (x: number) => `${(x * 100).toFixed(2)}%`;

function result(
  type: HypothesisType,
  score: number,
  rationale: string,
  evidenceIds: string[],
): HypothesisResult {
  return { type, score, verdict: verdictFromScore(score), rationale, evidenceIds };
}

function untested(type: HypothesisType, rationale: string): HypothesisResult {
  return { type, score: 0, verdict: "untested", rationale, evidenceIds: [] };
}

const marketBeta: Test = ({ move, sources }, board) => {
  const explained = move.beta * move.marketRet;
  const ids = [
    board.add({ kind: "market_return", label: "IHSG return", value: move.marketRet, source: sources.market }),
    board.add({ kind: "beta", label: "Beta vs IHSG", value: move.beta, source: sources.stock }),
    board.add({ kind: "beta_explained_return", label: "Return explained by beta", value: explained, source: "engine" }),
  ];
  const sameSign = Math.sign(explained) === Math.sign(move.ret);
  const share = sameSign && move.ret !== 0 ? clamp01(explained / move.ret) : 0;
  return result(
    "market_beta",
    share,
    `Beta × market return explains ${pct(explained)} of a ${pct(move.ret)} move (${Math.round(share * 100)}%).`,
    ids,
  );
};

const sectorRotation: Test = ({ move, peers, sources }, board) => {
  const excesses: number[] = [];
  for (const bars of Object.values(peers)) {
    const r = dailyReturns(bars).find((x) => x.date === move.date);
    if (r) excesses.push(r.value - move.marketRet);
  }
  if (excesses.length < 3) {
    return untested("sector_rotation", `Only ${excesses.length} peers have data for ${move.date}; need at least 3.`);
  }
  const stockExcess = move.ret - move.marketRet;
  const peerMedian = median(excesses);
  const breadth = excesses.filter((x) => Math.sign(x) === Math.sign(stockExcess)).length / excesses.length;
  const share = stockExcess !== 0 ? clamp01(peerMedian / stockExcess) : 0;
  const score = 0.5 * share + 0.5 * clamp01((breadth - 0.5) / 0.4);
  const ids = [
    board.add({ kind: "peer_median_excess", label: "Peer median return vs IHSG", value: peerMedian, source: sources.peers }),
    board.add({ kind: "peer_breadth", label: "Peers moving the same direction", value: breadth, source: sources.peers }),
    board.add({ kind: "stock_excess", label: "Stock return vs IHSG", value: stockExcess, source: sources.stock }),
  ];
  return result(
    "sector_rotation",
    score,
    `Peer median moved ${pct(peerMedian)} vs IHSG (stock ${pct(stockExcess)}); ${Math.round(breadth * 100)}% of ${excesses.length} peers moved the same way.`,
    ids,
  );
};

const covers = (input: InvestigationInput, type: CompanyEvent["type"]) =>
  input.events !== undefined && (input.eventTypesCovered?.includes(type) ?? true);

const earnings: Test = (input, board) => {
  const { move, events = [], sources } = input;
  if (!covers(input, "earnings_report")) return untested("earnings", "No earnings release dates available.");
  const report = events.find((e) => e.type === "earnings_report" && dayDiff(e.date, move.date) >= 0 && dayDiff(e.date, move.date) <= 3);
  if (!report) {
    const id = board.add({ kind: "earnings_in_window", label: "Earnings report within 3 days before the move", value: "none", source: sources.events ?? "unknown" });
    return result("earnings", 0, "No earnings report in the 3 days before the move.", [id]);
  }
  const id = board.add({ kind: "earnings_in_window", label: "Earnings report date", value: report.date, source: sources.events ?? "unknown" });
  const score = 0.5 + 0.5 * clamp01((Math.abs(move.abnormalZ) - 1) / 2);
  return result(
    "earnings",
    score,
    `Earnings report on ${report.date}, ${dayDiff(report.date, move.date)} day(s) before a ${move.abnormalZ.toFixed(1)}σ abnormal move.`,
    [id],
  );
};

const dividend: Test = (input, board) => {
  const { move, events = [], bars, sources } = input;
  if (!covers(input, "ex_dividend")) return untested("dividend", "No dividend data available.");
  const ex = events.find((e) => e.type === "ex_dividend" && e.date === move.date);
  if (!ex) {
    const id = board.add({ kind: "ex_dividend_on_date", label: "Ex-dividend on move date", value: "no", source: sources.events ?? "unknown" });
    return result("dividend", 0, "The move date is not an ex-dividend date.", [id]);
  }
  const ids = [board.add({ kind: "ex_dividend_on_date", label: "Ex-dividend on move date", value: "yes", source: sources.events ?? "unknown" })];
  if (move.ret >= 0) return result("dividend", 0.15, "Ex-dividend date, but the stock rose instead of dropping.", ids);
  if (ex.dividendPerShare === undefined) return result("dividend", 0.5, "Ex-dividend date; dividend size unknown.", ids);

  const idx = bars.findIndex((b) => b.date === move.date);
  const prevClose = bars[idx - 1]?.close ?? NaN;
  const dividendYield = ex.dividendPerShare / prevClose;
  ids.push(board.add({ kind: "dividend_yield", label: "Dividend / previous close", value: dividendYield, source: sources.events ?? "unknown" }));
  const consistency = 1 - clamp01(Math.abs(move.ret + dividendYield) / Math.max(dividendYield, 0.01));
  return result(
    "dividend",
    0.3 + 0.7 * consistency,
    `Expected mechanical drop ≈ ${pct(-dividendYield)}, actual ${pct(move.ret)}.`,
    ids,
  );
};

const liquidity: Test = ({ move, sources }, board) => {
  const ids = [
    board.add({ kind: "volume_ratio", label: "Volume vs 20-day average", value: move.volumeRatio, source: sources.stock }),
  ];
  return result(
    "liquidity",
    clamp01((move.volumeRatio - 1) / 3),
    `Volume was ${move.volumeRatio.toFixed(1)}× its 20-day average.`,
    ids,
  );
};

const noise: Test = ({ move, sources }, board) => {
  const ids = [
    board.add({ kind: "abnormal_return", label: "Abnormal return (beta-adjusted)", value: move.abnormalRet, source: sources.stock }),
    board.add({ kind: "abnormal_z", label: "Abnormal return in σ", value: move.abnormalZ, source: "engine" }),
  ];
  return result(
    "noise",
    clamp01((2.5 - Math.abs(move.abnormalZ)) / 1.5),
    `Abnormal return is ${move.abnormalZ.toFixed(1)}σ of normal daily variation.`,
    ids,
  );
};

const TESTS: Test[] = [marketBeta, sectorRotation, earnings, dividend, liquidity, noise];

export function investigate(input: InvestigationInput): Investigation {
  const board = new EvidenceBoard();
  const hypotheses = TESTS.map((t) => t(input, board)).sort((a, b) => {
    // untested always sorts last
    if ((a.verdict === "untested") !== (b.verdict === "untested")) return a.verdict === "untested" ? 1 : -1;
    return b.score - a.score;
  });
  return { ticker: input.ticker, move: input.move, evidence: board.items, hypotheses };
}
