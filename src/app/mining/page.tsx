import { loadCostCurveAction } from "@/app/actions";
import { FadeIn } from "@/components/FadeIn";
import { FetchButton } from "@/components/FetchButton";
import { shortDate } from "@/components/format";
import { CostCurve } from "@/components/mining/CostCurve";
import { CurveTable } from "@/components/mining/CurveTable";
import { usdT } from "@/components/mining/format";
import { Sparkline } from "@/components/Sparkline";
import { getMiningView } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function MiningPage() {
  const view = await getMiningView();
  const ready = view.status === "ready";

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
          <section>
            <div className="mb-6 flex flex-wrap items-end justify-between gap-6">
              <p className="eyebrow">coal cost curve</p>
              {view.latestPrice && (
                <div className="flex items-end gap-4">
                  <Sparkline
                    prices={view.prices.map((p) => ({ date: p.date, close: p.usdPerTon }))}
                    width={160}
                    height={36}
                  />
                  <p className="num text-right text-xs text-faint">
                    coal benchmark
                    <span className="block text-sm text-ink">{usdT(view.latestPrice.usdPerTon)}</span>
                    {shortDate(view.latestPrice.date)} {view.latestPrice.date.slice(0, 4)}
                  </p>
                </div>
              )}
            </div>
            <CostCurve view={view} />
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
