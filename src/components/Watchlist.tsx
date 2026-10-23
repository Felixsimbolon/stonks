"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useTransition } from "react";
import { removeTicker } from "@/app/actions";
import type { WatchRow } from "@/lib/views";
import { dirColor, pct, price, shortDate, sigma } from "./format";
import { Sparkline } from "./Sparkline";

const ease = [0.22, 1, 0.36, 1] as const;

function Row({ row, index }: { row: WatchRow; index: number }) {
  const [removing, startRemove] = useTransition();
  const latest = row.moves[0];

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: removing ? 0.3 : 1, y: 0 }}
      exit={{ opacity: 0, x: -40, transition: { duration: 0.3 } }}
      transition={{ delay: index * 0.07, duration: 0.6, ease }}
      className="group relative"
    >
      <Link href={`/${row.ticker}`} className="relative block py-7">
        {/* hover wash: a soft gradient sweeping in from the left */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 -left-5 -right-5 origin-left scale-x-0 opacity-0 transition-all duration-500 ease-out group-hover:scale-x-100 group-hover:opacity-100 sm:-left-8 sm:-right-8"
          style={{ background: "linear-gradient(90deg, rgb(255 177 112 / 0.07), rgb(195 155 255 / 0.04) 60%, transparent)" }}
        />

        <div className="relative grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-3 sm:grid-cols-[9rem_1fr_auto_auto]">
          <div>
            <span className="display text-5xl transition-transform duration-500 group-hover:translate-x-2 inline-block">
              {row.ticker}
            </span>
          </div>

          <div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
            {row.error ? (
              <p className="text-sm text-down">{row.error}</p>
            ) : latest ? (
              <p className="text-sm leading-relaxed text-muted">
                <span className="text-ink">{row.moves.length}</span> unusual {row.moves.length === 1 ? "move" : "moves"} in
                20 sessions · latest{" "}
                <span className="num" style={{ color: dirColor(latest.ret) }}>
                  {pct(latest.ret)}
                </span>{" "}
                on {shortDate(latest.date)} <span className="num text-faint">({sigma(latest.abnormalZ)})</span>
              </p>
            ) : (
              <p className="text-sm text-faint">Nothing unusual in the last 20 sessions.</p>
            )}
          </div>

          <div className="hidden md:block">
            <Sparkline prices={row.prices} markers={row.moves.map((m) => m.date)} delay={0.2 + index * 0.07} />
          </div>

          <div className="text-right">
            {row.last !== null && <div className="num text-lg">{price(row.last)}</div>}
            {row.change !== null && (
              <div className="num text-sm" style={{ color: dirColor(row.change) }}>
                {pct(row.change)}
              </div>
            )}
          </div>
        </div>
      </Link>

      <button
        type="button"
        onClick={() => startRemove(() => removeTicker(row.ticker))}
        className="eyebrow absolute -left-1 top-3 opacity-0 transition-opacity duration-300 hover:text-down group-hover:opacity-100 focus:opacity-100"
        aria-label={`Remove ${row.ticker}`}
      >
        remove
      </button>
      <div className="hairline" />
    </motion.li>
  );
}

export function Watchlist({ rows }: { rows: WatchRow[] }) {
  return (
    <ul>
      <AnimatePresence initial>
        {rows.map((row, i) => (
          <Row key={row.ticker} row={row} index={i} />
        ))}
      </AnimatePresence>
    </ul>
  );
}
