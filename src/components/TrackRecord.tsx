"use client";

import { motion } from "motion/react";
import { hypothesisLabel, MIN_CASES_FOR_RATE, type Tally, type TrackRow } from "@/lib/casebook/logic";
import { BarList } from "./charts/BarList";
import { ChartFrame, ease } from "./charts/kit";
import { StackedBars } from "./charts/StackedBars";

const rate = (t: Tally) => (t.filed ? t.held / t.filed : null);
const rateText = (t: Tally) => (t.filed ? `${Math.round((t.held / t.filed) * 100)}% · ${t.filed}` : "no cases");

const OUTCOME = [
  { key: "held", label: "held", color: "var(--c-pos)" },
  { key: "broke", label: "broke", color: "var(--c-neg)" },
];

export function TrackRecord({ rows, headline }: { rows: TrackRow[]; headline: Tally }) {
  if (rows.length === 0) {
    return (
      <p className="max-w-2xl text-muted">
        No closed cases yet. File cases from an investigation, update prices as new sessions come in, and check them.
        Once a case&apos;s conditions all resolve, it lands here.
      </p>
    );
  }

  // Calibration: does a stronger verdict hold more often?
  const levels = (["supported", "partial", "weak"] as const).map((v) => ({
    key: v,
    label: v === "supported" ? "holds" : v === "partial" ? "partly holds" : "weak",
    tally: rows.reduce<Tally>(
      (a, r) => ({ filed: a.filed + r.byVerdict[v].filed, held: a.held + r.byVerdict[v].held, broke: a.broke + r.byVerdict[v].broke }),
      { filed: 0, held: 0, broke: 0 },
    ),
  }));

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

      <div className="mt-12 grid gap-14 lg:grid-cols-[1fr_1.4fr]">
        <ChartFrame
          title="Calibration: hold rate by verdict"
          subtitle="A well-calibrated engine's “holds” calls survive more often than its “weak” ones · value: hold rate · cases"
          table={{
            columns: ["verdict", "filed", "held", "broke", "hold rate"],
            rows: levels.map((l) => [l.label, l.tally.filed, l.tally.held, l.tally.broke, rate(l.tally) === null ? "—" : `${Math.round(rate(l.tally)! * 100)}%`]),
          }}
        >
          <BarList
            items={levels.map((l) => ({
              key: l.key,
              label: l.label,
              sublabel: l.tally.filed < MIN_CASES_FOR_RATE ? "too few to judge" : undefined,
              value: rate(l.tally),
              display: rateText(l.tally),
            }))}
          />
        </ChartFrame>

        <ChartFrame
          title="Track record by explanation"
          subtitle="Closed cases where the explanation was standing when filed · bar length: number of cases"
          legend={OUTCOME.map((o) => ({ label: o.label, color: o.color }))}
          table={{
            columns: ["explanation", "filed", "held", "broke", "holds", "partly", "weak"],
            rows: rows.map((r) => [
              hypothesisLabel(r.type),
              r.total.filed,
              r.total.held,
              r.total.broke,
              `${r.byVerdict.supported.held}/${r.byVerdict.supported.filed}`,
              `${r.byVerdict.partial.held}/${r.byVerdict.partial.filed}`,
              `${r.byVerdict.weak.held}/${r.byVerdict.weak.filed}`,
            ]),
          }}
        >
          <StackedBars
            mode="absolute"
            format={(v) => String(v)}
            categories={OUTCOME}
            rows={rows.map((r) => ({
              key: r.type,
              label: hypothesisLabel(r.type),
              sublabel: r.total.filed < MIN_CASES_FOR_RATE ? "too few to judge" : undefined,
              values: { held: r.total.held, broke: r.total.broke },
              total: `${Math.round((r.total.held / r.total.filed) * 100)}% held`,
            }))}
          />
        </ChartFrame>
      </div>
    </div>
  );
}
