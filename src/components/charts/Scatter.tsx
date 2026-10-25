"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { niceTicks, Tooltip, useWidth } from "./kit";

export interface ScatterPoint {
  key: string;
  label: string;
  x: number;
  y: number;
  href?: string;
}

interface Props {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  xFormat: (v: number) => string;
  yFormat: (v: number) => string;
  height?: number;
}

const PAD = { top: 16, right: 56, bottom: 40, left: 8 };

/** One series of labeled dots: 10px marks with a 2px surface ring and a 28px hit area. */
export function Scatter({ points, xLabel, yLabel, xFormat, yFormat, height = 280 }: Props) {
  const router = useRouter();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<string | null>(null);

  const xt = niceTicks(Math.min(0, ...points.map((p) => p.x)), Math.max(...points.map((p) => p.x)));
  const yt = niceTicks(Math.min(0, ...points.map((p) => p.y)), Math.max(...points.map((p) => p.y)));
  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const x = (v: number) => PAD.left + ((v - xt[0]) / (xt.at(-1)! - xt[0] || 1)) * innerW;
  const y = (v: number) => PAD.top + innerH - ((v - yt[0]) / (yt.at(-1)! - yt[0] || 1)) * innerH;
  const h = points.find((p) => p.key === hover);

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} className="overflow-visible">
          {yt.map((t) => (
            <g key={`y${t}`}>
              <line x1={PAD.left} x2={PAD.left + innerW} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--c-axis)" : "var(--c-grid)"} />
              <text x={width - PAD.right + 10} y={y(t) + 4} fontSize={11} fill="var(--c-ink-muted)" className="num">
                {yFormat(t)}
              </text>
            </g>
          ))}
          {xt.map((t) => (
            <text key={`x${t}`} x={x(t)} y={PAD.top + innerH + 16} fontSize={11} fill="var(--c-ink-muted)" className="num" textAnchor="middle">
              {xFormat(t)}
            </text>
          ))}
          <text x={PAD.left + innerW} y={height - 4} fontSize={11} fill="var(--c-ink-muted)" textAnchor="end">
            {xLabel} →
          </text>
          <text x={width - PAD.right + 10} y={PAD.top - 4} fontSize={11} fill="var(--c-ink-muted)">
            ↑ {yLabel}
          </text>

          {points.map((p, i) => (
            <g
              key={p.key}
              onPointerEnter={() => setHover(p.key)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(p.key)}
              onBlur={() => setHover(null)}
              onClick={() => p.href && router.push(p.href)}
              tabIndex={0}
              style={{ cursor: p.href ? "pointer" : "default", outline: "none" }}
            >
              <circle cx={x(p.x)} cy={y(p.y)} r={14} fill="transparent" />
              <motion.circle
                cx={x(p.x)}
                cy={y(p.y)}
                fill="var(--c-series)"
                stroke="var(--c-surface)"
                strokeWidth={2}
                initial={{ r: 0 }}
                animate={{ r: hover === p.key ? 7 : 5, opacity: hover && hover !== p.key ? 0.45 : 1 }}
                transition={{ r: { delay: hover ? 0 : 0.2 + i * 0.06, type: "spring", stiffness: 380, damping: 18 }, opacity: { duration: 0.15 } }}
              />
              <text x={x(p.x) + 9} y={y(p.y) + 4} fontSize={11} fill="var(--muted)" pointerEvents="none">
                {p.label}
              </text>
            </g>
          ))}
        </svg>
      )}
      <AnimatePresence>
        {h && (
          <Tooltip
            x={x(h.x) + 14}
            y={Math.max(0, y(h.y) - 56)}
            width={width}
            title={h.label}
            rows={[
              { value: xFormat(h.x), label: xLabel },
              { value: yFormat(h.y), label: yLabel },
            ]}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
