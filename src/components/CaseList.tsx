"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { hypothesisLabel } from "@/lib/casebook/logic";
import type { CaseView } from "@/lib/casebook/store";
import { dirColor, pct, shortDate } from "./format";

const ease = [0.22, 1, 0.36, 1] as const;

function Outcome({ c }: { c: CaseView }) {
  if (c.status === "open") {
    const watching = c.falsifiers.filter((f) => f.status === "pending").length;
    return (
      <span className="text-sm text-muted">
        open · watching {watching} condition{watching === 1 ? "" : "s"}
      </span>
    );
  }
  const entries = Object.entries(c.outcomes);
  if (entries.length === 0) return <span className="text-sm text-faint">closed · nothing was standing</span>;
  return (
    <span className="text-sm">
      {entries.map(([type, o], i) => (
        <span key={type}>
          {i > 0 && <span className="text-faint"> · </span>}
          <span className="text-muted">{hypothesisLabel(type as CaseView["hypotheses"][number]["type"])}</span>{" "}
          <span style={{ color: o === "held" ? "var(--up)" : o === "broke" ? "var(--down)" : "var(--faint)" }}>{o}</span>
        </span>
      ))}
    </span>
  );
}

export function CaseList({ cases }: { cases: CaseView[] }) {
  return (
    <ul>
      {cases.map((c, i) => (
        <motion.li
          key={c.id}
          className="group relative"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 + i * 0.05, duration: 0.5, ease }}
        >
          <Link
            href={`/${c.ticker}?date=${c.moveDate}`}
            className="relative grid grid-cols-[5.5rem_1fr] items-baseline gap-x-6 gap-y-1 py-6 sm:grid-cols-[7rem_7rem_1fr_auto]"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 -left-5 -right-5 origin-left scale-x-0 opacity-0 transition-all duration-500 group-hover:scale-x-100 group-hover:opacity-100"
              style={{ background: "linear-gradient(90deg, rgb(195 155 255 / 0.07), transparent)" }}
            />
            <span className="display relative text-3xl transition-transform duration-500 group-hover:translate-x-1">{c.ticker}</span>
            <span className="relative">
              <span className="num block text-sm" style={{ color: dirColor(c.ret) }}>
                {pct(c.ret)}
              </span>
              <span className="num block text-xs text-faint">{shortDate(c.moveDate)}</span>
            </span>
            <span className="relative col-span-2 sm:col-span-1">
              <span className="block text-sm text-ink">
                {c.lead ? hypothesisLabel(c.lead.type) : "No tested explanation fit"}
                <span className="text-faint"> · filed {shortDate(c.filedOn)}</span>
              </span>
              <Outcome c={c} />
            </span>
            <span className="eyebrow relative hidden transition-transform duration-300 group-hover:translate-x-1 sm:block">open →</span>
          </Link>
          <div className="hairline" />
        </motion.li>
      ))}
    </ul>
  );
}
