"use client";

import type { CommodityPrice } from "@/lib/mining/types";
import type { CurveRow } from "@/lib/mining/service";
import { BarList } from "../charts/BarList";
import { ChartFrame } from "../charts/kit";
import { LineChart } from "../charts/LineChart";
import { Scatter } from "../charts/Scatter";
import { StackedBars } from "../charts/StackedBars";
import { idrPerTon, mt, usdT, years } from "./format";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(2, 4)}`;

export function CoalPriceChart({ prices }: { prices: CommodityPrice[] }) {
  if (prices.length < 2) return null;
  const first = prices[0];
  const last = prices.at(-1)!;
  const change = last.usdPerTon / first.usdPerTon - 1;
  return (
    <ChartFrame
      title="Coal benchmark price"
      subtitle={`USD per ton · ${prices.length} readings since ${monthLabel(first.date)} · ${change >= 0 ? "+" : "−"}${Math.abs(change * 100).toFixed(0)}% over the period`}
      table={{ columns: ["date", "USD / t"], rows: [...prices].reverse().map((p) => [p.date, p.usdPerTon.toFixed(2)]) }}
    >
      <LineChart
        height={220}
        area
        xs={prices.map((p) => monthLabel(p.date))}
        format={(v) => `$${Math.round(v)}`}
        series={[{ key: "coal", label: "coal benchmark", color: "var(--c-series)", values: prices.map((p) => p.usdPerTon) }]}
      />
    </ChartFrame>
  );
}

const COST_PARTS = [
  { key: "royalty", label: "Royalty", color: "var(--c-market)" },
  { key: "freight", label: "Freight & logistics", color: "var(--c-sector)" },
  { key: "other", label: "Other cost of revenue", color: "var(--c-stock)" },
];

export function CostBreakdownChart({ rows }: { rows: CurveRow[] }) {
  const withParts = rows
    .filter((r) => r.costParts && r.economics)
    .sort((a, b) => a.economics!.costPerTon - b.economics!.costPerTon);
  if (withParts.length === 0) return null;
  return (
    <ChartFrame
      title="What a ton costs"
      subtitle="Cost of revenue per ton sold, by component, from each company's annual mining financials"
      legend={COST_PARTS.map((p) => ({ label: p.label, color: p.color }))}
      table={{
        columns: ["company", "royalty / t", "freight / t", "other / t", "total / t"],
        rows: withParts.map((r) => [
          r.symbol,
          usdT(r.costParts!.royalty),
          usdT(r.costParts!.freight),
          usdT(r.costParts!.other),
          usdT(r.economics!.costPerTon),
        ]),
      }}
    >
      <StackedBars
        mode="absolute"
        format={(v) => usdT(v)}
        categories={COST_PARTS}
        rows={withParts.map((r) => ({
          key: r.slug,
          label: r.symbol,
          sublabel: r.excluded ? "off the curve" : r.name,
          values: { royalty: r.costParts!.royalty, freight: r.costParts!.freight, other: r.costParts!.other },
          total: usdT(r.economics!.costPerTon),
          href: `/${r.symbol}`,
        }))}
      />
    </ChartFrame>
  );
}

export function ReserveLifeChart({ rows }: { rows: CurveRow[] }) {
  const items = rows
    .filter((r) => r.reserveLifeYears !== null)
    .sort((a, b) => b.reserveLifeYears! - a.reserveLifeYears!);
  if (items.length === 0) return null;
  return (
    <ChartFrame
      title="Reserve life"
      subtitle="Years of reserves at the latest annual production"
      table={{
        columns: ["company", "reserves", "production", "reserve life"],
        rows: items.map((r) => [r.symbol, mt(r.reservesMt!), r.productionMt !== null ? mt(r.productionMt) : "—", years(r.reserveLifeYears!)]),
      }}
    >
      <BarList
        items={items.map((r) => ({
          key: r.slug,
          label: r.symbol,
          sublabel: `${mt(r.reservesMt!)} reserves`,
          value: r.reserveLifeYears,
          display: years(r.reserveLifeYears!),
          href: `/${r.symbol}`,
        }))}
      />
    </ChartFrame>
  );
}

export function CapPerTonChart({ rows, emphasis }: { rows: { symbol: string; capPerTonIdr: number | null; sublabel?: string }[]; emphasis?: string }) {
  const items = rows.filter((r) => r.capPerTonIdr !== null).sort((a, b) => b.capPerTonIdr! - a.capPerTonIdr!);
  if (items.length === 0) return null;
  return (
    <ChartFrame
      title="Market cap per ton of reserves"
      subtitle="What the market pays per ton in the ground (IDR) · not an estimate of worth"
      table={{ columns: ["company", "IDR per ton of reserves"], rows: items.map((r) => [r.symbol, idrPerTon(r.capPerTonIdr!)]) }}
    >
      <BarList
        items={items.map((r) => ({
          key: r.symbol,
          label: r.symbol,
          sublabel: r.sublabel,
          value: r.capPerTonIdr,
          display: idrPerTon(r.capPerTonIdr!).replace("IDR ", ""),
          emphasis: emphasis ? r.symbol === emphasis : undefined,
          href: `/${r.symbol}`,
        }))}
      />
    </ChartFrame>
  );
}

export function StripVsCostChart({ rows }: { rows: CurveRow[] }) {
  const pts = rows.filter((r) => r.stripRatio !== null && r.economics);
  if (pts.length < 3) return null;
  return (
    <ChartFrame
      title="Does stripping drive cost?"
      subtitle="Strip ratio (overburden moved per ton of coal) against cost of revenue per ton"
      table={{
        columns: ["company", "strip ratio", "cost / t"],
        rows: pts.map((r) => [r.symbol, r.stripRatio!.toFixed(2), usdT(r.economics!.costPerTon)]),
      }}
    >
      <Scatter
        xLabel="strip ratio"
        yLabel="cost per ton"
        xFormat={(v) => v.toFixed(0)}
        yFormat={(v) => `$${Math.round(v)}`}
        points={pts.map((r) => ({
          key: r.slug,
          label: r.symbol,
          x: r.stripRatio!,
          y: r.economics!.costPerTon,
          href: `/${r.symbol}`,
        }))}
      />
    </ChartFrame>
  );
}
