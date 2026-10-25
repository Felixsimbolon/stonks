"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { FetchResult } from "@/app/actions";
import type { LlmUsage } from "@/lib/llm/client";
import type { Fact } from "@/lib/llm/guardrails";
import type { StoredSummary } from "@/lib/llm/store";
import { ease } from "./charts/kit";
import { FetchButton } from "./FetchButton";
import { shortDate } from "./format";

/** A fact ID chip; hovering or focusing shows the fact it stands for. */
function FactChip({ id, fact }: { id: string; fact?: Fact }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block">
      <button
        type="button"
        className="num ml-1 rounded-[4px] border border-hair px-1 text-[10px] leading-4 text-muted transition-colors hover:border-[var(--c-series)] hover:text-ink"
        onPointerEnter={() => setOpen(true)}
        onPointerLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label={fact ? `${fact.label}: ${fact.value}` : id}
      >
        {id}
      </button>
      <AnimatePresence>
        {open && fact && (
          <motion.span
            className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 block w-72 rounded-md border border-hair bg-[#121117]/95 px-3 py-2 text-xs shadow-lg"
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
          >
            <span className="block font-medium text-ink">{fact.value}</span>
            <span className="block text-muted">{fact.label}</span>
            <span className="num mt-1 block truncate text-[10px] text-faint">{fact.source}</span>
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

function Point({ text, facts, byId }: { text: string; facts: string[]; byId: Map<string, Fact> }) {
  return (
    <p className="text-[15px] leading-relaxed text-muted">
      {text}
      {facts.map((id) => (
        <FactChip key={id} id={id} fact={byId.get(id)} />
      ))}
    </p>
  );
}

export function AiSummary({
  ticker,
  stored,
  dataThrough,
  llm,
  generate,
}: {
  ticker: string;
  stored: StoredSummary | null;
  dataThrough: string | null;
  llm: LlmUsage;
  generate: () => Promise<FetchResult>;
}) {
  const [showFacts, setShowFacts] = useState(false);
  const stale = stored !== null && dataThrough !== null && stored.dataThrough !== null && dataThrough > stored.dataThrough;

  // Written automatically when the page opens, but only when there is no
  // summary yet or new sessions have come in since: an up-to-date summary is
  // shown from storage without calling Claude.
  const needsSummary = llm.configured && (!stored || stale);
  const [auto, setAuto] = useState<{ state: "idle" | "writing" | "error"; message?: string }>({ state: "idle" });
  const started = useRef(false);
  useEffect(() => {
    if (!needsSummary || started.current) return;
    started.current = true;
    setAuto({ state: "writing" });
    generate()
      .then((r) => setAuto(r.error ? { state: "error", message: r.error } : { state: "idle" }))
      .catch(() => setAuto({ state: "error", message: "Could not write the summary." }));
  }, [needsSummary, generate]);

  const button = (
    <FetchButton
      action={generate}
      label={stored ? "rewrite summary" : "write an AI summary"}
      pendingLabel="Claude is writing…"
      hint={`uses Claude (${llm.model}) · 0 Sectors credits · ${llm.usedToday.toLocaleString()} of ${llm.limit.toLocaleString()} tokens used today`}
    />
  );

  if (!llm.configured) {
    return (
      <p className="max-w-2xl text-sm text-faint">
        AI summaries need <span className="text-ink">ANTHROPIC_API_KEY</span> in <span className="num">.env</span>. Everything else on this
        page works without it.
      </p>
    );
  }

  if (!stored) {
    return (
      <div className="max-w-2xl">
        <p className="display text-3xl leading-tight text-muted">
          The story of {ticker} so far, <em className="gradient-text">in plain words.</em>
        </p>
        {auto.state === "error" ? (
          <>
            <p className="mt-3 text-sm text-down">{auto.message}</p>
            <div className="mt-5">{button}</div>
          </>
        ) : (
          <>
            <p className="mt-3 flex items-center gap-2 text-sm text-faint">
              <motion.span
                className="block h-1.5 w-1.5 rounded-full bg-[var(--c-series)]"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ repeat: Infinity, duration: 1.2 }}
              />
              Claude is reading the engine&apos;s facts and writing. Every number is checked against those facts, and anything that
              reads like advice is removed before you see it.
            </p>
            <div className="mt-6 space-y-3">
              {[0.92, 0.78, 0.85, 0.6].map((w, i) => (
                <div key={i} className="relative h-3 overflow-hidden rounded-full bg-white/[0.04]" style={{ width: `${w * 100}%` }}>
                  <div
                    className="absolute inset-y-0 w-1/3 animate-[shimmer_1.6s_ease-in-out_infinite]"
                    style={{ background: "linear-gradient(90deg, transparent, rgb(255 255 255 / 0.08), transparent)", animationDelay: `${i * 0.15}s` }}
                  />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    );
  }

  const s = stored.summary;
  const byId = new Map(stored.facts.map((f) => [f.id, f]));

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }}>
      {s.headline && <h2 className="display max-w-4xl text-4xl leading-tight sm:text-5xl">{s.headline}</h2>}

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-4">
          {s.points.map((p, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + i * 0.08, duration: 0.5, ease }}
              className="border-l border-hair pl-4"
            >
              <Point text={p.text} facts={p.facts} byId={byId} />
            </motion.div>
          ))}
          {s.gaps && <p className="pl-4 text-sm italic text-faint">{s.gaps}</p>}
        </div>

        <aside>
          {s.watch.length > 0 && (
            <>
              <p className="eyebrow mb-3">what would change this</p>
              <div className="space-y-3">
                {s.watch.map((w, i) => (
                  <Point key={i} text={w.text} facts={w.facts} byId={byId} />
                ))}
              </div>
            </>
          )}
        </aside>
      </div>

      <div className="mt-8 flex flex-wrap items-start justify-between gap-6">
        <div className="text-xs leading-relaxed text-faint">
          <p>
            Written by {stored.model} on {shortDate(stored.generatedAt.slice(0, 10))} from {stored.facts.length} engine facts ·{" "}
            {s.dropped ? `${s.dropped} part${s.dropped === 1 ? "" : "s"} removed by the guardrails` : "every point checked against its facts"} ·
            not financial advice.
          </p>
          {stale && (
            <p className="mt-1 text-ink">
              {auto.state === "writing"
                ? `New sessions have come in (data through ${shortDate(dataThrough!)}); Claude is rewriting this…`
                : auto.state === "error"
                  ? `Couldn't update for the new sessions: ${auto.message}`
                  : `New sessions have come in since this was written (data through ${shortDate(dataThrough!)}).`}
            </p>
          )}
          <button
            type="button"
            onClick={() => setShowFacts((v) => !v)}
            className="eyebrow mt-2 underline decoration-hair underline-offset-4 hover:text-ink"
          >
            {showFacts ? "hide the facts" : "show the facts it was given"}
          </button>
          <AnimatePresence>
            {showFacts && (
              <motion.dl
                className="mt-3 grid max-w-3xl grid-cols-[2.5rem_1fr] gap-x-3 gap-y-1"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                {stored.facts.map((f) => (
                  <div key={f.id} className="contents">
                    <dt className="num text-faint">{f.id}</dt>
                    <dd className="text-muted">
                      {f.label}: <span className="text-ink">{f.value}</span>
                    </dd>
                  </div>
                ))}
              </motion.dl>
            )}
          </AnimatePresence>
        </div>
        {button}
      </div>
    </motion.div>
  );
}
