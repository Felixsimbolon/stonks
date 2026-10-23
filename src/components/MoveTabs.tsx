"use client";

import { motion } from "motion/react";
import Link from "next/link";
import type { MoveSummary } from "@/lib/views";
import { dirColor, pct, shortDate, sigma } from "./format";

export function MoveTabs({ ticker, moves, selected }: { ticker: string; moves: MoveSummary[]; selected: string | null }) {
  return (
    <nav className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0" aria-label="Flagged moves">
      <ul className="flex min-w-max gap-8">
        {[...moves].reverse().map((m, i) => {
          const active = m.date === selected;
          return (
            <motion.li
              key={m.date}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.05 }}
            >
              <Link
                href={`/${ticker}?date=${m.date}`}
                scroll={false}
                className={`relative block pb-3 transition-opacity ${active ? "opacity-100" : "opacity-50 hover:opacity-90"}`}
              >
                <span className="block text-sm text-muted">{shortDate(m.date)}</span>
                <span className="num block text-lg" style={{ color: dirColor(m.ret) }}>
                  {pct(m.ret)}
                </span>
                <span className="num block text-xs text-faint">{sigma(m.abnormalZ)}</span>
                {active && (
                  <motion.span
                    layoutId="move-underline"
                    className="absolute inset-x-0 bottom-0 h-0.5"
                    style={{ background: "linear-gradient(90deg, var(--stock), var(--sector))" }}
                    transition={{ type: "spring", stiffness: 400, damping: 34 }}
                  />
                )}
              </Link>
            </motion.li>
          );
        })}
      </ul>
    </nav>
  );
}
