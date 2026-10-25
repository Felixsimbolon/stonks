"use client";

import { AnimatePresence, motion } from "motion/react";
import { useLayoutEffect, useRef, useState } from "react";

// Shared chart chrome: measuring, the frame (title, legend, chart/table toggle),
// tooltips, and stat tiles. Marks follow the dataviz spec: thin marks, 4px
// rounded data-ends square at the baseline, 2px surface gaps/rings, solid
// hairline grid, text in text tokens (never the series color).

export const ease = [0.22, 1, 0.36, 1] as const;

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(() => setWidth(el.getBoundingClientRect().width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A bar path with a 4px rounded data-end and a square baseline. Works for up and down bars. */
export function columnPath(x: number, yBase: number, w: number, yEnd: number, r = 4): string {
  const h = Math.abs(yEnd - yBase);
  const rr = Math.min(r, w / 2, h);
  if (h === 0) return "";
  if (yEnd < yBase) {
    // grows upward: round the top
    return `M${x},${yBase}V${yEnd + rr}Q${x},${yEnd} ${x + rr},${yEnd}H${x + w - rr}Q${x + w},${yEnd} ${x + w},${yEnd + rr}V${yBase}Z`;
  }
  // grows downward: round the bottom
  return `M${x},${yBase}V${yEnd - rr}Q${x},${yEnd} ${x + rr},${yEnd}H${x + w - rr}Q${x + w},${yEnd} ${x + w},${yEnd - rr}V${yBase}Z`;
}

/** Clean axis ticks: 0 and round steps up to the max (and down to the min, if negative). */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) ticks.push(Number(v.toPrecision(12)));
  if (ticks.at(-1)! < hi) ticks.push(ticks.at(-1)! + step);
  return ticks;
}

/** 1,284 / 12.9K / 4.2M / 1.3B */
export function compact(x: number, digits = 1): string {
  const a = Math.abs(x);
  const sign = x < 0 ? "−" : "";
  if (a >= 1e12) return `${sign}${(a / 1e12).toFixed(digits)}T`;
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(digits)}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(digits)}K`;
  return `${sign}${a.toFixed(a < 10 && a % 1 !== 0 ? 1 : 0)}`;
}

export interface LegendItem {
  label: string;
  color: string;
  kind?: "rect" | "line";
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-2 text-xs text-muted">
          {it.kind === "line" ? (
            <span className="block h-0.5 w-4 rounded-full" style={{ background: it.color }} />
          ) : (
            <span className="block h-2.5 w-2.5 rounded-[3px]" style={{ background: it.color }} />
          )}
          {it.label}
        </li>
      ))}
    </ul>
  );
}

export interface TableData {
  columns: string[];
  rows: (string | number)[][];
}

/**
 * Title + optional legend + the chart, with a table-view twin one click away
 * (every value reachable without hovering).
 */
export function ChartFrame({
  title,
  subtitle,
  legend,
  table,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  legend?: LegendItem[];
  table: TableData;
  children: React.ReactNode;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className={className}>
      <figcaption className="mb-4 flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div>
          <p className="text-sm text-ink">{title}</p>
          {subtitle && <p className="mt-0.5 text-xs text-faint">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-5">
          {legend && legend.length >= 2 && <Legend items={legend} />}
          <button
            type="button"
            onClick={() => setAsTable((v) => !v)}
            className="eyebrow underline decoration-hair underline-offset-4 transition-colors hover:text-ink"
            aria-pressed={asTable}
          >
            {asTable ? "chart" : "table"}
          </button>
        </div>
      </figcaption>
      <AnimatePresence mode="wait" initial={false}>
        {asTable ? (
          <motion.div key="table" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="eyebrow">
                  {table.columns.map((c, i) => (
                    <th key={c} className={`pb-3 font-normal ${i > 0 ? "text-right" : ""}`}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i} className="border-t border-hair">
                    {r.map((cell, j) => (
                      <td key={j} className={`py-2 ${j > 0 ? "num text-right" : "text-muted"}`}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        ) : (
          <motion.div key="chart" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </figure>
  );
}

export interface TooltipRow {
  value: string;
  label: string;
  color?: string;
}

/** Values lead, labels follow; series keyed with a short line, not a box. */
export function Tooltip({ x, y, title, rows, width }: { x: number; y: number; title: string; rows: TooltipRow[]; width: number }) {
  const left = Math.min(Math.max(x, 8), Math.max(8, width - 200));
  return (
    <motion.div
      className="pointer-events-none absolute z-10 min-w-36 rounded-md border border-hair bg-[#121117]/95 px-3 py-2 shadow-lg backdrop-blur"
      style={{ left, top: Math.max(0, y) }}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
    >
      <p className="mb-1 text-[11px] text-faint">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2 text-xs">
          {r.color && <span className="block h-0.5 w-3 shrink-0 rounded-full" style={{ background: r.color }} />}
          <span className="num font-medium text-ink">{r.value}</span>
          <span className="text-muted">{r.label}</span>
        </p>
      ))}
    </motion.div>
  );
}

/** A label + a big sans value (proportional figures) + optional note. */
export function StatTile({ label, value, note, delay = 0 }: { label: string; value: string; note?: string; delay?: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.5, ease }}>
      <p className="text-xs text-faint">{label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-ink">{value}</p>
      {note && <p className="mt-1 text-xs text-muted">{note}</p>}
    </motion.div>
  );
}

export function KpiRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">{children}</div>;
}
