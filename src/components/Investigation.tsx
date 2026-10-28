"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { Evidence, HypothesisResult, HypothesisType, Verdict } from "@/lib/engine";
import type { FetchResult } from "@/app/actions";
import type { TickerView } from "@/lib/views";
import { CaseFile } from "./CaseFile";
import { ColumnChart } from "./charts/ColumnChart";
import { ChartFrame } from "./charts/kit";
import { LineChart } from "./charts/LineChart";
import { FetchButton } from "./FetchButton";
import { dirColor, pct, shortDate, share, sigma } from "./format";

type Result = NonNullable<TickerView["result"]>;

const ease = [0.22, 1, 0.36, 1] as const;

const NAMES: Record<HypothesisType, string> = {
  market_beta: "The market moved it",
  sector_rotation: "Its sector moved it",
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

const VERDICT_STYLE: Record<Verdict, { label: string; color: string }> = {
  supported: { label: "holds", color: "var(--stock)" },
  partial: { label: "partly holds", color: "var(--sector)" },
  weak: { label: "weak", color: "var(--muted)" },
  refuted: { label: "doesn't fit", color: "var(--faint)" },
  not_needed: { label: "not needed", color: "var(--faint)" },
  untested: { label: "no data to test", color: "var(--faint)" },
};

// Validated chart colors (see globals.css --c-*), shared with the ticker charts.
const PARTS = [
  { key: "market", label: "Market", color: "var(--c-market)" },
  { key: "sector", label: "Sector", color: "var(--c-sector)" },
  { key: "stockSpecific", label: "Stock-specific", color: "var(--c-stock)" },
] as const;
type PartKey = (typeof PARTS)[number]["key"];

function formatEvidence(e: Evidence): string {
  if (e.value === null) return "n/a";
  if (typeof e.value === "string") return e.value.match(/^\d{4}-\d{2}-\d{2}$/) ? shortDate(e.value) : e.value;
  switch (e.kind) {
    case "beta":
      return e.value.toFixed(2);
    case "peer_breadth":
    case "broker_top3_share":
    case "broker_top3_base":
    case "group_breadth":
      return share(e.value);
    case "broker_conc_z":
      return sigma(e.value);
    case "stock_specific_z":
      return sigma(e.value);
    case "volume_ratio":
      return `${e.value.toFixed(1)}×`;
    case "foreign_net_z":
      return sigma(e.value);
    case "foreign_net":
      return `${e.value < 0 ? "−" : "+"}IDR ${(Math.abs(e.value) / 1e9).toFixed(1)}B`;
    case "news_count":
      return String(e.value);
    default:
      return pct(e.value);
  }
}

function headline(ticker: string, r: Result) {
  const { move, decomposition: d, hypotheses } = r.investigation;
  const verb = move.ret >= 0 ? "rose" : "fell";
  const lead = PARTS.reduce((a, b) => (d.shares[b.key] > d.shares[a.key] ? b : a));
  const unexplained =
    d.shares.stockSpecific >= 0.5 &&
    hypotheses.every((h) => h.type === "market_beta" || h.type === "sector_rotation" || h.verdict === "refuted" || h.verdict === "untested");
  return { verb, lead, unexplained, ticker };
}

// ── Move split bar ───────────────────────────────────────────────────────

function SplitBar({ r, focus, setFocus }: { r: Result; focus: PartKey | null; setFocus: (k: PartKey | null) => void }) {
  const d = r.investigation.decomposition;
  const values: Record<PartKey, number | null> = { market: d.market, sector: d.sector, stockSpecific: d.stockSpecific };

  return (
    <div>
      {/* stacked bar: 2px surface gap between parts, square start, 4px rounded end */}
      <div className="flex h-3 w-full gap-[2px]">
        {PARTS.filter((p) => d.shares[p.key] > 0).map((p, i, shown) => (
          <motion.div
            key={p.key}
            className="h-full cursor-pointer"
            style={{ background: p.color, borderRadius: i === shown.length - 1 ? "0 4px 4px 0" : 0 }}
            initial={{ flexBasis: "0%" }}
            animate={{ flexBasis: `${d.shares[p.key] * 100}%`, opacity: focus === null || focus === p.key ? 1 : 0.3 }}
            transition={{ flexBasis: { delay: 0.2 + i * 0.12, duration: 0.9, ease }, opacity: { duration: 0.2 } }}
            onPointerEnter={() => setFocus(p.key)}
            onPointerLeave={() => setFocus(null)}
          />
        ))}
      </div>

      <div className="mt-6 grid grid-cols-3 gap-4">
        {PARTS.map((p, i) => {
          const v = values[p.key];
          const against = v !== null && d.shares[p.key] === 0 && Math.abs(v) > 0.0005;
          return (
            <motion.div
              key={p.key}
              className="cursor-default"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: focus === null || focus === p.key ? 1 : 0.35, y: 0 }}
              transition={{ delay: 0.4 + i * 0.1, duration: 0.5 }}
              onPointerEnter={() => setFocus(p.key)}
              onPointerLeave={() => setFocus(null)}
            >
              <div className="eyebrow flex items-center gap-2">
                <span className="block h-2.5 w-2.5 rounded-[3px]" style={{ background: p.color }} />
                {p.label}
              </div>
              <div className="mt-2 text-4xl font-semibold tracking-tight sm:text-5xl">{share(d.shares[p.key])}</div>
              <div className="num mt-1 text-sm text-muted">
                {v === null ? "too few peers" : pct(v)}
                {against && <span className="text-faint"> · pushed the other way</span>}
                {p.key === "stockSpecific" && <span className="text-faint"> · {sigma(d.stockSpecificZ)}</span>}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ── Falsifier ────────────────────────────────────────────────────────────

function FalsifierLine({ f, window }: { f: Result["falsifiers"][number]; window: number }) {
  const e = f.evaluation;
  const broke = e.status === "triggered";
  const status =
    e.status === "triggered"
      ? `broke on ${shortDate(e.triggeredOn!)}`
      : e.status === "survived"
        ? `held for all ${window} sessions`
        : `holding · ${e.daysObserved} of ${window} sessions watched`;

  return (
    <div className="mt-4 border-l pl-4" style={{ borderColor: broke ? "var(--down)" : "var(--hair)" }}>
      <p className="text-sm leading-relaxed text-muted">
        <span className="text-faint">Would break if </span>
        {f.description.charAt(0).toLowerCase() + f.description.slice(1)}
      </p>
      <div className="mt-2 flex items-center gap-3">
        <div className="flex gap-1">
          {Array.from({ length: window }, (_, i) => {
            const observed = i < e.daysObserved;
            const isBreak = broke && i === e.daysObserved - 1;
            return (
              <motion.span
                key={i}
                className="block h-1.5 w-4 rounded-full"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ delay: 0.15 + i * 0.06, duration: 0.3 }}
                style={{
                  originX: 0,
                  background: isBreak ? "var(--down)" : observed ? "var(--ink)" : "var(--hair)",
                  opacity: observed && !isBreak ? 0.55 : 1,
                }}
              />
            );
          })}
        </div>
        <span className="num text-xs" style={{ color: broke ? "var(--down)" : "var(--faint)" }}>
          {status}
        </span>
      </div>
      {f.path && f.path.dates.length > 0 && <FalsifierPathChart path={f.path} />}
    </div>
  );
}

type Path = NonNullable<Result["falsifiers"][number]["path"]>;

const METRIC: Record<Path["metric"], { label: string; format: (v: number) => string }> = {
  cum_abnormal_return: { label: "beta-adjusted return since the move", format: (v) => pct(v, 1) },
  spread_vs_peer_median: { label: "gap vs peer median since the move", format: (v) => pct(v, 1) },
  spread_vs_group_median: { label: "gap vs group median since the move", format: (v) => pct(v, 1) },
  retracement: { label: "share of the move given back", format: (v) => `${Math.round(v * 100)}%` },
  avg_volume_ratio: { label: "volume vs pre-move average", format: (v) => `${v.toFixed(1)}×` },
  foreign_flow_ratio: { label: "foreign flow since, vs move-day flow", format: (v) => `${v.toFixed(1)}×` },
};

/** The falsifier metric session by session, against the line that would break the story. */
function FalsifierPathChart({ path }: { path: Path }) {
  const m = METRIC[path.metric];
  return (
    <div className="mt-3 max-w-md">
      <p className="mb-1 text-[11px] text-faint">{m.label} · dashed: breaking point</p>
      <LineChart
        height={110}
        xs={path.dates.map(shortDate)}
        format={m.format}
        series={[{ key: path.metric, label: m.label, color: "var(--c-series)", values: path.values }]}
        thresholds={path.thresholds.map((v) => ({ value: v, label: m.format(v) }))}
      />
    </div>
  );
}

// ── Event study ──────────────────────────────────────────────────────────

const WINDOW_LABEL: Record<string, string> = {
  "run-up": "Run-up (−5 to −1)",
  event: "Event (−1 to +1)",
  "move + next session": "Move + next session (0 to +1)",
  "after the move": "After the move (+1 to +5)",
};

function EventStudyPanel({ r }: { r: Result }) {
  const es = r.event;
  if (es.ars.length === 0) return null;
  const k = (n: number) => (n === 0 ? "0" : n > 0 ? `+${n}` : `−${-n}`);
  return (
    <ChartFrame
      title="Event study"
      subtitle="Abnormal (beta-adjusted) return per session around the move, and cumulated over standard windows with significance vs the stock's own volatility"
      table={{
        columns: ["window", "sessions", "CAR", "t", "p"],
        rows: es.windows.map((w) => [
          WINDOW_LABEL[w.label] ?? w.label,
          `${w.sessions}${w.complete ? "" : " (so far)"}`,
          pct(w.car),
          w.t.toFixed(2),
          w.p < 0.001 ? "<0.001" : w.p.toFixed(3),
        ]),
      }}
    >
      <div className="grid gap-10 lg:grid-cols-[1.3fr_1fr]">
        <ColumnChart
          height={170}
          format={(v) => `${(v * 100).toFixed(1)}%`}
          markers={[{ key: "0", label: "the move" }]}
          columns={es.ars.map((a) => ({
            key: k(a.k),
            label: k(a.k),
            value: a.ar,
            tooltipTitle: `${shortDate(a.date)} · session ${k(a.k)}`,
            tooltip: [{ value: pct(a.ar), label: "abnormal return", color: a.ar >= 0 ? "var(--c-pos)" : "var(--c-neg)" }],
          }))}
        />
        <dl className="space-y-3">
          {es.windows.map((w) => (
            <div key={w.label} className="grid grid-cols-[1fr_auto] items-baseline gap-x-4">
              <dt className="text-sm text-muted">
                {WINDOW_LABEL[w.label] ?? w.label}
                {!w.complete && <span className="text-faint"> · {w.sessions} so far</span>}
              </dt>
              <dd className="num text-right text-sm text-ink">
                {pct(w.car)}
                <span className={`ml-2 text-xs ${w.p < 0.05 ? "text-ink" : "text-faint"}`}>
                  {w.p < 0.001 ? "p<0.001" : `p=${w.p.toFixed(3)}`}
                </span>
              </dd>
            </div>
          ))}
          <p className="pt-1 text-xs text-faint">p under a heavy-tailed t(4) model. Below 0.05 is shown in full ink.</p>
        </dl>
      </div>
    </ChartFrame>
  );
}

// ── Hypothesis row ───────────────────────────────────────────────────────

function HypothesisRow({
  h,
  rank,
  r,
  active,
  onFocus,
  trackNote,
}: {
  h: HypothesisResult;
  rank: number;
  r: Result;
  active: boolean;
  onFocus: (h: HypothesisResult | null) => void;
  trackNote?: string | null;
}) {
  const v = VERDICT_STYLE[h.verdict];
  const dimmed = h.verdict === "refuted" || h.verdict === "not_needed" || h.verdict === "untested";
  const falsifiers = r.falsifiers.map((f, i) => ({ f, w: r.windows[i] })).filter(({ f }) => f.hypothesisType === h.type);

  return (
    <motion.li
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.5 + rank * 0.08, duration: 0.6, ease }}
      onPointerEnter={() => onFocus(h)}
      onPointerLeave={() => onFocus(null)}
      className="group relative py-6"
    >
      <motion.span
        aria-hidden
        className="absolute -left-4 top-6 bottom-6 w-px"
        style={{ background: `linear-gradient(180deg, ${v.color}, transparent)` }}
        initial={{ opacity: 0, scaleY: 0.3 }}
        animate={{ opacity: active ? 1 : 0, scaleY: active ? 1 : 0.3 }}
        transition={{ duration: 0.3 }}
      />
      <div className="flex items-baseline gap-4">
        <span className="num w-5 shrink-0 text-xs text-faint">{String(rank + 1).padStart(2, "0")}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className={`display text-3xl transition-colors ${dimmed ? "text-faint" : "text-ink"}`}>{NAMES[h.type]}</h3>
            <span className="eyebrow" style={{ color: v.color }}>
              {v.label}
            </span>
          </div>

          {!dimmed && (
            <div className="mt-3 h-px w-full bg-hair">
              <motion.div
                className="h-px origin-left"
                style={{ background: `linear-gradient(90deg, ${v.color}, transparent)` }}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: h.score }}
                transition={{ delay: 0.7 + rank * 0.08, duration: 0.9, ease }}
              />
            </div>
          )}

          <p className={`mt-3 text-sm leading-relaxed ${dimmed ? "text-faint" : "text-muted"}`}>{h.rationale}</p>
          {h.probability !== undefined && (
            <p className="mt-2 flex items-center gap-2 text-xs text-muted">
              <span className="relative block h-1.5 w-16 overflow-hidden rounded-full bg-hair">
                <motion.span
                  className="absolute inset-y-0 left-0 block rounded-full bg-[var(--c-stock)]"
                  initial={{ width: 0 }}
                  animate={{ width: `${h.probability * 100}%` }}
                  transition={{ delay: 0.8 + rank * 0.08, duration: 0.7, ease }}
                />
              </span>
              <span className="num text-ink">{Math.round(h.probability * 100)}%</span> likely the main driver of the stock-specific part
            </p>
          )}
          {trackNote && !dimmed && <p className="num mt-2 text-xs text-sector/80">{trackNote}</p>}
          {h.type === "news" && r.articles.length > 0 && (
            <ul className="mt-3 space-y-2">
              {r.articles.slice(0, 4).map((a) => (
                <li key={a.url + a.timestamp} className="text-sm">
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-ink underline decoration-hair underline-offset-4 transition-colors hover:decoration-stock"
                  >
                    {a.title}
                  </a>
                  <span className="num ml-2 text-xs text-faint">
                    {shortDate(a.timestamp.slice(0, 10))} {a.timestamp.slice(11, 16)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {falsifiers.map(({ f, w }) => (
            <FalsifierLine key={f.description} f={f} window={w} />
          ))}
        </div>
      </div>
      <div className="hairline absolute inset-x-0 bottom-0" />
    </motion.li>
  );
}

// ── Board ────────────────────────────────────────────────────────────────

export function Investigation({
  ticker,
  result: r,
  fetchEvidence,
  caseFile,
  trackNotes,
  fileCase,
  checkCases,
}: {
  ticker: string;
  result: Result;
  fetchEvidence: () => Promise<FetchResult>;
  caseFile: TickerView["caseFile"];
  trackNotes: TickerView["trackNotes"];
  fileCase: () => Promise<FetchResult>;
  checkCases: () => Promise<FetchResult>;
}) {
  const [focusPart, setFocusPart] = useState<PartKey | null>(null);
  const [focusH, setFocusH] = useState<HypothesisResult | null>(null);
  const { move, evidence, hypotheses } = r.investigation;
  const h = headline(ticker, r);
  const lit = new Set(focusH?.evidenceIds ?? []);
  const missingNames = [
    r.missing.peers && "Peer data",
    r.missing.events && "dividend data",
    r.missing.flows && "foreign flow",
    r.missing.news && "news",
    r.missing.brokers && "broker activity",
    r.missing.suspensions && "IDX suspensions",
    r.missing.groups && "conglomerate group",
  ].filter((x): x is string => Boolean(x));

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={move.date}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -12, transition: { duration: 0.2 } }}
        transition={{ duration: 0.6, ease }}
      >
        {/* headline */}
        <p className="eyebrow mb-5">investigation · {shortDate(move.date)}</p>
        <h2 className="display max-w-4xl text-5xl leading-[1.02] sm:text-6xl">
          {ticker} {h.verb}{" "}
          <span style={{ color: dirColor(move.ret) }}>{pct(Math.abs(move.ret)).slice(1)}</span>.{" "}
          {h.unexplained ? (
            <span className="text-muted">
              The move was its own, and <em className="gradient-text">nothing we tested explains it.</em>
            </span>
          ) : (
            <span className="text-muted">
              <em className="text-ink">{h.lead.label}</em> accounts for {share(r.investigation.decomposition.shares[h.lead.key])}{" "}
              of it.
            </span>
          )}
        </h2>
        <p className="mt-4 text-sm text-faint">
          {r.subSector ?? "Unknown subsector"} · compared against {r.peerCount} peers · IHSG {pct(move.marketRet)} that day
          {move.pValue !== undefined && <> · p = {move.pValue < 0.001 ? "<0.001" : move.pValue.toFixed(3)} (heavy-tailed)</>}
        </p>
        {move.censored && (
          <p className="mt-3 max-w-2xl border-l-2 border-[var(--c-neg)] pl-4 text-sm text-muted">
            This session may have been capped by an IDX auto-rejection limit or cut short by a trading halt (no room to
            trade past the close). The true move may be larger than the close shows; see &ldquo;move + next session&rdquo; in
            the event study below.
          </p>
        )}

        {missingNames.length > 0 && (
          <div className="mt-10 max-w-2xl border-l-2 pl-6" style={{ borderImage: "linear-gradient(180deg, var(--sector), transparent) 1" }}>
            <p className="text-sm leading-relaxed text-muted">
              {missingNames.join(", ").replace(/, ([^,]*)$/, " and $1")} for this move{" "}
              {missingNames.length === 1 ? "hasn't" : "haven't"} been fetched, so the explanations that need{" "}
              {missingNames.length === 1 ? "it" : "them"} show as untested.
            </p>
            <FetchButton
              action={fetchEvidence}
              label="fetch evidence"
              hint={
                r.missing.peers
                  ? "first time for a ticker ≈ 20–30 credits (peer history); stored after that"
                  : "≈ 4–12 credits; foreign flow, news, brokers, suspensions and group only when part of the move is stock-specific"
              }
              className="mt-3"
            />
          </div>
        )}

        {/* split */}
        <section className="mt-14">
          <p className="eyebrow mb-5">where the move came from</p>
          <SplitBar r={r} focus={focusPart} setFocus={setFocusPart} />
        </section>

        {/* event study */}
        <section className="mt-14">
          <EventStudyPanel r={r} />
        </section>

        {h.unexplained && (
          <motion.p
            className="display mt-14 max-w-3xl border-l-2 pl-6 text-2xl italic leading-snug text-muted"
            style={{ borderImage: "linear-gradient(180deg, var(--stock), var(--sector)) 1" }}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.6 }}
          >
            Something specific to {ticker} happened that none of the explanations we could test captures. That is the
            part worth digging into: company filings and IDX announcements.
          </motion.p>
        )}

        {/* hypotheses + evidence */}
        <section className="mt-16 grid gap-12 lg:grid-cols-[1fr_20rem]">
          <div>
            <p className="eyebrow mb-1">competing explanations, ranked</p>
            {r.investigation.otherProbability !== undefined && (
              <p className="mb-2 text-xs text-faint">
                Stock-level explanations carry a probability of being the main driver of the stock-specific part.{" "}
                <span className="text-muted">
                  Something not tested here: {Math.round(r.investigation.otherProbability * 100)}%.
                </span>
              </p>
            )}
            <ul>
              {hypotheses.map((hyp, i) => (
                <HypothesisRow key={hyp.type} h={hyp} rank={i} r={r} active={focusH?.type === hyp.type} onFocus={setFocusH} trackNote={trackNotes[hyp.type]} />
              ))}
            </ul>
          </div>

          <aside className="lg:sticky lg:top-8 lg:self-start">
            <p className="eyebrow mb-4">evidence {focusH ? `· ${NAMES[focusH.type].toLowerCase()}` : "· hover an explanation"}</p>
            <dl>
              {evidence.map((e, i) => {
                const on = lit.has(e.id);
                return (
                  <motion.div
                    key={e.id}
                    className="grid grid-cols-[2rem_1fr_auto] items-baseline gap-x-3 py-2.5"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: focusH ? (on ? 1 : 0.22) : 0.85, x: on ? 4 : 0 }}
                    transition={{ duration: 0.25, delay: focusH ? 0 : 0.6 + i * 0.03 }}
                  >
                    <span className="num text-[11px]" style={{ color: on ? "var(--stock)" : "var(--faint)" }}>
                      {e.id}
                    </span>
                    <dt className="min-w-0 text-sm text-muted">
                      {e.label}
                      <span className="num mt-0.5 block truncate text-[10px] text-faint" title={e.source}>
                        {e.source}
                      </span>
                    </dt>
                    <dd className="num max-w-[9rem] truncate text-sm text-ink" title={formatEvidence(e)}>
                      {formatEvidence(e)}
                    </dd>
                  </motion.div>
                );
              })}
            </dl>
          </aside>
        </section>

        {/* case file */}
        <section className="mt-20">
          <div className="hairline mb-10" />
          <p className="eyebrow mb-6">case file</p>
          <CaseFile caseFile={caseFile} fileCase={fileCase} checkCases={checkCases} />
        </section>
      </motion.div>
    </AnimatePresence>
  );
}
