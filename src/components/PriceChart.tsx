"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { MoveSummary, PricePoint } from "@/lib/views";
import { dirColor, pct, price, shortDate } from "./format";

const HEIGHT = 300;
const PAD = { top: 24, right: 64, bottom: 28, left: 0 };

function useWidth<T extends HTMLElement>() {
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

interface Props {
  ticker: string;
  prices: PricePoint[];
  moves: MoveSummary[];
  selected: string | null;
}

export function PriceChart({ ticker, prices, moves, selected }: Props) {
  const id = useId();
  const router = useRouter();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const closes = prices.map((p) => p.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (i / Math.max(1, prices.length - 1)) * innerW;
  const y = (v: number) => PAD.top + innerH - ((v - min) / (max - min || 1)) * innerH;

  const line = prices.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.close).toFixed(1)}`).join("");
  const area = `${line}L${x(prices.length - 1)},${PAD.top + innerH}L${x(0)},${PAD.top + innerH}Z`;
  const ticks = Array.from({ length: 4 }, (_, k) => min + ((max - min) * k) / 3);
  const indexOf = new Map(prices.map((p, i) => [p.date, i]));
  const moveByDate = new Map(moves.map((m) => [m.date, m]));

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - rect.left) / rect.width;
    setHover(Math.round(Math.min(1, Math.max(0, rel)) * (prices.length - 1)));
  }

  const select = (date: string) => router.push(`/${ticker}?date=${date}`, { scroll: false });
  const hp = hover !== null ? prices[hover] : null;
  const hoverMove = hp ? moveByDate.get(hp.date) : undefined;

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height: HEIGHT }}>
      {width > 0 && prices.length > 1 && (
        <svg width={width} height={HEIGHT} className="overflow-visible">
          <defs>
            <linearGradient id={`${id}-area`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#ffb170" stopOpacity="0.22" />
              <stop offset="60%" stopColor="#c39bff" stopOpacity="0.06" />
              <stop offset="100%" stopColor="#86a8ff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${id}-line`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#86a8ff" />
              <stop offset="55%" stopColor="#c39bff" />
              <stop offset="100%" stopColor="#ffb170" />
            </linearGradient>
          </defs>

          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={PAD.left + innerW} y1={y(t)} y2={y(t)} stroke="var(--hair)" />
              <text x={width - PAD.right + 12} y={y(t) + 4} className="num" fontSize={11} fill="var(--faint)">
                {price(t)}
              </text>
            </g>
          ))}

          {[0, Math.floor((prices.length - 1) / 2), prices.length - 1].map((i) => (
            <text
              key={i}
              x={x(i)}
              y={HEIGHT - 6}
              fontSize={11}
              fill="var(--faint)"
              className="num"
              textAnchor={i === 0 ? "start" : i === prices.length - 1 ? "end" : "middle"}
            >
              {shortDate(prices[i].date)}
            </text>
          ))}

          <motion.path
            key={`${ticker}-area`}
            d={area}
            fill={`url(#${id}-area)`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 1 }}
          />
          <motion.path
            key={`${ticker}-line`}
            d={line}
            fill="none"
            stroke={`url(#${id}-line)`}
            strokeWidth={1.75}
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}
          />

          <rect
            x={PAD.left}
            y={PAD.top}
            width={innerW}
            height={innerH}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            onClick={() => hoverMove && select(hoverMove.date)}
            style={{ cursor: hoverMove ? "pointer" : "crosshair" }}
          />

          {/* flagged moves (above the hover layer so they stay clickable) */}
          {moves.map((m, k) => {
            const i = indexOf.get(m.date);
            if (i === undefined) return null;
            const cx = x(i);
            const cy = y(prices[i].close);
            const isSel = m.date === selected;
            const color = dirColor(m.ret);
            return (
              <g key={m.date} className="cursor-pointer" onClick={() => select(m.date)}>
                <motion.line
                  x1={cx}
                  x2={cx}
                  y1={cy}
                  y2={PAD.top + innerH}
                  stroke={color}
                  strokeOpacity={isSel ? 0.6 : 0.2}
                  strokeDasharray="2 4"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ delay: 1.2 + k * 0.05, duration: 0.5 }}
                />
                {isSel && (
                  <motion.circle
                    cx={cx}
                    cy={cy}
                    r={7}
                    fill="none"
                    stroke={color}
                    initial={{ scale: 1, opacity: 0.8 }}
                    animate={{ scale: 2.6, opacity: 0 }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
                    style={{ transformOrigin: `${cx}px ${cy}px` }}
                  />
                )}
                <motion.circle
                  cx={cx}
                  cy={cy}
                  fill={isSel ? color : "var(--bg)"}
                  stroke={color}
                  strokeWidth={1.5}
                  initial={{ r: 0 }}
                  animate={{ r: isSel ? 6 : 4 }}
                  whileHover={{ r: 7 }}
                  transition={{ delay: isSel ? 0 : 1.2 + k * 0.05, type: "spring", stiffness: 380, damping: 18 }}
                />
                <circle cx={cx} cy={cy} r={14} fill="transparent" />
              </g>
            );
          })}

          {/* crosshair */}
          {hp && hover !== null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--faint)" strokeWidth={1} />
              <circle cx={x(hover)} cy={y(hp.close)} r={3.5} fill="var(--ink)" />
            </g>
          )}

        </svg>
      )}

      <AnimatePresence>
        {hp && hover !== null && (
          <motion.div
            className="pointer-events-none absolute top-0 whitespace-nowrap text-xs"
            style={{ left: Math.min(Math.max(x(hover), 50), width - PAD.right - 50), translateX: "-50%" }}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <span className="num text-muted">{shortDate(hp.date)}</span>{" "}
            <span className="num text-ink">{price(hp.close)}</span>
            {hoverMove && (
              <span className="num" style={{ color: dirColor(hoverMove.ret) }}>
                {" "}
                {pct(hoverMove.ret)} · click to investigate
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
