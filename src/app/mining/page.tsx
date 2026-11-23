import { loadCostCurveAction } from "@/app/actions";
import { FadeIn } from "@/components/FadeIn";
import { FetchButton } from "@/components/FetchButton";
import { shortDate } from "@/components/format";
import { CostCurve } from "@/components/mining/CostCurve";
import { CurveTable } from "@/components/mining/CurveTable";
import { KpiRow, StatTile } from "@/components/charts/kit";
import { mt, usdT, years } from "@/components/mining/format";
import {
  CapPerTonChart,
  CoalPriceChart,
  CostBreakdownChart,
  ReserveLifeChart,
  StripVsCostChart,
} from "@/components/mining/MiningCharts";
import { getMiningView } from "@/lib/views";

export const dynamic = "force-dynamic";
// Fetch buttons, Claude calls and the backtest can take a while.
export const maxDuration = 60;

export default async function MiningPage() {
  const view = await getMiningView();
  const ready = view.status === "ready";
  const lives = view.rows.map((r) => r.reserveLifeYears).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const medianLife = lives.length ? lives[Math.floor(lives.length / 2)] : null;

  return (
    <main className="mx-auto max-w-6xl px-5 sm:px-8">
      <section className="flex flex-col gap-8 pb-14 pt-20 sm:flex-row sm:items-end sm:justify-between sm:pt-28">
        <div>
          <FadeIn>
            <p className="eyebrow mb-6">market intelligence · coal</p>
          </FadeIn>
          <FadeIn delay={0.08}>
            <h1 className="display max-w-3xl text-6xl sm:text-7xl">
              Not the chart. <em className="gradient-text">What&apos;s underneath it.</em>
            </h1>
          </FadeIn>
          <FadeIn delay={0.14}>
            <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted">
              Coal issuers compared by what physically backs them: tons in reserve, how long they last at today&apos;s
              output, what each ton costs to sell, and what the market pays per ton in the ground. From Sectors&apos;
              mining data, annual figures.
            </p>
          </FadeIn>
        </div>
        <FadeIn delay={0.2}>
          <FetchButton
            action={loadCostCurveAction}
            label={ready ? (view.incomplete ? "complete the data" : "refresh mining data") : "load mining data"}
            pendingLabel="fetching from Sectors…"
            hint={
              ready && !view.incomplete
                ? "cached for 30 days · refreshing re-fetches only what expired"
                : "first load ≈ 35–40 credits (9 companies × financials, production, ownership, market cap); cached 30 days"
            }
            className="sm:text-right"
          />
        </FadeIn>
      </section>

      {!ready ? (
        <FadeIn delay={0.3}>
          <p className="max-w-2xl text-muted">
            Nothing loaded yet. The coal cost curve uses the nine IDX issuers that Sectors has mining financials for: AADI,
            ADMR, ADRO, BYAN, BUMI, DSSA, GEMS, INDY and ITMG. Other mining issuers (PTBA, for example) still get reserves
            and licenses on their own pages.
          </p>
        </FadeIn>
      ) : (
        <>
          <section className="mb-16">
            <KpiRow>
              <StatTile
                label="Coal benchmark"
                value={view.latestPrice ? usdT(view.latestPrice.usdPerTon) : "—"}
                note={view.latestPrice ? `${shortDate(view.latestPrice.date)} ${view.latestPrice.date.slice(0, 4)}` : "not loaded"}
              />
              <StatTile label="Companies on the curve" value={String(view.curve.segments.length)} note={`of ${view.rows.length} with mining financials`} delay={0.05} />
              <StatTile label="Coal sold on the curve" value={mt(view.curve.totalMt)} note="latest annual figures" delay={0.1} />
              <StatTile
                label="Median reserve life"
                value={medianLife !== null ? years(medianLife) : "—"}
                note="at latest production"
                delay={0.15}
              />
            </KpiRow>
          </section>

          <section>
            <p className="eyebrow mb-6">coal cost curve</p>
            <CostCurve view={view} />
          </section>

          <section className="mt-20">
            <CoalPriceChart prices={view.prices} />
          </section>

          <section className="mt-20 grid gap-16 lg:grid-cols-2">
            <CostBreakdownChart rows={view.rows} />
            <StripVsCostChart rows={view.rows} />
            <ReserveLifeChart rows={view.rows} />
            <CapPerTonChart rows={view.rows.map((r) => ({ symbol: r.symbol, capPerTonIdr: r.capPerTonIdr, sublabel: r.name }))} />
          </section>

          <section className="mt-20">
            <p className="eyebrow mb-6">the companies</p>
            <CurveTable rows={view.rows} />
            {view.incomplete && (
              <p className="mt-6 text-sm text-faint">
                Some figures are still missing. Use <span className="text-ink">complete the data</span> above to fetch them.
              </p>
            )}
          </section>
        </>
      )}
    </main>
  );
}
