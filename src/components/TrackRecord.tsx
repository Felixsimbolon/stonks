"use client";

import { motion } from "motion/react";
import { hypothesisLabel, MIN_CASES_FOR_RATE, type Tally, type TrackRow } from "@/lib/casebook/logic";

const ease = [0.22, 1, 0.36, 1] as const;

function rate(t: Tally) {
  return t.filed ? t.held / t.filed : 0;
}

export function TrackRecord({ rows, headline }: { rows: TrackRow[]; headline: Tally }) {
  if (rows.length === 0) {
    return (
      <p className="max-w-2xl text-muted">
        No closed cases yet. File cases from an investigation, update prices as new sessions come in, and check them.
        Once a case&apos;s conditions all resolve, it lands here.
      </p>
    );
  }

  return (
    <div>
      {headline.filed > 0 && (
        <motion.p
          className="display max-w-4xl text-4xl leading-tight sm:text-5xl"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease }}
        >
          When the engine said an explanation <em className="gradient-text">holds</em>, it survived its own test{" "}
          <span className="text-ink">{headline.held}</span>
          <span className="text-muted"> of {headline.filed}</span> times.
          {headline.filed < MIN_CASES_FOR_RATE && <span className="text-muted"> Too few cases to read much into it yet.</span>}
        </motion.p>
      )}

      <ul className="mt-12">
        {rows.map((row, i) => {
          const held = rate(row.total);
          const few = row.total.filed < MIN_CASES_FOR_RATE;
          return (
            <motion.li
              key={row.type}
              className="grid grid-cols-1 gap-3 py-5 sm:grid-cols-[16rem_1fr_7rem] sm:items-center sm:gap-6"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + i * 0.08, duration: 0.5, ease }}
            >
              <div>
                <p className="display text-2xl">{hypothesisLabel(row.type)}</p>
                <p className="num mt-1 text-[11px] text-faint">
                  holds {row.byVerdict.supported.held}/{row.byVerdict.supported.filed} · partly{" "}
                  {row.byVerdict.partial.held}/{row.byVerdict.partial.filed} · weak {row.byVerdict.weak.held}/
                  {row.byVerdict.weak.filed}
                </p>
              </div>

              <div className="flex h-2 w-full overflow-hidden rounded-full bg-hair" style={{ opacity: few ? 0.55 : 1 }}>
                <motion.div
                  className="h-full"
                  style={{ background: "linear-gradient(90deg, var(--up), color-mix(in oklab, var(--up) 60%, white))" }}
                  initial={{ width: "0%" }}
                  animate={{ width: `${held * 100}%` }}
                  transition={{ delay: 0.35 + i * 0.08, duration: 0.9, ease }}
                />
                <motion.div
                  className="h-full"
                  style={{ background: "linear-gradient(90deg, color-mix(in oklab, var(--down) 70%, black), var(--down))" }}
                  initial={{ width: "0%" }}
                  animate={{ width: `${(1 - held) * 100}%` }}
                  transition={{ delay: 0.45 + i * 0.08, duration: 0.9, ease }}
                />
              </div>

              <p className="num text-sm sm:text-right">
                <span className="text-up">{row.total.held}</span>
                <span className="text-faint"> held · </span>
                <span className="text-down">{row.total.broke}</span>
                <span className="text-faint"> broke</span>
                {few && <span className="block text-[11px] text-faint">too few to judge</span>}
              </p>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}
