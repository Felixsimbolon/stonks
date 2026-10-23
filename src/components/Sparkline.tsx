"use client";

import { motion } from "motion/react";
import { useId } from "react";
import type { PricePoint } from "@/lib/views";

interface Props {
  prices: PricePoint[];
  markers?: string[]; // dates to dot
  width?: number;
  height?: number;
  delay?: number;
}

export function Sparkline({ prices, markers = [], width = 220, height = 48, delay = 0 }: Props) {
  const id = useId();
  if (prices.length < 2) return <div style={{ width, height }} />;

  const closes = prices.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const x = (i: number) => (i / (prices.length - 1)) * width;
  const y = (v: number) => height - 4 - ((v - min) / (max - min || 1)) * (height - 8);
  const d = prices.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.close).toFixed(1)}`).join("");
  const rising = closes.at(-1)! >= closes[0];
  const stroke = rising ? "var(--up)" : "var(--down)";

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <defs>
        <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.path
        d={`${d}L${width},${height}L0,${height}Z`}
        fill={`url(#${id}-fill)`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: delay + 0.5, duration: 0.8 }}
      />
      <motion.path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ delay, duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
      />
      {prices.map((p, i) =>
        markers.includes(p.date) ? (
          <motion.circle
            key={p.date}
            cx={x(i)}
            cy={y(p.close)}
            r={2.5}
            fill="var(--stock)"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: delay + 1, type: "spring", stiffness: 400, damping: 15 }}
          />
        ) : null,
      )}
    </svg>
  );
}
