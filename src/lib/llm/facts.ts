import { hypothesisLabel } from "@/lib/casebook/logic";
import { getTickerView } from "@/lib/views";
import type { Fact } from "./guardrails";

// Everything Claude may say about a stock, as numbered facts computed by the
// engine from stored data. Claude words these; it never computes or invents
// numbers. Built read-only: no Sectors calls.

const pct = (x: number, d = 2) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(d)}%`;
const share = (x: number) => `${Math.round(x * 100)}%`;
const num = (x: number, d = 0) => x.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const idrB = (x: number) => `${x >= 0 ? "+" : "−"}IDR ${num(Math.abs(x) / 1e9, 1)}B`;

export interface StockFacts {
  ticker: string;
  dataThrough: string | null;
  facts: Fact[];
}

class FactList {
  readonly facts: Fact[] = [];
  add(label: string, value: string, source = "stonks engine"): string {
    const id = `F${this.facts.length + 1}`;
    this.facts.push({ id, label, value, source });
    return id;
  }
}

export async function buildStockFacts(ticker: string): Promise<StockFacts> {
  const t = ticker.toUpperCase();
  const view = await getTickerView(t);
  const f = new FactList();

  // Price
  const p = view.prices;
  const last = p.at(-1);
  if (last) {
    f.add("Latest close", `IDR ${num(last.close)} on ${last.date}`, `sectors:/v2/daily/${t}/`);
    const back = (n: number) => (p.length > n ? p[p.length - 1 - n] : null);
    for (const [n, label] of [
      [1, "1-session change"],
      [20, "20-session change"],
      [60, "60-session change"],
    ] as const) {
      const b = back(n);
      if (b) f.add(label, pct(last.close / b.close - 1), `sectors:/v2/daily/${t}/`);
    }
  }

  // Unusual moves and what drove them
  f.add("Unusual moves flagged in the last 60 sessions", String(view.moves.length));
  for (const d of [...view.drivers].reverse().slice(0, 6)) {
    f.add(
      `Move on ${d.date}`,
      `${pct(d.ret)}; split: market ${share(d.market)}, sector ${d.sectorAvailable ? share(d.sector) : "n/a"}, stock-specific ${share(d.stockSpecific)}`,
    );
  }

  // The latest investigated move, in detail
  const r = view.result;
  if (r) {
    const inv = r.investigation;
    const m = inv.move;
    f.add(
      `Investigated move (${m.date})`,
      `${pct(m.ret)} vs IHSG ${pct(m.marketRet)}; beta ${m.beta.toFixed(2)}; ${m.abnormalZ.toFixed(1)}σ beta-adjusted; volume ${m.volumeRatio.toFixed(1)}× its 20-session average`,
    );
    if (r.subSector) f.add("Subsector", `${r.subSector} (${r.peerCount} peers compared)`, `sectors:/v2/company/report/${t}/`);
    for (const h of inv.hypotheses) {
      f.add(`Explanation “${hypothesisLabel(h.type)}” for ${m.date}`, `${h.verdict.replace("_", " ")} — ${h.rationale}`);
    }
    for (const fa of r.falsifiers) {
      const e = fa.evaluation;
      const status =
        e.status === "triggered" ? `broke on ${e.triggeredOn}` : e.status === "survived" ? "held for its full window" : `still open, ${e.daysObserved} sessions watched`;
      f.add(`Would break “${hypothesisLabel(fa.hypothesisType)}”`, `${fa.description} Status: ${status}.`);
    }
    if (r.articles.length) {
      f.add(`News around ${m.date}`, r.articles.slice(0, 3).map((a) => `“${a.title}”`).join("; "), `sectors:/v2/news/?symbols=${t}`);
    }
  }

  // Foreign flow
  const flows = (view.flows ?? []).filter((x) => x.net !== null);
  if (flows.length) {
    const last20 = flows.slice(-20);
    f.add("Net foreign flow, last 20 stored sessions", idrB(last20.reduce((a, x) => a + x.net!, 0)), `sectors:/v2/foreign-flow/${t}/`);
  }

  // Case file for the investigated move
  if (view.caseFile) {
    const c = view.caseFile;
    const outcomes = Object.entries(c.outcomes).map(([k, v]) => `${hypothesisLabel(k as never)}: ${v}`);
    f.add(`Case file for ${c.moveDate}`, `${c.status}, filed ${c.filedOn}${outcomes.length ? `; ${outcomes.join(", ")}` : ""}`);
  }

  // Mining asset backing
  const ab = view.assetBacking;
  if (ab?.status === "ready" && ab.latest) {
    const l = ab.latest;
    if (l.reservesTotal !== null) f.add(`${l.commodity} reserves (${l.year})`, `${num(l.reservesTotal)} Mt`, "sectors:/v2/mining/");
    if (l.production !== null) f.add(`${l.commodity} production (${l.year})`, `${num(l.production, 2)} Mt`, "sectors:/v2/mining/");
    if (ab.reserveLifeYears !== null) f.add("Reserve life at latest production", `${num(ab.reserveLifeYears, 1)} years`);
    if (l.stripRatio !== null) f.add("Strip ratio", num(l.stripRatio, 2), "sectors:/v2/mining/");
    if (ab.runway?.nearest) {
      f.add(
        "Next license expiry",
        `${ab.runway.nearest.expiry} (${ab.runway.nearest.areaHa !== null ? `${num(ab.runway.nearest.areaHa)} ha` : "area n/a"}); ${share(ab.runway.expiringShare.within3y)} of valid licensed area expires within 3 years`,
        "sectors:/v2/mining/",
      );
    }
    if (ab.capPerTonIdr !== null) {
      f.add(
        "Market cap per ton of reserves",
        `IDR ${num(ab.capPerTonIdr)}${ab.peerCapPerTonIdr !== null ? ` (peer median IDR ${num(ab.peerCapPerTonIdr)})` : ""}`,
      );
    }
    if (ab.costPosition) {
      const cp = ab.costPosition;
      f.add("Coal cost-curve position", `#${cp.rank} of ${cp.of}; cost $${num(cp.costPerTon, 1)}/t, sells at $${num(cp.aspPerTon, 1)}/t`);
    }
  }

  return { ticker: t, dataThrough: view.dataThrough, facts: f.facts };
}
