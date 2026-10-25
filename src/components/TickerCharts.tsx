"use client";

import { useRouter } from "next/navigation";
import type { FlowPoint } from "@/lib/engine";
import type { MoveDriver, VolumePoint } from "@/lib/views";
import { ChartFrame, compact } from "./charts/kit";
import { ColumnChart } from "./charts/ColumnChart";
import { StackedBars } from "./charts/StackedBars";
import { pct, shortDate } from "./format";

export const MOVE_PARTS = [
  { key: "market", label: "Market", color: "var(--c-market)" },
  { key: "sector", label: "Sector", color: "var(--c-sector)" },
  { key: "stockSpecific", label: "Stock-specific", color: "var(--c-stock)" },
] as const;

export function VolumeChart({ ticker, volumes, selected }: { ticker: string; volumes: VolumePoint[]; selected: string | null }) {
  const router = useRouter();
  if (volumes.length === 0) return null;
  const avg = volumes.slice(-21, -1).reduce((a, v) => a + v.volume, 0) / Math.max(1, Math.min(20, volumes.length - 1));
  return (
    <ChartFrame
      title="Volume"
      subtitle="Shares traded per session · flagged sessions highlighted · dashed: 20-session average"
      legend={[
        { label: "flagged session", color: "var(--c-series)" },
        { label: "other sessions", color: "var(--c-dim)" },
      ]}
      table={{
        columns: ["date", "volume", "flagged"],
        rows: [...volumes].reverse().map((v) => [v.date, compact(v.volume), v.flagged ? "yes" : ""]),
      }}
    >
      <ColumnChart
        height={140}
        format={(v) => compact(v, 0)}
        reference={{ value: avg, label: `20-session avg ${compact(avg)}` }}
        markers={selected ? [{ key: selected, label: "selected move" }] : []}
        onSelect={(key) => volumes.find((v) => v.date === key)?.flagged && router.push(`/${ticker}?date=${key}`, { scroll: false })}
        columns={volumes.map((v) => ({
          key: v.date,
          label: shortDate(v.date),
          value: v.volume,
          color: v.flagged ? "var(--c-series)" : "var(--c-dim)",
          tooltipTitle: `${shortDate(v.date)}${v.flagged ? " · flagged, click to open" : ""}`,
          tooltip: [{ value: compact(v.volume), label: "shares", color: v.flagged ? "var(--c-series)" : "var(--c-dim)" }],
        }))}
      />
    </ChartFrame>
  );
}

export function FlowChart({ flows }: { flows: FlowPoint[] }) {
  const pts = flows.filter((f) => f.net !== null);
  if (pts.length === 0) return null;
  const total = pts.reduce((a, f) => a + f.net!, 0);
  return (
    <ChartFrame
      title="Net foreign flow"
      subtitle={`IDR per session · above zero: foreigners net bought · total ${total >= 0 ? "+" : ""}${compact(total)}`}
      legend={[
        { label: "net buy", color: "var(--c-pos)" },
        { label: "net sell", color: "var(--c-neg)" },
      ]}
      table={{
        columns: ["date", "net (IDR)", "foreign share of value"],
        rows: [...pts].reverse().map((f) => [f.date, compact(f.net!), f.foreignShare !== null ? `${Math.round(f.foreignShare * 100)}%` : "—"]),
      }}
    >
      <ColumnChart
        height={170}
        format={(v) => compact(v, 0)}
        columns={pts.map((f) => ({
          key: f.date,
          label: shortDate(f.date),
          value: f.net,
          tooltipTitle: shortDate(f.date),
          tooltip: [
            { value: `${f.net! >= 0 ? "+" : ""}IDR ${compact(f.net!)}`, label: f.net! >= 0 ? "net buy" : "net sell", color: f.net! >= 0 ? "var(--c-pos)" : "var(--c-neg)" },
            ...(f.foreignShare !== null ? [{ value: `${Math.round(f.foreignShare * 100)}%`, label: "of value traded" }] : []),
          ],
        }))}
      />
    </ChartFrame>
  );
}

export function DriversChart({ ticker, drivers }: { ticker: string; drivers: MoveDriver[] }) {
  if (drivers.length === 0) return null;
  const noSector = drivers.some((d) => !d.sectorAvailable);
  return (
    <ChartFrame
      title="What drove each unusual move"
      subtitle={`Share of each move from the market, the sector, and the stock itself${noSector ? " · without peer data, sector folds into stock-specific" : ""}`}
      legend={MOVE_PARTS.map((p) => ({ label: p.label, color: p.color }))}
      table={{
        columns: ["move", "return", "market", "sector", "stock-specific"],
        rows: [...drivers]
          .reverse()
          .map((d) => [d.date, pct(d.ret), `${Math.round(d.market * 100)}%`, d.sectorAvailable ? `${Math.round(d.sector * 100)}%` : "n/a", `${Math.round(d.stockSpecific * 100)}%`]),
      }}
    >
      <StackedBars
        mode="share"
        format={(v) => `${Math.round(v * 100)}%`}
        categories={MOVE_PARTS.map((p) => ({ key: p.key, label: p.label, color: p.color }))}
        rows={[...drivers].reverse().map((d) => ({
          key: d.date,
          label: shortDate(d.date),
          sublabel: d.ret >= 0 ? "up move" : "down move",
          values: { market: d.market, sector: d.sector, stockSpecific: d.stockSpecific },
          total: pct(d.ret),
          href: `/${ticker}?date=${d.date}`,
        }))}
      />
      <p className="mt-3 text-xs text-faint">Newest first · the right column is the move&apos;s return · click a row to open it.</p>
    </ChartFrame>
  );
}
