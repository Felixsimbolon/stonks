"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { shortDate } from "../format";
import { Legend, Tooltip, useWidth } from "./kit";

export interface TimelineRow {
  key: string; // ticker
  dots: { date: string; ret: number; z: number }[];
}

interface Props {
  dates: string[]; // the shared session axis, ascending
  rows: TimelineRow[];
}

const ROW_H = 34;
const LABEL_W = 64;
const PAD_R = 12;

/**
 * Every flagged move in the watchlist on one axis: a row per ticker, a dot per
 * move, size = how unusual (|σ|), color = direction. Click a dot to open it.
 */
export function DotTimeline({ dates, rows }: Props) {
  const router = useRouter();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ row: string; date: string } | null>(null);
  const height = rows.length * ROW_H + 26;
  const innerW = Math.max(0, width - LABEL_W - PAD_R);
  const idx = new Map(dates.map((d, i) => [d, i]));
  const x = (d: string) => LABEL_W + ((idx.get(d) ?? 0) / Math.max(1, dates.length - 1)) * innerW;
  const r = (z: number) => Math.min(11, 3 + Math.sqrt(Math.abs(z)) * 2.6);

  const hRow = rows.find((row) => row.key === hover?.row);
  const hDot = hRow?.dots.find((d) => d.date === hover?.date);

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Legend
          items={[
            { label: "up move", color: "var(--c-pos)" },
            { label: "down move", color: "var(--c-neg)" },
          ]}
        />
      </div>
      <div ref={ref} className="relative w-full select-none" style={{ height }}>
        {width > 0 && dates.length > 1 && (
          <svg width={width} height={height}>
            {rows.map((row, ri) => {
              const cy = ri * ROW_H + ROW_H / 2;
              return (
                <g key={row.key}>
                  <line x1={LABEL_W} x2={LABEL_W + innerW} y1={cy} y2={cy} stroke="var(--c-grid)" />
                  <text x={0} y={cy + 4} fontSize={12} fill="var(--muted)" className="num">
                    {row.key}
                  </text>
                  {row.dots
                    .filter((d) => idx.has(d.date))
                    .map((d, di) => {
                      const cx = x(d.date);
                      const isHover = hover?.row === row.key && hover.date === d.date;
                      return (
                        <g
                          key={d.date}
                          tabIndex={0}
                          style={{ cursor: "pointer", outline: "none" }}
                          onPointerEnter={() => setHover({ row: row.key, date: d.date })}
                          onPointerLeave={() => setHover(null)}
                          onFocus={() => setHover({ row: row.key, date: d.date })}
                          onBlur={() => setHover(null)}
                          onClick={() => router.push(`/${row.key}?date=${d.date}`)}
                        >
                          <circle cx={cx} cy={cy} r={Math.max(12, r(d.z) + 4)} fill="transparent" />
                          <motion.circle
                            cx={cx}
                            cy={cy}
                            fill={d.ret >= 0 ? "var(--c-pos)" : "var(--c-neg)"}
                            stroke="var(--c-surface)"
                            strokeWidth={2}
                            initial={{ r: 0 }}
                            animate={{ r: isHover ? r(d.z) + 2 : r(d.z) }}
                            transition={{ delay: isHover ? 0 : 0.2 + ri * 0.08 + di * 0.03, type: "spring", stiffness: 380, damping: 18 }}
                          />
                        </g>
                      );
                    })}
                </g>
              );
            })}
            {[0, Math.floor((dates.length - 1) / 2), dates.length - 1].map((i) => (
              <text
                key={i}
                x={LABEL_W + (i / (dates.length - 1)) * innerW}
                y={height - 6}
                fontSize={11}
                fill="var(--c-ink-muted)"
                className="num"
                textAnchor={i === 0 ? "start" : i === dates.length - 1 ? "end" : "middle"}
              >
                {shortDate(dates[i])}
              </text>
            ))}
          </svg>
        )}
        <AnimatePresence>
          {hRow && hDot && (
            <Tooltip
              x={x(hDot.date) + 14}
              y={rows.indexOf(hRow) * ROW_H - 10}
              width={width}
              title={`${hRow.key} · ${shortDate(hDot.date)} · click to investigate`}
              rows={[
                { value: `${hDot.ret >= 0 ? "+" : "−"}${Math.abs(hDot.ret * 100).toFixed(2)}%`, label: "return" },
                { value: `${Math.abs(hDot.z).toFixed(1)}σ`, label: "vs normal (beta-adjusted)" },
              ]}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
