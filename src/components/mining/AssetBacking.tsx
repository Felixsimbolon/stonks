"use client";

import { motion } from "motion/react";
import Link from "next/link";
import type { FetchResult } from "@/app/actions";
import type { AssetBackingView } from "@/lib/mining/service";
import { BarList } from "../charts/BarList";
import { ColumnChart } from "../charts/ColumnChart";
import { ChartFrame, ease } from "../charts/kit";
import { LineChart } from "../charts/LineChart";
import { FetchButton } from "../FetchButton";
import { shortDate } from "../format";
import { CapPerTonChart } from "./MiningCharts";
import { ha, mt, pctShare, usdT } from "./format";

function Figure({ label, value, unit, note, delay = 0 }: { label: string; value: string; unit?: string; note?: React.ReactNode; delay?: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.6, ease }}>
      <p className="eyebrow mb-3">{label}</p>
      {/* hero figure: sans, proportional digits */}
      <p className="text-6xl font-semibold leading-none tracking-tight text-ink">
        {value}
        {unit && <span className="text-2xl font-normal text-muted"> {unit}</span>}
      </p>
      {note && <p className="mt-3 text-sm leading-relaxed text-muted">{note}</p>}
    </motion.div>
  );
}

function ReserveCharts({ view }: { view: AssetBackingView }) {
  const h = view.history;
  if (h.length === 0) return <p className="text-sm text-faint">No reserve history.</p>;
  const years = h.map((p) => String(p.year));
  return (
    <div className="grid gap-12 lg:grid-cols-2">
      <ChartFrame
        title="Reserves by year"
        subtitle="Total reserves (Mt) · below: reserves added per ton mined (under 1× = drawing down)"
        table={{
          columns: ["year", "reserves", "replacement"],
          rows: h.map((p) => [p.year, p.reservesMt !== null ? mt(p.reservesMt) : "—", p.replacement !== null ? `${p.replacement.toFixed(2)}×` : "—"]),
        }}
      >
        <ColumnChart
          height={170}
          format={(v) => `${Math.round(v)}`}
          columns={h.map((p) => ({
            key: String(p.year),
            label: String(p.year),
            value: p.reservesMt,
            tooltipTitle: String(p.year),
            tooltip: [
              { value: p.reservesMt !== null ? mt(p.reservesMt) : "—", label: "reserves", color: "var(--c-series)" },
              ...(p.replacement !== null ? [{ value: `${p.replacement.toFixed(2)}×`, label: "replacement" }] : []),
            ],
          }))}
        />
        <div className="mt-2 flex justify-between text-xs">
          {h.map((p) => (
            <span key={p.year} className="num text-muted">
              {p.year}: {p.replacement !== null ? `${p.replacement.toFixed(2)}×` : "—"}
            </span>
          ))}
        </div>
      </ChartFrame>

      <ChartFrame
        title="Production and sales"
        subtitle="Mt per year"
        legend={[
          { label: "production", color: "var(--c-market)", kind: "line" },
          { label: "sales", color: "var(--c-sector)", kind: "line" },
        ]}
        table={{
          columns: ["year", "production", "sales"],
          rows: h.map((p) => [p.year, p.productionMt !== null ? mt(p.productionMt) : "—", p.salesMt !== null ? mt(p.salesMt) : "—"]),
        }}
      >
        <LineChart
          height={190}
          xs={years}
          format={(v) => `${Math.round(v)}`}
          series={[
            { key: "production", label: "production", color: "var(--c-market)", values: h.map((p) => p.productionMt) },
            { key: "sales", label: "sales", color: "var(--c-sector)", values: h.map((p) => p.salesMt) },
          ]}
        />
      </ChartFrame>
    </div>
  );
}

function LicenseCharts({ view }: { view: AssetBackingView }) {
  const runway = view.runway!;
  const now = new Date().getFullYear();
  const first = Math.min(now, runway.byYear[0]?.year ?? now);
  const last = Math.max(now + 1, runway.byYear.at(-1)?.year ?? now + 1);
  const byYear = new Map(runway.byYear.map((b) => [b.year, b]));
  const columns = Array.from({ length: last - first + 1 }, (_, i) => first + i).map((y) => {
    const b = byYear.get(y);
    const color = y < now ? "var(--c-dim)" : y - now <= 3 ? "var(--c-neg)" : "var(--c-series)";
    return {
      key: String(y),
      label: String(y),
      value: b ? b.areaHa : null,
      color,
      tooltipTitle: `expiring in ${y}`,
      tooltip: b ? [{ value: ha(b.areaHa), label: `${b.count} license${b.count === 1 ? "" : "s"}`, color }] : [],
    };
  });

  const provinces = new Map<string, number>();
  for (const l of view.company?.licenses ?? []) {
    const p = l.province ?? "Unknown";
    provinces.set(p, (provinces.get(p) ?? 0) + (l.areaHa ?? 0));
  }
  const provinceItems = [...provinces.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr]">
      <ChartFrame
        title="Licensed area by expiry year"
        subtitle="Hectares whose license ends that year · red: within 3 years · gray: already expired"
        legend={[
          { label: "within 3 years", color: "var(--c-neg)" },
          { label: "later", color: "var(--c-series)" },
          { label: "expired", color: "var(--c-dim)" },
        ]}
        table={{
          columns: ["license", "type", "province", "area", "expires"],
          rows: (view.company?.licenses ?? []).map((l) => [l.number, l.type, l.province ?? "—", l.areaHa !== null ? ha(l.areaHa) : "—", l.expiry ?? "—"]),
        }}
      >
        <ColumnChart height={180} format={(v) => `${Math.round(v / 1000)}k`} markers={[{ key: String(now), label: "today" }]} columns={columns} />
        <p className="num mt-3 text-sm text-muted">
          Expiring within 1y <span className="text-ink">{pctShare(runway.expiringShare.within1y)}</span> · 3y{" "}
          <span className="text-ink">{pctShare(runway.expiringShare.within3y)}</span> · 5y{" "}
          <span className="text-ink">{pctShare(runway.expiringShare.within5y)}</span> of valid area
          {runway.nearest && (
            <>
              {" "}
              · next: <span className="text-ink">{shortDate(runway.nearest.expiry!)} {runway.nearest.expiry!.slice(0, 4)}</span>
            </>
          )}
        </p>
      </ChartFrame>

      {provinceItems.length > 0 && (
        <ChartFrame
          title="Licensed area by province"
          subtitle={`${runway.count} licenses · ${ha(runway.totalAreaHa)}${runway.expired ? ` · ${runway.expired} expired` : ""}`}
          table={{ columns: ["province", "area"], rows: provinceItems.map(([p, a]) => [p, ha(a)]) }}
        >
          <BarList items={provinceItems.map(([p, a]) => ({ key: p, label: p, value: a, display: ha(a) }))} />
        </ChartFrame>
      )}
    </div>
  );
}

export function AssetBacking({
  ticker,
  view,
  fetchAction,
}: {
  ticker: string;
  view: AssetBackingView;
  fetchAction: () => Promise<FetchResult>;
}) {
  if (view.status !== "ready") {
    return (
      <div className="max-w-2xl">
        <p className="display text-3xl leading-tight text-muted">
          {ticker} looks like a mining issuer. <em className="gradient-text">See what backs it.</em>
        </p>
        <p className="mt-3 text-sm leading-relaxed text-faint">
          Reserves and how long they last, licenses and when they expire, and what the market pays per ton in the ground,
          from Sectors&apos; mining data.
        </p>
        <FetchButton action={fetchAction} label="load mining profile" hint="≈ 5 credits · annual data, cached 30 days" className="mt-5" />
      </div>
    );
  }

  const { latest, costPosition: cp } = view;
  const peerRows = [
    ...view.peerCaps.filter((p) => p.symbol !== ticker),
    ...(view.capPerTonIdr !== null ? [{ symbol: ticker, capPerTonIdr: view.capPerTonIdr }] : []),
  ];

  return (
    <div className="space-y-16">
      <div className="grid gap-12 md:grid-cols-3">
        {view.reserveLifeYears !== null && latest ? (
          <Figure
            label="reserve life"
            value={String(Math.round(view.reserveLifeYears))}
            unit="years"
            note={
              <>
                {mt(latest.reservesTotal!)} of {latest.commodity.toLowerCase()} reserves ÷ {mt(latest.production!)} mined in {latest.year}.
                {latest.resourcesTotal ? <> Resources (not yet proven): {mt(latest.resourcesTotal)}.</> : null}
              </>
            }
          />
        ) : (
          <p className="text-sm text-faint">Sectors has no reserves or production figure for this company.</p>
        )}
        <Figure
          label="strip ratio"
          value={latest?.stripRatio ? latest.stripRatio.toFixed(2) : "—"}
          note="Overburden moved per ton of coal. Higher usually means costlier mining."
          delay={0.1}
        />
        {cp ? (
          <Figure
            label="cost-curve position"
            value={`#${cp.rank}`}
            unit={`of ${cp.of}`}
            note={
              <>
                Cost {usdT(cp.costPerTon)} · sells at {usdT(cp.aspPerTon)}
                {cp.latestPrice && <> · benchmark {usdT(cp.latestPrice.usdPerTon)}</>}.{" "}
                <Link href="/mining" className="underline decoration-hair underline-offset-4 hover:text-ink">
                  see the curve
                </Link>
              </>
            }
            delay={0.2}
          />
        ) : (
          <div>
            <p className="eyebrow mb-3">cost-curve position</p>
            <p className="text-sm text-faint">{view.costNote}</p>
            <Link href="/mining" className="eyebrow mt-3 inline-block hover:text-ink">
              coal cost curve →
            </Link>
          </div>
        )}
      </div>

      <ReserveCharts view={view} />

      {view.runway && <LicenseCharts view={view} />}

      {peerRows.length > 0 ? (
        <CapPerTonChart rows={peerRows} emphasis={ticker} />
      ) : (
        <p className="text-sm text-faint">
          Market cap per ton of reserves needs a stored market cap: update prices for {ticker} first.
        </p>
      )}
    </div>
  );
}
