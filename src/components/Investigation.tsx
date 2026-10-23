"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import type { Evidence, HypothesisResult, HypothesisType, Verdict } from "@/lib/engine";
import type { FetchResult } from "@/app/actions";
import type { TickerView } from "@/lib/views";
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
};

const VERDICT_STYLE: Record<Verdict, { label: string; color: string }> = {
  supported: { label: "holds", color: "var(--stock)" },
  partial: { label: "partly holds", color: "var(--sector)" },
  weak: { label: "weak", color: "var(--muted)" },
  refuted: { label: "doesn't fit", color: "var(--faint)" },
  not_needed: { label: "not needed", color: "var(--faint)" },
  untested: { label: "no data to test", color: "var(--faint)" },
};

const PARTS = [
  { key: "market", label: "Market", color: "var(--market)" },
  { key: "sector", label: "Sector", color: "var(--sector)" },
  { key: "stockSpecific", label: "Stock-specific", color: "var(--stock)" },
] as const;
type PartKey = (typeof PARTS)[number]["key"];

function formatEvidence(e: Evidence): string {
  if (e.value === null) return "n/a";
  if (typeof e.value === "string") return e.value.match(/^\d{4}-\d{2}-\d{2}$/) ? shortDate(e.value) : e.value;
  switch (e.kind) {
    case "beta":
      return e.value.toFixed(2);
    case "peer_breadth":
      return share(e.value);
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
      <div className="flex h-3 w-full">
        {PARTS.map((p, i) => (
          <motion.div
            key={p.key}
            className="h-full cursor-pointer px-0.5 first:pl-0 last:pr-0"
            initial={{ width: "0%" }}
            animate={{ width: `${d.shares[p.key] * 100}%`, opacity: focus === null || focus === p.key ? 1 : 0.25 }}
            transition={{ width: { delay: 0.2 + i * 0.12, duration: 0.9, ease }, opacity: { duration: 0.2 } }}
            onPointerEnter={() => setFocus(p.key)}
            onPointerLeave={() => setFocus(null)}
          >
            {d.shares[p.key] > 0 && (
              <div
                className="h-full w-full rounded-full"
                style={{ background: `linear-gradient(90deg, ${p.color}, color-mix(in oklab, ${p.color} 55%, white))` }}
              />
            )}
          </motion.div>
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
              <div className="eyebrow" style={{ color: p.color }}>
                {p.label}
              </div>
              <div className="display mt-2 text-4xl sm:text-5xl">{share(d.shares[p.key])}</div>
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
    </div>
  );
}

// ── Hypothesis row ───────────────────────────────────────────────────────

function HypothesisRow({
  h,
  rank,
  r,
  active,
  onFocus,
}: {
  h: HypothesisResult;
  rank: number;
  r: Result;
  active: boolean;
  onFocus: (h: HypothesisResult | null) => void;
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
}: {
  ticker: string;
  result: Result;
  fetchEvidence: () => Promise<FetchResult>;
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
              <em style={{ color: h.lead.color }}>{h.lead.label}</em> accounts for {share(r.investigation.decomposition.shares[h.lead.key])}{" "}
              of it.
            </span>
          )}
        </h2>
        <p className="mt-4 text-sm text-faint">
          {r.subSector ?? "Unknown subsector"} · compared against {r.peerCount} peers · IHSG {pct(move.marketRet)} that day
        </p>

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
                  : "≈ 1–3 credits; foreign flow and news only when part of the move is stock-specific"
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

        {h.unexplained && (
          <motion.p
            className="display mt-14 max-w-3xl border-l-2 pl-6 text-2xl italic leading-snug text-muted"
            style={{ borderImage: "linear-gradient(180deg, var(--stock), var(--sector)) 1" }}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.6 }}
          >
            Something specific to {ticker} happened that none of the explanations we could test captures. That is the
            part worth digging into: company filings or broker summaries.
          </motion.p>
        )}

        {/* hypotheses + evidence */}
        <section className="mt-16 grid gap-12 lg:grid-cols-[1fr_20rem]">
          <div>
            <p className="eyebrow mb-1">competing explanations, ranked</p>
            <ul>
              {hypotheses.map((hyp, i) => (
                <HypothesisRow key={hyp.type} h={hyp} rank={i} r={r} active={focusH?.type === hyp.type} onFocus={setFocusH} />
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
      </motion.div>
    </AnimatePresence>
  );
}
