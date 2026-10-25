"use client";

import { AnimatePresence, motion } from "motion/react";
import { useId, useState } from "react";
import { ease, niceTicks, Tooltip, useWidth } from "./kit";

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
}

interface Props {
  /** One label per x position, shared by every series. */
  xs: string[];
  series: LineSeries[];
  format: (v: number) => string;
  height?: number;
  /** Threshold lines (dashed: they mean "a limit", not grid). */
  thresholds?: { value: number; label: string }[];
  /** A wash under a single series. */
  area?: boolean;
  /** Highlight one x position (e.g. the move day). */
  markIndex?: number;
  markLabel?: string;
}

const PAD = { top: 18, right: 60, bottom: 26, left: 0 };

/** 2px lines, crosshair that snaps to the nearest x, one tooltip listing every series. */
export function LineChart({ xs, series, format, height = 200, thresholds = [], area = false, markIndex, markLabel }: Props) {
  const id = useId();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const thr = thresholds.map((t) => t.value);
  const dataMin = Math.min(...all, ...thr);
  const dataMax = Math.max(...all, ...thr);
  // Start at zero only when the data is near it; prices shouldn't be squashed against a zero floor.
  const includeZero = dataMin <= 0 || dataMin < dataMax * 0.25;
  const ticks = includeZero ? niceTicks(dataMin, dataMax) : niceRange(dataMin, dataMax);
  const lo = ticks[0];
  const hi = ticks.at(-1)!;
  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (xs.length > 1 ? (i / (xs.length - 1)) * innerW : innerW / 2);
  const y = (v: number) => PAD.top + innerH - ((v - lo) / (hi - lo || 1)) * innerH;

  const pathOf = (vals: (number | null)[]) => {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    setHover(Math.round(Math.min(1, Math.max(0, rel)) * (xs.length - 1)));
  }

  // End labels only for ≤3 series, and only when they don't collide.
  const ends = series
    .map((s) => {
      const i = s.values.findLastIndex((v) => v !== null);
      return i < 0 ? null : { s, i, v: s.values[i]! };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);
  const endYs = ends.map((e) => y(e.v)).sort((a, b) => a - b);
  const endLabels = series.length <= 3 && endYs.every((v, i) => i === 0 || v - endYs[i - 1] > 13);

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {width > 0 && xs.length > 0 && (
        <svg width={width} height={height} className="overflow-visible">
          <defs>
            {area && series[0] && (
              <linearGradient id={`${id}-wash`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={series[0].color} stopOpacity="0.14" />
                <stop offset="100%" stopColor={series[0].color} stopOpacity="0" />
              </linearGradient>
            )}
          </defs>

          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + innerW} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--c-axis)" : "var(--c-grid)"} />
              <text x={width - PAD.right + 10} y={y(t) + 4} fontSize={11} fill="var(--c-ink-muted)" className="num">
                {format(t)}
              </text>
            </g>
          ))}

          {markIndex !== undefined && markIndex >= 0 && (
            <g pointerEvents="none">
              <line x1={x(markIndex)} x2={x(markIndex)} y1={PAD.top - 4} y2={PAD.top + innerH} stroke="var(--muted)" />
              {markLabel && (
                <text x={x(markIndex) + 4} y={PAD.top - 6} fontSize={10} fill="var(--c-ink-muted)">
                  {markLabel}
                </text>
              )}
            </g>
          )}

          {thresholds.map((t) => (
            <g key={t.label} pointerEvents="none">
              <line x1={PAD.left} x2={PAD.left + innerW} y1={y(t.value)} y2={y(t.value)} stroke="var(--c-neg)" strokeOpacity={0.7} strokeDasharray="5 4" />
              <text x={PAD.left + 4} y={y(t.value) - 5} fontSize={10} fill="var(--c-ink-muted)">
                {t.label}
              </text>
            </g>
          ))}

          {area && series[0] && (
            <motion.path
              d={`${pathOf(series[0].values)}L${x(series[0].values.findLastIndex((v) => v !== null))},${y(lo)}L${x(series[0].values.findIndex((v) => v !== null))},${y(lo)}Z`}
              fill={`url(#${id}-wash)`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5, duration: 0.8 }}
            />
          )}

          {series.map((s, k) => (
            <motion.path
              key={s.key}
              d={pathOf(s.values)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ delay: k * 0.15, duration: 1.1, ease }}
            />
          ))}

          {/* end dots with a 2px surface ring, plus end labels when they fit */}
          {ends.map((e) => (
            <g key={e.s.key} pointerEvents="none">
              <motion.circle
                cx={x(e.i)}
                cy={y(e.v)}
                r={4}
                fill={e.s.color}
                stroke="var(--c-surface)"
                strokeWidth={2}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 1, type: "spring", stiffness: 400, damping: 18 }}
                style={{ transformOrigin: `${x(e.i)}px ${y(e.v)}px` }}
              />
            </g>
          ))}

          {/* crosshair */}
          {hover !== null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--c-ink-muted)" strokeWidth={1} />
              {series.map((s) =>
                s.values[hover] !== null && s.values[hover] !== undefined ? (
                  <circle key={s.key} cx={x(hover)} cy={y(s.values[hover]!)} r={4} fill={s.color} stroke="var(--c-surface)" strokeWidth={2} />
                ) : null,
              )}
            </g>
          )}

          {xs.length > 0 &&
            [...new Set([0, Math.floor((xs.length - 1) / 2), xs.length - 1])].map((i) => (
              <text
                key={i}
                x={x(i)}
                y={height - 6}
                fontSize={11}
                fill="var(--c-ink-muted)"
                className="num"
                textAnchor={i === 0 ? "start" : i === xs.length - 1 ? "end" : "middle"}
              >
                {xs[i]}
              </text>
            ))}

          <rect
            x={PAD.left}
            y={PAD.top}
            width={innerW}
            height={innerH}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
      )}

      {endLabels && width > 0 && series.length > 1 && (
        <div className="pointer-events-none absolute inset-0">
          {ends.map((e) => (
            <span
              key={e.s.key}
              className="absolute whitespace-nowrap text-[11px] text-muted"
              style={{ left: x(e.i) + 8, top: y(e.v) - 8 }}
            >
              {e.s.label}
            </span>
          ))}
        </div>
      )}

      <AnimatePresence>
        {hover !== null && (
          <Tooltip
            x={x(hover) + 12}
            y={0}
            width={width}
            title={xs[hover]}
            rows={series
              .filter((s) => s.values[hover] !== null && s.values[hover] !== undefined)
              .map((s) => ({ value: format(s.values[hover]!), label: s.label, color: s.color }))}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Ticks spanning [min, max] without forcing zero in. */
function niceRange(min: number, max: number, count = 4): number[] {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.001 || out.length < 2; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}
