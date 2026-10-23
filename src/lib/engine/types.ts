// Core domain types for the evidence engine. The engine is pure: it never
// fetches data and never calls an LLM. Everything it outputs is reproducible
// from its inputs.

export interface Bar {
  date: string; // YYYY-MM-DD (WIB trading date)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type MoveTrigger = "abnormal_return" | "volume_spike" | "gap";

export interface Move {
  ticker: string;
  date: string;
  ret: number; // close-to-close return on the move day
  marketRet: number; // index return on the same day
  beta: number; // estimated vs. the index over the lookback window
  abnormalRet: number; // ret - beta * marketRet
  residualStd: number; // std of daily abnormal returns over the lookback
  abnormalZ: number; // abnormalRet / residualStd
  volumeRatio: number; // volume / avg volume of the prior window
  volumeZ: number;
  gap: number; // open / prev close - 1
  triggers: MoveTrigger[];
}

export type HypothesisType =
  | "market_beta"
  | "sector_rotation"
  | "earnings"
  | "dividend"
  | "liquidity"
  | "noise";

export type Verdict = "supported" | "partial" | "weak" | "refuted" | "untested";

export interface Evidence {
  id: string; // stable within an investigation, e.g. "E3"
  kind: string; // machine-readable, e.g. "peer_median_excess"
  label: string; // human-readable
  value: number | string | null;
  source: string; // where the raw data came from, e.g. "sectors:daily/BBCA"
}

export interface CompanyEvent {
  type: "earnings_report" | "ex_dividend" | "corporate_action";
  date: string;
  dividendPerShare?: number;
  note?: string;
}

export interface InvestigationInput {
  ticker: string;
  move: Move;
  bars: Bar[]; // the stock, ascending by date
  marketBars: Bar[]; // the index (IHSG), ascending by date
  peers: Record<string, Bar[]>; // same-subsector companies
  // undefined = the data was not available, so event-based hypotheses are
  // "untested" rather than "refuted".
  events?: CompanyEvent[];
  // Which event types `events` actually covers. Omitted = all types. A type
  // that is not covered makes its hypothesis "untested".
  eventTypesCovered?: CompanyEvent["type"][];
  sources: {
    stock: string;
    market: string;
    peers: string;
    events?: string;
  };
}

export interface HypothesisResult {
  type: HypothesisType;
  verdict: Verdict;
  score: number; // 0..1, higher = better explains the move
  rationale: string;
  evidenceIds: string[];
}

export interface Investigation {
  ticker: string;
  move: Move;
  evidence: Evidence[];
  hypotheses: HypothesisResult[]; // ranked, best first
}
