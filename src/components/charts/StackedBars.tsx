"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { ease } from "./kit";

export interface StackCategory {
  key: string;
  label: string;
  color: string;
  /** Text color for a label set inside this fill (white, or near-black on light fills). */
  ink?: string;
}

export interface StackRow {
  key: string;
  label: string;
  sublabel?: string;
  values: Record<string, number>;
  /** Shown at the end of the row. */
  total: string;
  href?: string;
}

interface Props {
  categories: StackCategory[];
  rows: StackRow[];
  /** "share": every row fills the track (parts of a whole). "absolute": lengths compare across rows. */
  mode: "share" | "absolute";
  format: (v: number) => string;
}

/**
 * Horizontal stacked bars with a 2px surface gap between segments, a rounded
 * data-end, inside labels only where they fit, and a per-segment tooltip.
 */
export function StackedBars({ categories, rows, mode, format }: Props) {
  const [hover, setHover] = useState<{ row: string; cat: string } | null>(null);
  const totals = rows.map((r) => categories.reduce((a, c) => a + Math.max(0, r.values[c.key] ?? 0), 0));
  const maxTotal = Math.max(...totals, 0) || 1;

  return (
    <ul className="space-y-1.5">
      {rows.map((r, i) => {
        const total = totals[i] || 1;
        const scale = mode === "share" ? 1 : totals[i] / maxTotal;
        const segs = categories.filter((c) => (r.values[c.key] ?? 0) > 0);
        const label = (
          <>
            <span className="block truncate text-sm text-muted">{r.label}</span>
            {r.sublabel && <span className="block truncate text-[11px] text-faint">{r.sublabel}</span>}
          </>
        );
        return (
          <li key={r.key} className="grid grid-cols-[7.5rem_1fr_5.5rem] items-center gap-3 py-1 sm:grid-cols-[10rem_1fr_6.5rem]">
            {r.href ? (
              <Link href={r.href} className="min-w-0 hover:text-ink">
                {label}
              </Link>
            ) : (
              <span className="min-w-0">{label}</span>
            )}
            <div className="relative">
              <motion.div
                className="flex h-4 gap-[2px] overflow-visible"
                initial={{ width: 0 }}
                animate={{ width: `${scale * 100}%` }}
                transition={{ delay: 0.1 + i * 0.05, duration: 0.8, ease }}
              >
                {segs.map((c, k) => {
                  const v = r.values[c.key];
                  const share = v / total;
                  const last = k === segs.length - 1;
                  const isHover = hover?.row === r.key && hover.cat === c.key;
                  return (
                    <span
                      key={c.key}
                      className="relative flex h-full items-center justify-center text-[10px] transition-[filter]"
                      style={{
                        flexGrow: share,
                        flexBasis: 0,
                        background: c.color,
                        borderRadius: last ? "0 4px 4px 0" : 0,
                        filter: isHover ? "brightness(1.25)" : hover && hover.row === r.key ? "brightness(0.8)" : undefined,
                      }}
                      tabIndex={0}
                      onPointerEnter={() => setHover({ row: r.key, cat: c.key })}
                      onPointerLeave={() => setHover(null)}
                      onFocus={() => setHover({ row: r.key, cat: c.key })}
                      onBlur={() => setHover(null)}
                    >
                      {share * scale >= 0.16 && (
                        <span className="num pointer-events-none" style={{ color: c.ink ?? "#ffffff" }}>
                          {mode === "share" ? `${Math.round(share * 100)}%` : format(v)}
                        </span>
                      )}
                      <AnimatePresence>
                        {isHover && (
                          <motion.span
                            className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-hair bg-[#121117]/95 px-2.5 py-1.5 text-xs shadow-lg"
                            initial={{ opacity: 0, y: 3 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.12 }}
                          >
                            <span className="num font-medium text-ink">
                              {format(v)}
                              {mode === "share" ? "" : ` · ${Math.round(share * 100)}%`}
                            </span>{" "}
                            <span className="text-muted">{c.label}</span>
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </span>
                  );
                })}
              </motion.div>
            </div>
            <span className="num text-right text-sm text-ink">{r.total}</span>
          </li>
        );
      })}
    </ul>
  );
}
