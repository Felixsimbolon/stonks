"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { columnPath, ease, niceTicks, Tooltip, useWidth, type TooltipRow } from "./kit";

export interface Column {
  key: string;
  /** Axis label for this column (dates are shortened by the caller). */
  label: string;
  value: number | null;
  /** Mark color; defaults to the single-series color, or pos/neg when values cross zero. */
  color?: string;
  tooltipTitle?: string;
  tooltip?: TooltipRow[];
}

interface Props {
  columns: Column[];
  format: (v: number) => string;
  height?: number;
  /** Vertical markers at column keys, e.g. "today" or the move day. */
  markers?: { key: string; label: string }[];
  /** A horizontal reference line, e.g. an average. */
  reference?: { value: number; label: string };
  onSelect?: (key: string) => void;
}

const PAD = { top: 16, right: 56, bottom: 26, left: 0 };

/**
 * Vertical columns over an ordered axis (dates, years). Values below zero grow
 * down from a zero baseline; ≤24px thick with a rounded data-end.
 */
export function ColumnChart({ columns, format, height = 180, markers = [], reference, onSelect }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const vals = columns.map((c) => c.value).filter((v): v is number => v !== null);
  const ticks = niceTicks(Math.min(0, ...vals, reference?.value ?? 0), Math.max(0, ...vals, reference?.value ?? 0));
  const lo = ticks[0];
  const hi = ticks.at(-1)!;
  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const y = (v: number) => PAD.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH;
  const slot = columns.length ? innerW / columns.length : 0;
  const barW = Math.max(1, Math.min(24, slot - 2, slot * 0.72));
  const x = (i: number) => PAD.left + i * slot + (slot - barW) / 2;
  const crossesZero = lo < 0;

  const h = hover !== null ? columns[hover] : null;

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} className="overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={PAD.left + innerW}
                y1={y(t)}
                y2={y(t)}
                stroke={t === 0 ? "var(--c-axis)" : "var(--c-grid)"}
                strokeWidth={1}
              />
              <text x={width - PAD.right + 10} y={y(t) + 4} fontSize={11} fill="var(--c-ink-muted)" className="num">
                {format(t)}
              </text>
            </g>
          ))}

          {markers.map((m) => {
            const i = columns.findIndex((c) => c.key === m.key);
            if (i < 0) return null;
            const cx = PAD.left + i * slot + slot / 2;
            return (
              <g key={m.key} pointerEvents="none">
                <line x1={cx} x2={cx} y1={PAD.top - 6} y2={PAD.top + innerH} stroke="var(--muted)" strokeWidth={1} />
                <text x={cx + 4} y={PAD.top - 2} fontSize={10} fill="var(--c-ink-muted)">
                  {m.label}
                </text>
              </g>
            );
          })}

          {columns.map((c, i) => {
            if (c.value === null || c.value === 0) return null;
            const color = c.color ?? (crossesZero ? (c.value >= 0 ? "var(--c-pos)" : "var(--c-neg)") : "var(--c-series)");
            const base = y(0);
            return (
              <motion.g
                key={c.key}
                style={{ transformOrigin: `0px ${base}px` }}
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1, opacity: hover === null || hover === i ? 1 : 0.55 }}
                transition={{ scaleY: { delay: Math.min(0.6, i * 0.012), duration: 0.6, ease }, opacity: { duration: 0.15 } }}
              >
                <path d={columnPath(x(i), base, barW, y(c.value))} fill={color} />
              </motion.g>
            );
          })}

          {reference && (
            <g pointerEvents="none">
              <line
                x1={PAD.left}
                x2={PAD.left + innerW}
                y1={y(reference.value)}
                y2={y(reference.value)}
                stroke="var(--muted)"
                strokeDasharray="4 4"
              />
              <text x={PAD.left + 4} y={y(reference.value) - 5} fontSize={10} fill="var(--c-ink-muted)">
                {reference.label}
              </text>
            </g>
          )}

          {/* x labels: first, middle, last */}
          {columns.length > 0 &&
            [...new Set([0, Math.floor((columns.length - 1) / 2), columns.length - 1])].map((i) => (
              <text
                key={i}
                x={PAD.left + i * slot + slot / 2}
                y={height - 6}
                fontSize={11}
                fill="var(--c-ink-muted)"
                className="num"
                textAnchor={i === 0 ? "start" : i === columns.length - 1 ? "end" : "middle"}
              >
                {columns[i].label}
              </text>
            ))}

          {/* hit targets: the whole slot, taller than the mark */}
          {columns.map((c, i) => (
            <rect
              key={c.key}
              x={PAD.left + i * slot}
              y={PAD.top}
              width={Math.max(slot, 1)}
              height={innerH}
              fill="transparent"
              tabIndex={c.value === null ? -1 : 0}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onClick={() => onSelect?.(c.key)}
              style={{ cursor: onSelect ? "pointer" : "default", outline: "none" }}
            />
          ))}
        </svg>
      )}
      <AnimatePresence>
        {h && h.value !== null && hover !== null && (
          <Tooltip
            x={PAD.left + hover * slot + slot / 2 + 10}
            y={0}
            width={width}
            title={h.tooltipTitle ?? h.label}
            rows={h.tooltip ?? [{ value: format(h.value), label: "" }]}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
