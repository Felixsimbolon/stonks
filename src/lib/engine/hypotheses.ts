import { decompose, volumeSignal } from "./decompose";
import { clamp01, dailyReturns, dayDiff, median, robustStd } from "./stats";
import type {
  BrokerDay,
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
const idr = (x: number) => `${x < 0 ? "−" : ""}IDR ${(Math.abs(x) / 1e9).toFixed(1)}B`;

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

/** Foreign investors as the stock-specific driver: net flow far outside its usual range, in the move's direction. */
const foreignFlow: Test = (ctx) => {
  const { input, d, board, ids } = ctx;
  if (!input.flows) return untested("foreign_flow", "Foreign flow not fetched.");
  const skip = notNeeded("foreign_flow", ctx);
  if (skip) return skip;

  const { move, flows, sources } = input;
  const src = sources.flows ?? "unknown";
  const day = flows.find((f) => f.date === move.date);
  if (!day || day.net === null) return untested("foreign_flow", "Sectors has no foreign split for the move date.");
  const prior = flows.flatMap((f) => (f.date < move.date && f.net !== null ? [f.net] : [])).slice(-60);
  if (prior.length < 10) return untested("foreign_flow", "Not enough foreign flow history before the move.");

  const sd = robustStd(prior);
  const z = sd > 0 ? (day.net - median(prior)) / sd : 0;
  const dir = Math.sign(d.stockSpecific) || 1;
  const aligned = Math.sign(z) === dir;
  const ev = [
    board.add({ kind: "foreign_net", label: "Net foreign flow on the move day", value: day.net, source: src }),
    board.add({ kind: "foreign_net_z", label: "Net foreign flow vs its usual range", value: z, source: "engine" }),
    ids.stockSpecific,
  ];
  const side = day.net >= 0 ? "buyers" : "sellers";
  const rationale = aligned
    ? `Foreigners were net ${side} of ${idr(day.net)}, ${Math.abs(z).toFixed(1)}σ beyond their usual flow, in the direction of the move.`
    : Math.abs(z) < 1
      ? `Foreign flow (${idr(day.net)}) was within its usual range.`
      : `Foreign flow (${idr(day.net)}) went against the move.`;
  return result("foreign_flow", aligned ? d.shares.stockSpecific * clamp01((Math.abs(z) - 1) / 2) : 0, rationale, ev);
};

/** A news catalyst: articles tagged with the ticker on the move day or the day before. */
const news: Test = (ctx) => {
  const { input, d, board, ids } = ctx;
  if (!input.news) return untested("news", "News not fetched.");
  const skip = notNeeded("news", ctx);
  if (skip) return skip;

  const { move, sources } = input;
  const src = sources.news ?? "unknown";
  const around = input.news.filter((n) => {
    const days = dayDiff(n.timestamp.slice(0, 10), move.date);
    return days >= 0 && days <= 1;
  });
  const countId = board.add({ kind: "news_count", label: "Articles on the move day or the day before", value: around.length, source: src });
  if (around.length === 0) return result("news", 0, "No articles tagged with the ticker on the move day or the day before.", [countId]);

  // Sectors tags some articles bullish/bearish; use them only as a tone hint.
  const dir = Math.sign(d.stockSpecific) || 1;
  const tagged = (word: string) => around.filter((n) => n.tags.some((t) => t.toLowerCase().includes(word)));
  const withMove = tagged(dir > 0 ? "bull" : "bear");
  const againstMove = tagged(dir > 0 ? "bear" : "bull");
  const tone = Math.sign(withMove.length - againstMove.length);
  const lead = withMove[0] ?? around[0];
  const headlineId = board.add({ kind: "news_headline", label: "Headline", value: lead.title, source: lead.url });

  const toneText = tone > 0 ? " Tagged in the direction of the move." : tone < 0 ? " Tagged against the direction of the move." : "";
  return result(
    "news",
    d.shares.stockSpecific * (tone > 0 ? 0.8 : tone === 0 ? 0.5 : 0.2),
    `${around.length} article${around.length === 1 ? "" : "s"} around the move, e.g. “${lead.title}”.${toneText} Timestamps can't tell a catalyst from coverage of the move itself.`,
    [countId, headlineId, ids.stockSpecific],
  );
};

// ── Surveillance-desk explanations (exchange surveillance, regulator, network) ──

/** Share of one side's value (buy or sell) taken by its top 3 brokers on a day. */
export function topShare(rows: BrokerDay["rows"], side: "buy" | "sell", n = 3): number | null {
  const vals = rows.map((r) => (side === "buy" ? r.buyValue : r.sellValue)).filter((v) => v > 0).sort((a, b) => b - a);
  const total = vals.reduce((a, v) => a + v, 0);
  return total > 0 ? vals.slice(0, n).reduce((a, v) => a + v, 0) / total : null;
}

/**
 * A few brokers drove it (the exchange surveillance view): on the move day,
 * the side that pushed the price (buyers on an up move, sellers on a down
 * move) was far more concentrated in its top 3 brokers than on recent sessions,
 * and the biggest broker's net position points the same way.
 */
const brokerConcentration: Test = (ctx) => {
  const { input, d, board, ids } = ctx;
  if (!input.brokers) return untested("broker_concentration", "Broker activity not fetched.");
  const skip = notNeeded("broker_concentration", ctx);
  if (skip) return skip;

  const { move, brokers, sources } = input;
  const src = sources.brokers ?? "unknown";
  const day = brokers.find((b) => b.date === move.date);
  if (!day || day.rows.length === 0) return untested("broker_concentration", "Sectors has no broker rows for the move date.");
  const dir = Math.sign(d.stockSpecific) || 1;
  const side = dir > 0 ? "buy" : "sell";
  const today = topShare(day.rows, side);
  const prior = brokers
    .filter((b) => b.date < move.date)
    .map((b) => topShare(b.rows, side))
    .filter((x): x is number => x !== null);
  if (today === null || prior.length < 4) return untested("broker_concentration", "Not enough broker history before the move.");

  const base = median(prior);
  const sd = robustStd(prior) || 0.05;
  const z = (today - base) / sd;
  const top = [...day.rows].sort((a, b) => dir * (b.netValue - a.netValue)).slice(0, 3);
  const lead = top[0];
  const leadAligned = Math.sign(lead.netValue) === dir;
  const ev = [
    board.add({ kind: "broker_top3_share", label: `Top-3 brokers' share of ${side} value on the move day`, value: today, source: src }),
    board.add({ kind: "broker_top3_base", label: `Usual top-3 ${side} share (prior sessions)`, value: base, source: src }),
    board.add({ kind: "broker_conc_z", label: "Concentration vs its usual range", value: z, source: "engine" }),
    board.add({
      kind: "broker_top",
      label: `Biggest net ${dir > 0 ? "buyers" : "sellers"}`,
      value: top.map((r) => `${r.broker} ${idr(r.netValue)}`).join(", "),
      source: src,
    }),
    ids.stockSpecific,
  ];
  const strength = leadAligned ? clamp01((z - 1) / 2) : 0;
  const rationale =
    z < 1
      ? `${side === "buy" ? "Buying" : "Selling"} was spread as usual: the top 3 brokers took ${share(today)} of ${side} value vs ${share(base)} normally.`
      : !leadAligned
        ? `${side === "buy" ? "Buying" : "Selling"} was concentrated (${share(today)} in the top 3), but the biggest broker's net position went against the move.`
        : `${side === "buy" ? "Buying" : "Selling"} was unusually concentrated: the top 3 brokers took ${share(today)} of ${side} value vs ${share(base)} normally (${z.toFixed(1)}σ), led by ${lead.broker} at ${idr(lead.netValue)} net.`;
  return result("broker_concentration", d.shares.stockSpecific * strength, rationale, ev);
};

/**
 * The exchange acted (the regulator's view): a suspension shortly before the
 * move (trading resumed and the price caught up), or one right after it (the
 * exchange flagged the move as unusual; that corroborates, but doesn't cause).
 */
const exchangeAction: Test = (ctx) => {
  const { input, d, board, ids } = ctx;
  if (!input.suspensions) return untested("exchange_action", "IDX suspension notices not fetched.");
  const skip = notNeeded("exchange_action", ctx);
  if (skip) return skip;

  const { move, suspensions, sources } = input;
  const src = sources.suspensions ?? "unknown";
  const before = suspensions.find((s) => dayDiff(s.date, move.date) >= 1 && dayDiff(s.date, move.date) <= 10);
  const after = suspensions.find((s) => dayDiff(move.date, s.date) >= 0 && dayDiff(move.date, s.date) <= 3);
  if (!before && !after) {
    const id = board.add({ kind: "suspension", label: "IDX suspension within 10 days before or 3 after", value: "none", source: src });
    return result("exchange_action", 0, "No IDX suspension in the 10 days before or 3 days after the move.", [id]);
  }
  const s = (before ?? after)!;
  const id = board.add({ kind: "suspension", label: `IDX suspension (${s.date})`, value: s.reason, source: s.url ?? src });
  if (before) {
    return result(
      "exchange_action",
      d.shares.stockSpecific * 0.8,
      `IDX suspended trading on ${s.date} (“${s.reason}”); the move came as trading resumed and the price caught up.`,
      [id, ids.stockSpecific],
    );
  }
  return result(
    "exchange_action",
    d.shares.stockSpecific * 0.35,
    `IDX suspended the stock on ${s.date} (“${s.reason}”), right after the move: the exchange itself flagged it as unusual. That corroborates a stock-specific move but doesn't say what caused it.`,
    [id, ids.stockSpecific],
  );
};

/**
 * Its conglomerate group moved together (the network view): other listed
 * companies of the same group, outside its subsector, moved the same way that
 * day beyond the market. Common in IDX, where group news and group-level flows
 * move affiliates together.
 */
const groupContagion: Test = (ctx) => {
  const { input, d, board, ids } = ctx;
  if (!input.groups) return untested("group_contagion", "Conglomerate group data not fetched.");
  const skip = notNeeded("group_contagion", ctx);
  if (skip) return skip;

  const { move, groups, sources } = input;
  const src = sources.groups ?? "unknown";
  if (groups.length === 0) {
    const id = board.add({ kind: "group", label: "Conglomerate group", value: "none on record", source: src });
    return result("group_contagion", 0, "No listed conglomerate group on record for this stock.", [id]);
  }

  const dir = Math.sign(d.stockSpecific) || 1;
  const measured = groups.flatMap((g) => {
    const excess = Object.values(g.members).flatMap((bars) => {
      const r = dailyReturns(bars).find((x) => x.date === move.date);
      return r ? [r.value - move.marketRet] : [];
    });
    if (excess.length < 2) return [];
    const med = median(excess);
    const breadth = excess.filter((x) => Math.sign(x) === dir).length / excess.length;
    const portion = Math.sign(med) === dir && d.stockSpecific !== 0 ? clamp01(med / d.stockSpecific) : 0;
    const score = d.shares.stockSpecific * portion * (0.5 + 0.5 * clamp01((breadth - 0.5) / 0.4));
    return [{ g, med, breadth, n: excess.length, score }];
  });
  if (measured.length === 0) return untested("group_contagion", `Fewer than 2 group members (${groups.map((g) => g.name).join(", ")}) have data on ${move.date}.`);

  const best = measured.reduce((a, b) => (b.score > a.score ? b : a));
  const ev = [
    board.add({ kind: "group", label: "Conglomerate group", value: best.g.name, source: src }),
    board.add({ kind: "group_median_excess", label: `${best.g.name} members' median return vs IHSG`, value: best.med, source: src }),
    board.add({ kind: "group_breadth", label: `${best.g.name} members moving the same way`, value: best.breadth, source: src }),
    ids.stockSpecific,
  ];
  return result(
    "group_contagion",
    best.score,
    `Other ${best.g.name} companies outside its subsector moved ${pct(best.med)} vs IHSG that day; ${share(best.breadth)} of ${best.n} moved the same way.`,
    ev,
  );
};

const TESTS: Test[] = [
  marketBeta,
  sectorRotation,
  earnings,
  dividend,
  liquidity,
  foreignFlow,
  news,
  brokerConcentration,
  exchangeAction,
  groupContagion,
  noise,
];

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
