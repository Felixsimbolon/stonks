"use client";

import type { WatchRow } from "@/lib/views";
import { ChartFrame } from "./charts/kit";
import { DotTimeline } from "./charts/DotTimeline";
import { pct } from "./format";

/** Every flagged move in the watchlist over the last 60 sessions, on one axis. */
export function WatchTimeline({ rows }: { rows: WatchRow[] }) {
  const withData = rows.filter((r) => r.prices.length > 1);
  if (withData.length === 0) return null;
  // Shared axis: the union of the tickers' last 60 session dates.
  const dates = [...new Set(withData.flatMap((r) => r.prices.map((p) => p.date)))].sort().slice(-60);
  const all = withData.flatMap((r) => r.moves60.map((m) => ({ ticker: r.ticker, ...m })));

  return (
    <ChartFrame
      title="Unusual moves across the watchlist"
      subtitle="Last 60 sessions · dot size: how unusual (σ, beta-adjusted) · click a dot to investigate"
      table={{
        columns: ["ticker", "date", "return", "σ"],
        rows: all
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((m) => [m.ticker, m.date, pct(m.ret), `${m.abnormalZ.toFixed(1)}σ`]),
      }}
    >
      <DotTimeline
        dates={dates}
        rows={withData.map((r) => ({ key: r.ticker, dots: r.moves60.map((m) => ({ date: m.date, ret: m.ret, z: m.abnormalZ })) }))}
      />
    </ChartFrame>
  );
}
