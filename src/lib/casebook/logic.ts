import type { FalsifierEvaluation, FalsifierStatus, HypothesisResult, HypothesisType, Verdict } from "@/lib/engine";

// Pure case-file logic: how a filed case advances as later sessions arrive,
// when it closes, and what the closed cases say about the engine's record.
// No database, no network — see store.ts for persistence.

/** Verdicts that make a claim and get falsifiers (mirrors engine falsifiersFor). */
export const STANDING: Verdict[] = ["supported", "partial", "weak"];
export type StandingVerdict = "supported" | "partial" | "weak";

export const isStanding = (h: Pick<HypothesisResult, "verdict">) => STANDING.includes(h.verdict);

export interface FalsifierState {
  id: number;
  hypothesisType: HypothesisType;
  description: string;
  window: number;
  status: FalsifierStatus;
  daysObserved: number;
  triggeredOn: string | null;
}

export type CaseEventKind = "move" | "falsifier_broke" | "falsifier_held" | "closed" | "refiled";

export interface CaseEvent {
  date: string; // market date
  kind: CaseEventKind;
  hypothesisType: HypothesisType | null;
  message: string;
}

export type Outcome = "held" | "broke" | "pending";

const LABEL: Record<HypothesisType, string> = {
  market_beta: "Market moved it",
  sector_rotation: "Sector moved it",
  earnings: "Earnings news",
  dividend: "Ex-dividend drop",
  liquidity: "Unusual trading volume",
  noise: "Just noise",
  foreign_flow: "Foreign investors drove it",
  news: "News around the move",
  broker_concentration: "A few brokers drove it",
  exchange_action: "The exchange acted (suspension)",
  group_contagion: "Its conglomerate group moved",
};
export const hypothesisLabel = (t: HypothesisType) => LABEL[t];

/**
 * Apply fresh evaluations to the pending falsifiers of a case. Resolved
 * falsifiers are frozen and never re-evaluated. `asOf` is the latest stored
 * session, used to date a falsifier that survived its full window.
 */
export function advance(
  prev: FalsifierState[],
  evaluations: Map<number, FalsifierEvaluation>,
  asOf: string,
): { next: FalsifierState[]; events: CaseEvent[] } {
  const events: CaseEvent[] = [];
  const next = prev.map((f) => {
    if (f.status !== "pending") return f;
    const ev = evaluations.get(f.id);
    if (!ev) return f;
    const updated: FalsifierState = {
      ...f,
      status: ev.status,
      daysObserved: Math.max(f.daysObserved, ev.daysObserved),
      triggeredOn: ev.triggeredOn ?? null,
    };
    if (ev.status === "triggered") {
      events.push({
        date: ev.triggeredOn ?? asOf,
        kind: "falsifier_broke",
        hypothesisType: f.hypothesisType,
        message: `“${LABEL[f.hypothesisType]}” broke: ${lowerFirst(f.description)}`,
      });
    } else if (ev.status === "survived") {
      events.push({
        date: asOf,
        kind: "falsifier_held",
        hypothesisType: f.hypothesisType,
        message: `“${LABEL[f.hypothesisType]}” held for all ${f.window} sessions.`,
      });
    }
    return updated;
  });
  return { next, events: events.sort((a, b) => a.date.localeCompare(b.date)) };
}

/** A case closes once none of its falsifiers is still pending. */
export const isResolved = (states: FalsifierState[]) => states.every((f) => f.status !== "pending");

/** Per standing hypothesis: broke if any of its falsifiers triggered, held if all survived. */
export function outcomes(hypotheses: HypothesisResult[], states: FalsifierState[]): Partial<Record<HypothesisType, Outcome>> {
  const out: Partial<Record<HypothesisType, Outcome>> = {};
  for (const h of hypotheses.filter(isStanding)) {
    const mine = states.filter((f) => f.hypothesisType === h.type);
    if (mine.length === 0) continue;
    out[h.type] = mine.some((f) => f.status === "triggered")
      ? "broke"
      : mine.every((f) => f.status === "survived")
        ? "held"
        : "pending";
  }
  return out;
}

/** The last market date on which a falsifier of the case resolved. */
export function closingDate(states: FalsifierState[], asOf: string): string {
  const dates = states.map((f) => (f.status === "triggered" && f.triggeredOn ? f.triggeredOn : asOf));
  return dates.sort().at(-1) ?? asOf;
}

export function closingMessage(o: Partial<Record<HypothesisType, Outcome>>): string {
  const held = Object.entries(o).filter(([, v]) => v === "held").map(([k]) => LABEL[k as HypothesisType]);
  const broke = Object.entries(o).filter(([, v]) => v === "broke").map(([k]) => LABEL[k as HypothesisType]);
  const parts = [held.length && `held: ${held.join(", ")}`, broke.length && `broke: ${broke.join(", ")}`].filter(Boolean);
  return parts.length ? `Case closed — ${parts.join("; ")}.` : "Case closed — no explanation was standing.";
}

// ── Track record ─────────────────────────────────────────────────────────

export interface ClosedCase {
  hypotheses: Pick<HypothesisResult, "type" | "verdict">[];
  outcomes: Partial<Record<HypothesisType, Outcome>>;
}

export interface Tally {
  filed: number;
  held: number;
  broke: number;
}

export interface TrackRow {
  type: HypothesisType;
  total: Tally;
  byVerdict: Record<StandingVerdict, Tally>;
}

/** Below this many resolved calls, a hold rate is not shown as meaningful. */
export const MIN_CASES_FOR_RATE = 5;

const emptyTally = (): Tally => ({ filed: 0, held: 0, broke: 0 });

/**
 * How often each kind of explanation survived its falsifiers, across closed
 * cases. Only hypotheses that were standing when filed count.
 */
export function trackRecord(cases: ClosedCase[]): TrackRow[] {
  const rows = new Map<HypothesisType, TrackRow>();
  for (const c of cases) {
    for (const h of c.hypotheses) {
      if (!isStanding(h)) continue;
      const outcome = c.outcomes[h.type];
      if (outcome !== "held" && outcome !== "broke") continue;
      const row =
        rows.get(h.type) ??
        { type: h.type, total: emptyTally(), byVerdict: { supported: emptyTally(), partial: emptyTally(), weak: emptyTally() } };
      for (const t of [row.total, row.byVerdict[h.verdict as StandingVerdict]]) {
        t.filed += 1;
        t[outcome] += 1;
      }
      rows.set(h.type, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.total.filed - a.total.filed || a.type.localeCompare(b.type));
}

/** Across all types: how often a "holds" (supported) call survived. */
export function headlineRecord(rows: TrackRow[]): Tally {
  return rows.reduce(
    (acc, r) => ({
      filed: acc.filed + r.byVerdict.supported.filed,
      held: acc.held + r.byVerdict.supported.held,
      broke: acc.broke + r.byVerdict.supported.broke,
    }),
    emptyTally(),
  );
}

/** A one-line note for a hypothesis row, or null when there is no history. */
export function recordNote(row: TrackRow | undefined): string | null {
  if (!row || row.total.filed === 0) return null;
  const { filed, held } = row.total;
  if (filed < MIN_CASES_FOR_RATE) {
    return `Track record: held ${held} of ${filed} closed case${filed === 1 ? "" : "s"} — too few to judge.`;
  }
  return `Track record: held in ${held} of ${filed} closed cases (${Math.round((held / filed) * 100)}%).`;
}

function lowerFirst(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
