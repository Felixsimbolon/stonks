"use client";

import { AnimatePresence, motion } from "motion/react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { underwaterAt } from "@/lib/mining/analytics";
import type { CostCurveView } from "@/lib/mining/service";
import { BarList } from "../charts/BarList";
import { ChartFrame, columnPath, Legend } from "../charts/kit";
import { shortDate } from "../format";
import { mt, pctShare, usdT } from "./format";

const HEIGHT = 360;
const PAD = { top: 28, right: 72, bottom: 34, left: 0 };
const ease = [0.22, 1, 0.36, 1] as const;

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

export function CostCurve({ view }: { view: CostCurveView }) {
  const { curve, latestPrice } = view;
  const costs = curve.segments.map((s) => s.costPerTon);
  const benchmark = latestPrice?.usdPerTon ?? (costs.length ? costs[Math.floor(costs.length / 2)] : 80);
  const maxY = Math.max(...costs, ...view.prices.map((p) => p.usdPerTon), benchmark) * 1.15;

  const [price, setPrice] = useState(Math.round(benchmark));
  const [hover, setHover] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [ref, width] = useWidth<HTMLDivElement>();

  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const x = (v: number) => PAD.left + (curve.totalMt ? (v / curve.totalMt) * innerW : 0);
  const y = (v: number) => PAD.top + innerH - (v / maxY) * innerH;
  const fromY = (py: number) => Math.max(0, Math.min(maxY, ((PAD.top + innerH - py) / innerH) * maxY));

  const under = useMemo(() => underwaterAt(curve, price), [curve, price]);
  const ticks = Array.from({ length: 5 }, (_, i) => (maxY / 4) * i);

  function onPointer(e: React.PointerEvent<SVGSVGElement>) {
    if (!dragging) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setPrice(Math.round(fromY(e.clientY - rect.top)));
  }

  if (curve.segments.length === 0) {
    return <p className="text-muted">No company has enough data for the curve yet.</p>;
  }

  return (
    <div>
      {/* the readout: what the curve looks like at the chosen price */}
      <div className="mb-8 min-h-[5.5rem]">
        <AnimatePresence mode="wait">
          <motion.p
            key={under.symbols.join(",") || "none"}
            className="display max-w-4xl text-3xl leading-snug sm:text-4xl"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.25 }}
          >
            At <span className="text-stock">{usdT(price)}</span>,{" "}
            {under.mt === 0 ? (
              <>every company on this curve covers its cost of revenue.</>
            ) : (
              <>
                <span className="text-ink">{pctShare(under.share)}</span> of the curve&apos;s volume ({mt(under.mt)}) costs more
                than that per ton: <span className="text-muted">{under.symbols.join(", ")}</span>.
              </>
            )}
          </motion.p>
        </AnimatePresence>
      </div>

      <div ref={ref} className="relative w-full select-none" style={{ height: HEIGHT }}>
        {width > 0 && (
          <svg
            width={width}
            height={HEIGHT}
            className="overflow-visible"
            onPointerMove={onPointer}
            onPointerUp={() => setDragging(false)}
            onPointerLeave={() => setDragging(false)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.left} x2={PAD.left + innerW} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--c-axis)" : "var(--c-grid)"} />
                <text x={width - PAD.right + 12} y={y(t) + 4} fontSize={11} fill="var(--c-ink-muted)" className="num">
                  ${Math.round(t)}
                </text>
              </g>
            ))}

            {curve.segments.map((s, i) => {
              const under = s.costPerTon > price;
              // 2px surface gap between neighbouring companies; width still encodes tons sold.
              const w = Math.max(1, x(s.x1) - x(s.x0) - 2);
              const dim = hover !== null && hover !== s.symbol;
              const base = y(0);
              return (
                <g
                  key={s.slug}
                  onPointerEnter={() => setHover(s.symbol)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(s.symbol)}
                  onBlur={() => setHover(null)}
                  tabIndex={0}
                  style={{ opacity: dim ? 0.35 : 1, transition: "opacity 0.2s", outline: "none" }}
                >
                  <motion.g
                    style={{ transformOrigin: `0px ${base}px` }}
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{ delay: 0.15 + i * 0.07, duration: 0.8, ease }}
                  >
                    <path
                      d={columnPath(x(s.x0) + 1, base, w, y(s.costPerTon))}
                      fill={under ? "var(--c-neg)" : "var(--c-pos)"}
                      fillOpacity={0.85}
                      style={{ transition: "fill 0.25s" }}
                    />
                  </motion.g>
                  {/* hit target: the full column, taller than the mark */}
                  <rect x={x(s.x0)} y={PAD.top} width={w + 2} height={innerH} fill="transparent" />
                  {w > 28 && (
                    <motion.text
                      x={x(s.x0) + 1 + w / 2}
                      y={y(s.costPerTon) - 8}
                      textAnchor="middle"
                      fontSize={11}
                      className="num"
                      fill="var(--ink)"
                      pointerEvents="none"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.6 + i * 0.07 }}
                    >
                      {s.symbol}
                    </motion.text>
                  )}
                </g>
              );
            })}

            {/* x axis: cumulative volume */}
            <text x={PAD.left} y={HEIGHT - 8} fontSize={11} fill="var(--faint)" className="num">
              0
            </text>
            <text x={PAD.left + innerW} y={HEIGHT - 8} fontSize={11} fill="var(--faint)" className="num" textAnchor="end">
              {mt(curve.totalMt)} sold
            </text>

            {/* the latest benchmark, when the chosen price has moved away from it */}
            {latestPrice && Math.abs(latestPrice.usdPerTon - price) > 0.5 && (
              <g pointerEvents="none">
                <line
                  x1={PAD.left}
                  x2={PAD.left + innerW}
                  y1={y(latestPrice.usdPerTon)}
                  y2={y(latestPrice.usdPerTon)}
                  stroke="var(--muted)"
                  strokeDasharray="1 5"
                />
                <text x={PAD.left + 4} y={y(latestPrice.usdPerTon) - 6} fontSize={10} fill="var(--faint)" className="num">
                  benchmark {usdT(latestPrice.usdPerTon)} · {shortDate(latestPrice.date)}
                </text>
              </g>
            )}

            {/* draggable price line */}
            <g style={{ cursor: "ns-resize" }} onPointerDown={() => setDragging(true)}>
              <rect x={PAD.left} y={y(price) - 10} width={innerW + PAD.right} height={20} fill="transparent" />
              <motion.line
                x1={PAD.left}
                x2={PAD.left + innerW}
                stroke="var(--stock)"
                strokeWidth={dragging ? 2 : 1.5}
                strokeDasharray="6 4"
                animate={{ y1: y(price), y2: y(price) }}
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
              />
              <motion.g animate={{ y: y(price) }} transition={{ type: "spring", stiffness: 500, damping: 40 }}>
                <rect x={width - PAD.right + 4} y={-11} width={64} height={22} rx={11} fill="var(--stock)" />
                <text x={width - PAD.right + 36} y={4} fontSize={11} textAnchor="middle" fill="#1a1208" className="num">
                  {usdT(price)}
                </text>
              </motion.g>
            </g>
          </svg>
        )}

        {/* hover detail */}
        <AnimatePresence>
          {hover &&
            (() => {
              const s = curve.segments.find((x) => x.symbol === hover)!;
              return (
                <motion.div
                  className="pointer-events-none absolute left-0 top-0 text-sm"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                >
                  <span className="text-ink">{s.name}</span>
                  <span className="num text-muted">
                    {" "}
                    · cost {usdT(s.costPerTon)} · sells at {usdT(s.aspPerTon)} · {mt(s.salesMt)}
                  </span>
                </motion.div>
              );
            })()}
        </AnimatePresence>
      </div>

      <label className="mt-6 flex items-center gap-4">
        <span className="eyebrow shrink-0">benchmark</span>
        <input
          type="range"
          min={0}
          max={Math.round(maxY)}
          value={price}
          onChange={(e) => setPrice(Number(e.target.value))}
          className="w-full accent-[var(--stock)]"
          aria-label="Coal benchmark price in USD per ton"
        />
        {latestPrice && (
          <button
            type="button"
            onClick={() => setPrice(Math.round(latestPrice.usdPerTon))}
            className="eyebrow shrink-0 underline decoration-hair underline-offset-4 hover:text-ink"
          >
            reset
          </button>
        )}
      </label>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <Legend
          items={[
            { label: "cost per ton at or below the price", color: "var(--c-pos)" },
            { label: "cost per ton above the price", color: "var(--c-neg)" },
          ]}
        />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-faint">
        Drag the line or the slider. Each bar is one company: width = tons sold, height = cost of revenue per ton sold
        (including royalty and freight), from its latest annual mining financials. Information only, not a forecast or a
        recommendation.
      </p>

      {/* headroom at the chosen price: follows the slider */}
      <div className="mt-12">
        <ChartFrame
          title={`Headroom per ton at ${usdT(price)}`}
          subtitle="The chosen price minus each company's cost of revenue per ton · follows the slider"
          table={{
            columns: ["company", "cost / t", "headroom / t"],
            rows: curve.segments.map((s) => [s.symbol, usdT(s.costPerTon), `${price - s.costPerTon >= 0 ? "+" : "−"}${usdT(Math.abs(price - s.costPerTon))}`]),
          }}
        >
          <BarList
            diverging
            items={[...curve.segments]
              .sort((a, b) => a.costPerTon - b.costPerTon)
              .map((s) => {
                const head = price - s.costPerTon;
                return {
                  key: s.slug,
                  label: s.symbol,
                  sublabel: s.name,
                  value: head,
                  display: `${head >= 0 ? "+" : "−"}${usdT(Math.abs(head))}`,
                  href: `/${s.symbol}`,
                };
              })}
          />
        </ChartFrame>
      </div>
    </div>
  );
}
