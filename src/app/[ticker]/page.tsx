import Link from "next/link";
import { notFound } from "next/navigation";
import { FadeIn } from "@/components/FadeIn";
import { dirColor, pct, price } from "@/components/format";
import { Investigation } from "@/components/Investigation";
import { MoveTabs } from "@/components/MoveTabs";
import { PriceChart } from "@/components/PriceChart";
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
        {last && (
          <FadeIn delay={0.12} className="pb-3 text-right">
            <div className="num text-3xl">{price(last.close)}</div>
            {change !== null && (
              <div className="num text-sm" style={{ color: dirColor(change) }}>
                {pct(change)} <span className="text-faint">last session</span>
              </div>
            )}
          </FadeIn>
        )}
      </section>

      {view.error ? (
        <p className="mt-12 border-l border-down/60 pl-4 text-sm text-down">{view.error}</p>
      ) : (
        <>
          <FadeIn delay={0.15} className="mt-10">
            <PriceChart ticker={ticker} prices={view.prices} moves={view.moves} selected={view.selected} />
          </FadeIn>

          {view.moves.length > 0 ? (
            <>
              <section className="mt-12">
                <p className="eyebrow mb-4">unusual moves · last 60 sessions</p>
                <MoveTabs ticker={ticker} moves={view.moves} selected={view.selected} />
                <div className="hairline" />
              </section>
              {view.result && (
                <section className="mt-16">
                  <Investigation ticker={ticker} result={view.result} />
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
    </main>
  );
}
