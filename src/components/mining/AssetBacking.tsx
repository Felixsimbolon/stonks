"use client";

import { motion } from "motion/react";
import Link from "next/link";
import type { FetchResult } from "@/app/actions";
import type { AssetBackingView } from "@/lib/mining/service";
import { FetchButton } from "../FetchButton";
import { shortDate } from "../format";
import { ha, idrPerTon, mt, pctShare, usdT, years } from "./format";

const ease = [0.22, 1, 0.36, 1] as const;

function Stat({ label, children, delay = 0 }: { label: string; children: React.ReactNode; delay?: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.6, ease }}>
      <p className="eyebrow mb-3">{label}</p>
      {children}
    </motion.div>
  );
}

function ReserveHistory({ history }: { history: AssetBackingView["history"] }) {
  const max = Math.max(...history.map((h) => h.reservesMt ?? 0), 1);
  return (
    <div className="flex items-end gap-5">
      {history.map((h, i) => (
        <div key={h.year} className="flex w-14 flex-col items-center">
          <span className="num mb-1 text-[11px] text-muted">{h.reservesMt !== null ? Math.round(h.reservesMt) : "—"}</span>
          <div className="flex h-24 w-full items-end">
            <motion.div
              className="w-full rounded-t-sm"
              style={{ background: "linear-gradient(180deg, var(--stock), color-mix(in oklab, var(--stock) 30%, transparent))" }}
              initial={{ height: 0 }}
              animate={{ height: `${((h.reservesMt ?? 0) / max) * 100}%` }}
              transition={{ delay: 0.3 + i * 0.1, duration: 0.8, ease }}
            />
          </div>
          <span className="num mt-2 text-xs text-faint">{h.year}</span>
          {h.replacement !== null && (
            <span className="num text-[11px]" style={{ color: h.replacement >= 1 ? "var(--up)" : "var(--down)" }}>
              {h.replacement.toFixed(2)}×
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function LicenseTimeline({ runway }: { runway: NonNullable<AssetBackingView["runway"]> }) {
  const now = new Date().getFullYear();
  const buckets = runway.byYear;
  if (buckets.length === 0) return <p className="text-sm text-faint">No dated licenses.</p>;
  const first = Math.min(now, buckets[0].year);
  const last = Math.max(now + 1, buckets.at(-1)!.year);
  const span = last - first || 1;
  const maxArea = Math.max(...buckets.map((b) => b.areaHa), 1);

  return (
    <div>
      <div className="relative h-28">
        {/* today marker */}
        <div className="absolute bottom-0 top-0 w-px bg-ink/40" style={{ left: `${((now - first) / span) * 100}%` }}>
          <span className="eyebrow absolute -top-5 -translate-x-1/2 whitespace-nowrap">today</span>
        </div>
        {buckets.map((b, i) => {
          const expired = b.year < now;
          return (
            <motion.div
              key={b.year}
              className="group absolute bottom-0 w-3 -translate-x-1/2 rounded-t-sm"
              style={{
                left: `${((b.year - first) / span) * 100}%`,
                background: expired ? "var(--faint)" : b.year - now <= 3 ? "var(--down)" : "var(--sector)",
              }}
              initial={{ height: 0 }}
              animate={{ height: `${Math.max(8, (b.areaHa / maxArea) * 100)}%` }}
              transition={{ delay: 0.3 + i * 0.06, duration: 0.6, ease }}
              title={`${b.year}: ${b.count} license${b.count === 1 ? "" : "s"}, ${ha(b.areaHa)}`}
            />
          );
        })}
      </div>
      <div className="mt-2 flex justify-between">
        <span className="num text-xs text-faint">{first}</span>
        <span className="num text-xs text-faint">{last}</span>
      </div>
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

  const { latest, runway, costPosition: cp } = view;
  const unit = latest?.unit ?? "Mt";

  return (
    <div>
      <div className="grid gap-12 md:grid-cols-2">
        <Stat label="reserve life">
          {view.reserveLifeYears !== null ? (
            <>
              <p className="display text-7xl leading-none">
                {Math.round(view.reserveLifeYears)}
                <span className="text-3xl text-muted"> years</span>
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                {mt(latest!.reservesTotal!)} of {latest!.commodity.toLowerCase()} reserves ÷ {mt(latest!.production!)} mined in{" "}
                {latest!.year}, at that pace.
                {latest?.resourcesTotal ? <> Resources (not yet proven reserves): {mt(latest.resourcesTotal)}.</> : null}
                {latest?.stripRatio ? <> Strip ratio {latest.stripRatio.toFixed(2)}.</> : null}
              </p>
            </>
          ) : (
            <p className="text-sm text-faint">Sectors has no reserves or production figure for this company.</p>
          )}
        </Stat>

        <Stat label="reserves by year · replacement" delay={0.1}>
          {view.history.length > 0 ? (
            <>
              <ReserveHistory history={view.history} />
              <p className="mt-4 text-xs leading-relaxed text-faint">
                Bars: total reserves ({unit}). Below each year: reserves added per ton mined. Under 1× means reserves are being
                drawn down faster than they are replaced.
              </p>
            </>
          ) : (
            <p className="text-sm text-faint">No reserve history.</p>
          )}
        </Stat>
      </div>

      {runway && (
        <Stat label="licenses" delay={0.2}>
          <div className="mt-2 grid gap-10 md:grid-cols-[1fr_16rem]">
            <LicenseTimeline runway={runway} />
            <div className="space-y-3 text-sm">
              <p className="text-muted">
                <span className="text-ink">{runway.count}</span> licenses · {ha(runway.totalAreaHa)}
                {runway.expired > 0 && <span className="text-down"> · {runway.expired} expired</span>}
              </p>
              {runway.nearest && (
                <p className="text-muted">
                  Next to expire: <span className="text-ink">{shortDate(runway.nearest.expiry!)} {runway.nearest.expiry!.slice(0, 4)}</span>
                  {runway.nearest.areaHa ? <> ({ha(runway.nearest.areaHa)}, {runway.nearest.type})</> : null}
                </p>
              )}
              <p className="num text-muted">
                Area expiring within 1y <span className="text-ink">{pctShare(runway.expiringShare.within1y)}</span> · 3y{" "}
                <span className="text-ink">{pctShare(runway.expiringShare.within3y)}</span> · 5y{" "}
                <span className="text-ink">{pctShare(runway.expiringShare.within5y)}</span>
              </p>
            </div>
          </div>
        </Stat>
      )}

      <div className="mt-14 grid gap-12 md:grid-cols-2">
        <Stat label="market cap per ton of reserves" delay={0.3}>
          {view.capPerTonIdr !== null ? (
            <>
              <p className="num text-3xl">{idrPerTon(view.capPerTonIdr)}</p>
              {view.peerCapPerTonIdr !== null && (
                <p className="mt-2 text-sm text-muted">
                  {(view.capPerTonIdr / view.peerCapPerTonIdr).toFixed(2)}× the median of the coal cost-curve companies (
                  {idrPerTon(view.peerCapPerTonIdr)}).
                </p>
              )}
              <p className="mt-2 text-xs text-faint">What the market pays per ton in the ground; not an estimate of worth.</p>
            </>
          ) : (
            <p className="text-sm text-faint">Needs a stored market cap: update prices for {ticker} first.</p>
          )}
        </Stat>

        <Stat label="position on the coal cost curve" delay={0.4}>
          {cp ? (
            <>
              <p className="display text-5xl leading-none">
                #{cp.rank}
                <span className="text-2xl text-muted"> of {cp.of} by cost</span>
              </p>
              <p className="mt-3 text-sm text-muted">
                Cost {usdT(cp.costPerTon)} · sells at {usdT(cp.aspPerTon)}
                {cp.latestPrice && (
                  <>
                    {" "}
                    · benchmark {usdT(cp.latestPrice.usdPerTon)} (
                    <span style={{ color: cp.costPerTon <= cp.latestPrice.usdPerTon ? "var(--up)" : "var(--down)" }}>
                      {cp.costPerTon <= cp.latestPrice.usdPerTon ? "below" : "above"}
                    </span>{" "}
                    its cost)
                  </>
                )}
              </p>
              <Link href="/mining" className="eyebrow mt-3 inline-block hover:text-ink">
                see the curve →
              </Link>
            </>
          ) : (
            <>
              <p className="text-sm text-faint">{view.costNote}</p>
              <Link href="/mining" className="eyebrow mt-3 inline-block hover:text-ink">
                coal cost curve →
              </Link>
            </>
          )}
        </Stat>
      </div>
    </div>
  );
}
