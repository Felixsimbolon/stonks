import { and, asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  evaluateFalsifier,
  windowOf,
  type Decomposition,
  type FalsifierEvaluation,
  type FalsifierRule,
  type HypothesisResult,
  type HypothesisType,
  type Move,
  type Verdict,
} from "@/lib/engine";
import { investigateMove, loadPostMoveData, scanTicker } from "@/lib/pipeline";
import { todayWib } from "@/lib/sectors";
import {
  advance,
  closingDate,
  closingMessage,
  hypothesisLabel,
  isResolved,
  isStanding,
  outcomes,
  trackRecord,
  type CaseEvent,
  type FalsifierState,
  type Outcome,
  type TrackRow,
} from "./logic";

// Persistence for case files. Filing and checking only read the local store;
// neither ever calls Sectors, so both cost 0 credits.

export interface CaseView {
  id: number;
  ticker: string;
  moveDate: string;
  ret: number;
  status: "open" | "closed";
  filedOn: string;
  closedOn: string | null;
  /** The best-ranked standing explanation at filing time. */
  lead: { type: HypothesisType; verdict: Verdict } | null;
  hypotheses: HypothesisResult[];
  falsifiers: FalsifierState[];
  events: CaseEvent[];
  outcomes: Partial<Record<HypothesisType, Outcome>>;
}

export interface CheckSummary {
  checked: number;
  broke: number;
  held: number;
  closed: number;
}

type FalsifierRow = typeof schema.falsifiers.$inferSelect;
type EventRow = typeof schema.caseEvents.$inferSelect;

const toState = (f: FalsifierRow): FalsifierState => ({
  id: f.id,
  hypothesisType: f.hypothesisType as HypothesisType,
  description: f.description,
  window: f.window,
  status: f.status,
  daysObserved: f.daysObserved,
  triggeredOn: f.triggeredOn,
});

const toEvent = (e: EventRow): CaseEvent => ({
  date: e.date,
  kind: e.kind,
  hypothesisType: e.hypothesisType as HypothesisType | null,
  message: e.message,
});

const pct = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(2)}%`;
const share = (x: number) => `${Math.round(x * 100)}%`;

function moveMessage(ticker: string, move: Move, d: Decomposition, hypotheses: HypothesisResult[]): string {
  const lead = hypotheses.find(isStanding);
  const verdict = lead ? `${hypothesisLabel(lead.type)} (${lead.verdict})` : "no tested explanation fit";
  return `${ticker} ${pct(move.ret)}. Filed as: ${verdict}. Split: market ${share(d.shares.market)} · sector ${share(d.shares.sector)} · stock-specific ${share(d.shares.stockSpecific)}.`;
}

async function insertEvents(investigationId: number, events: CaseEvent[]) {
  if (events.length === 0) return;
  await db.insert(schema.caseEvents).values(events.map((e) => ({ investigationId, ...e })));
}

/**
 * Freeze the current investigation of a flagged move as a case file, then
 * check it against the sessions already stored. Re-filing an open case
 * replaces its snapshot (e.g. after fetching more evidence); a closed case is final.
 */
export async function fileCase(ticker: string, date: string): Promise<number> {
  const t = ticker.toUpperCase();
  const scan = await scanTicker(t);
  const move = scan.moves.find((m) => m.date === date);
  if (!move) throw new Error(`No flagged move for ${t} on ${date}.`);
  const r = await investigateMove(scan, move);
  const inv = r.investigation;

  let [mv] = await db
    .select()
    .from(schema.moves)
    .where(and(eq(schema.moves.ticker, t), eq(schema.moves.date, date)));
  const [existing] = mv
    ? await db.select().from(schema.investigations).where(eq(schema.investigations.moveId, mv.id))
    : [];
  if (existing?.status === "closed") throw new Error("This case is closed; its record is final.");

  if (mv) await db.update(schema.moves).set({ data: move }).where(eq(schema.moves.id, mv.id));
  else [mv] = await db.insert(schema.moves).values({ ticker: t, date, data: move }).returning();

  const snapshot = {
    decomposition: inv.decomposition,
    evidence: inv.evidence,
    hypotheses: inv.hypotheses,
    filedOn: todayWib(),
  };
  let caseId: number;
  if (existing) {
    caseId = existing.id;
    await db.delete(schema.falsifiers).where(eq(schema.falsifiers.investigationId, caseId));
    await db.delete(schema.caseEvents).where(eq(schema.caseEvents.investigationId, caseId));
    await db.update(schema.investigations).set(snapshot).where(eq(schema.investigations.id, caseId));
  } else {
    const [row] = await db
      .insert(schema.investigations)
      .values({ moveId: mv.id, ...snapshot })
      .returning();
    caseId = row.id;
  }

  if (r.falsifiers.length > 0) {
    await db.insert(schema.falsifiers).values(
      r.falsifiers.map((f) => ({
        investigationId: caseId,
        hypothesisType: f.hypothesisType,
        description: f.description,
        rule: f.rule,
        window: windowOf(f.rule),
      })),
    );
  }

  const opening: CaseEvent[] = [
    { date: move.date, kind: "move", hypothesisType: null, message: moveMessage(t, move, inv.decomposition, inv.hypotheses) },
  ];
  if (existing) {
    opening.push({
      date: snapshot.filedOn,
      kind: "refiled",
      hypothesisType: null,
      message: "Re-filed with the evidence available now; earlier checks were reset.",
    });
  }
  await insertEvents(caseId, opening);

  await checkCase(caseId);
  return caseId;
}

/** Re-check the pending falsifiers of one case against stored sessions. */
export async function checkCase(caseId: number): Promise<Omit<CheckSummary, "checked">> {
  const none = { broke: 0, held: 0, closed: 0 };
  const [inv] = await db.select().from(schema.investigations).where(eq(schema.investigations.id, caseId));
  if (!inv || inv.status === "closed") return none;
  const [mv] = await db.select().from(schema.moves).where(eq(schema.moves.id, inv.moveId));
  const move = mv.data as Move;

  const rows = await db.select().from(schema.falsifiers).where(eq(schema.falsifiers.investigationId, caseId));
  const data = await loadPostMoveData(mv.ticker, move);
  const asOf = data.asOf;
  if (!asOf) return none;

  const evaluations = new Map<number, FalsifierEvaluation>();
  for (const f of rows) {
    if (f.status === "pending") evaluations.set(f.id, evaluateFalsifier(f.rule as FalsifierRule, data));
  }
  const { next, events } = advance(rows.map(toState), evaluations, asOf);

  const checkedAt = todayWib();
  for (const f of next) {
    if (!evaluations.has(f.id)) continue;
    await db
      .update(schema.falsifiers)
      .set({ status: f.status, daysObserved: f.daysObserved, triggeredOn: f.triggeredOn, checkedAt })
      .where(eq(schema.falsifiers.id, f.id));
  }
  await insertEvents(caseId, events);

  let closed = 0;
  if (isResolved(next)) {
    const o = outcomes(inv.hypotheses as HypothesisResult[], next);
    const closedOn = closingDate(next, asOf);
    await db
      .update(schema.investigations)
      .set({ status: "closed", closedOn })
      .where(eq(schema.investigations.id, caseId));
    await insertEvents(caseId, [{ date: closedOn, kind: "closed", hypothesisType: null, message: closingMessage(o) }]);
    closed = 1;
  }

  return {
    broke: events.filter((e) => e.kind === "falsifier_broke").length,
    held: events.filter((e) => e.kind === "falsifier_held").length,
    closed,
  };
}

/** Re-check every open case. Run after "update prices" brings in new sessions. */
export async function checkOpenCases(): Promise<CheckSummary> {
  const open = await db
    .select({ id: schema.investigations.id })
    .from(schema.investigations)
    .where(eq(schema.investigations.status, "open"));
  const total: CheckSummary = { checked: open.length, broke: 0, held: 0, closed: 0 };
  for (const { id } of open) {
    const r = await checkCase(id);
    total.broke += r.broke;
    total.held += r.held;
    total.closed += r.closed;
  }
  return total;
}

async function toView(inv: typeof schema.investigations.$inferSelect, mv: typeof schema.moves.$inferSelect): Promise<CaseView> {
  const rows = await db
    .select()
    .from(schema.falsifiers)
    .where(eq(schema.falsifiers.investigationId, inv.id))
    .orderBy(asc(schema.falsifiers.id));
  const eventRows = await db
    .select()
    .from(schema.caseEvents)
    .where(eq(schema.caseEvents.investigationId, inv.id))
    .orderBy(asc(schema.caseEvents.date), asc(schema.caseEvents.id));
  const hypotheses = inv.hypotheses as HypothesisResult[];
  const states = rows.map(toState);
  const lead = hypotheses.find(isStanding);
  return {
    id: inv.id,
    ticker: mv.ticker,
    moveDate: mv.date,
    ret: (mv.data as Move).ret,
    status: inv.status,
    filedOn: inv.filedOn,
    closedOn: inv.closedOn,
    lead: lead ? { type: lead.type, verdict: lead.verdict } : null,
    hypotheses,
    falsifiers: states,
    events: eventRows.map(toEvent),
    outcomes: outcomes(hypotheses, states),
  };
}

export async function getCase(ticker: string, date: string): Promise<CaseView | null> {
  const [row] = await db
    .select({ inv: schema.investigations, mv: schema.moves })
    .from(schema.investigations)
    .innerJoin(schema.moves, eq(schema.investigations.moveId, schema.moves.id))
    .where(and(eq(schema.moves.ticker, ticker.toUpperCase()), eq(schema.moves.date, date)));
  return row ? toView(row.inv, row.mv) : null;
}

/** All case files, newest move first. */
export async function listCases(): Promise<CaseView[]> {
  const rows = await db
    .select({ inv: schema.investigations, mv: schema.moves })
    .from(schema.investigations)
    .innerJoin(schema.moves, eq(schema.investigations.moveId, schema.moves.id))
    .orderBy(desc(schema.moves.date), asc(schema.moves.ticker));
  const out: CaseView[] = [];
  for (const r of rows) out.push(await toView(r.inv, r.mv));
  return out;
}

export async function getTrackRecord(cases?: CaseView[]): Promise<TrackRow[]> {
  const all = cases ?? (await listCases());
  return trackRecord(all.filter((c) => c.status === "closed").map((c) => ({ hypotheses: c.hypotheses, outcomes: c.outcomes })));
}
