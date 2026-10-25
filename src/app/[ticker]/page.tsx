import Link from "next/link";
import {
  checkCasesAction,
  fetchAssetBackingAction,
  fetchEvidence,
  fileCaseAction,
  refreshTicker,
} from "@/app/actions";
import { AssetBacking } from "@/components/mining/AssetBacking";
import { notFound } from "next/navigation";
import { FadeIn } from "@/components/FadeIn";
import { FetchButton } from "@/components/FetchButton";
import { dirColor, pct, price, shortDate } from "@/components/format";
import { Investigation } from "@/components/Investigation";
import { MoveTabs } from "@/components/MoveTabs";
import { PriceChart } from "@/components/PriceChart";
import { DriversChart, FlowChart, VolumeChart } from "@/components/TickerCharts";
import { TICKER_RE, getTickerView } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function TickerPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const ticker = (await params).ticker.toUpperCase();
  if (!TICKER_RE.test(ticker)) notFound();
  const { date } = await searchParams;
  const view = await getTickerView(ticker, date);

  const last = view.prices.at(-1);
  const prev = view.prices.at(-2);
  const change = last && prev ? last.close / prev.close - 1 : null;

  return (
    <main className="mx-auto max-w-6xl px-5 sm:px-8">
      <FadeIn>
        <Link href="/" className="eyebrow mt-10 inline-block transition-colors hover:text-ink">
          ← watchlist
        </Link>
      </FadeIn>

      <section className="mt-8 flex flex-wrap items-end justify-between gap-6">
        <FadeIn delay={0.05}>
          <h1 className="display text-8xl sm:text-9xl">{ticker}</h1>
        </FadeIn>
        <FadeIn delay={0.12} className="pb-3 text-right">
          {last && (
            <>
              <div className="num text-3xl">{price(last.close)}</div>
              {change !== null && (
                <div className="num text-sm" style={{ color: dirColor(change) }}>
                  {pct(change)} <span className="text-faint">last session</span>
                </div>
              )}
            </>
          )}
          <FetchButton
            action={refreshTicker.bind(null, ticker)}
            label="update prices"
            hint={view.dataThrough ? `data through ${shortDate(view.dataThrough)}` : "nothing stored yet · ~6 credits"}
            className="mt-4"
          />
        </FadeIn>
      </section>

      {view.error ? (
        <p className="mt-12 border-l border-down/60 pl-4 text-sm text-down">{view.error}</p>
      ) : view.prices.length === 0 ? (
        <p className="mt-16 max-w-xl text-muted">
          No prices stored for {ticker} yet. Use <span className="text-ink">update prices</span> to fetch its history.
        </p>
      ) : (
        <>
          <FadeIn delay={0.15} className="mt-10">
            <PriceChart ticker={ticker} prices={view.prices} moves={view.moves} selected={view.selected} />
          </FadeIn>

          <FadeIn delay={0.25} className="mt-10">
            <VolumeChart ticker={ticker} volumes={view.volumes} selected={view.selected} />
          </FadeIn>

          {(view.drivers.length > 0 || (view.flows && view.flows.length > 0)) && (
            <div className="mt-14 grid gap-14 lg:grid-cols-2">
              <FadeIn delay={0.3}>
                <DriversChart ticker={ticker} drivers={view.drivers} />
              </FadeIn>
              {view.flows && view.flows.length > 0 && (
                <FadeIn delay={0.35}>
                  <FlowChart flows={view.flows} />
                </FadeIn>
              )}
            </div>
          )}

          {view.moves.length > 0 ? (
            <>
              <section className="mt-12">
                <p className="eyebrow mb-4">unusual moves · last 60 sessions</p>
                <MoveTabs ticker={ticker} moves={view.moves} selected={view.selected} />
                <div className="hairline" />
              </section>
              {view.result && (
                <section className="mt-16">
                  <Investigation
                    ticker={ticker}
                    result={view.result}
                    fetchEvidence={fetchEvidence.bind(null, ticker, view.result.investigation.move.date)}
                    caseFile={view.caseFile}
                    trackNotes={view.trackNotes}
                    fileCase={fileCaseAction.bind(null, ticker, view.result.investigation.move.date)}
                    checkCases={checkCasesAction}
                  />
                </section>
              )}
            </>
          ) : (
            <FadeIn delay={0.3}>
              <p className="mt-16 max-w-xl text-muted">
                Nothing unusual in the last 60 sessions. Every move stayed within normal range for {ticker} given what
                the market did.
              </p>
            </FadeIn>
          )}
        </>
      )}

      {view.assetBacking && (
        <section className="mt-24">
          <div className="hairline mb-10" />
          <p className="eyebrow mb-8">what&apos;s underneath · mining assets</p>
          <AssetBacking
            ticker={ticker}
            view={view.assetBacking}
            fetchAction={fetchAssetBackingAction.bind(null, ticker)}
          />
        </section>
      )}
    </main>
  );
}
