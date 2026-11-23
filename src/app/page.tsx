import Link from "next/link";
import { refreshAll } from "@/app/actions";
import { AddTicker } from "@/components/AddTicker";
import { CreditMeter } from "@/components/CreditMeter";
import { FadeIn } from "@/components/FadeIn";
import { FetchButton } from "@/components/FetchButton";
import { shortDate } from "@/components/format";
import { KpiRow, StatTile } from "@/components/charts/kit";
import { Watchlist } from "@/components/Watchlist";
import { WatchTimeline } from "@/components/WatchTimeline";
import { env } from "@/lib/env";
import { countOpenCases, getCredits, getWatchRows, listWatchlist } from "@/lib/views";

export const dynamic = "force-dynamic";
// Fetch buttons, Claude calls and the backtest can take a while.
export const maxDuration = 60;

export default async function Home() {
  const tickers = await listWatchlist();
  const [rows, credits, openCases] = await Promise.all([getWatchRows(tickers), getCredits(), countOpenCases()]);
  const through = rows.map((r) => r.dataThrough).filter((d): d is string => d !== null).sort()[0];

  return (
    <main className="mx-auto max-w-6xl px-5 sm:px-8">
      <section className="pb-16 pt-20 sm:pt-28">
        <FadeIn>
          <p className="eyebrow mb-6">watchlist investigator</p>
        </FadeIn>
        <FadeIn delay={0.08}>
          <h1 className="display max-w-4xl text-6xl sm:text-8xl">
            See what <em className="gradient-text">moved</em> it.
            <br />
            <span className="text-muted">Test why. Know what would prove it wrong.</span>
          </h1>
        </FadeIn>
      </section>

      {!env.SECTORS_API_KEY && (
        <p className="mb-10 border-l border-down/60 pl-4 text-sm text-muted">
          <span className="text-ink">SECTORS_API_KEY</span> is not set. Add it to <span className="num">.env</span> and
          restart the dev server.
        </p>
      )}

      <section>
        <div className="mb-10 flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex-1 sm:max-w-xl">
            <AddTicker existing={tickers} />
          </div>
          <FadeIn delay={0.2} className="flex flex-col gap-5 sm:items-end">
            {rows.length > 0 && (
              <FetchButton
                action={refreshAll}
                label="update prices"
                hint={`${through ? `data through ${shortDate(through)}` : "no data yet"} · ~1 credit per ticker (+1 for IHSG) when a new session is out`}
                className="sm:text-right"
              />
            )}
            {openCases > 0 && (
              <Link href="/cases" className="text-sm text-muted transition-colors hover:text-ink">
                <span className="text-ink">{openCases}</span> open case{openCases === 1 ? "" : "s"} →
              </Link>
            )}
            <CreditMeter {...credits} />
          </FadeIn>
        </div>

        {rows.length > 0 && (
          <div className="mb-12">
            <KpiRow>
              <StatTile label="Watching" value={String(rows.length)} note={through ? `data through ${shortDate(through)}` : undefined} />
              <StatTile
                label="Unusual moves, last 20 sessions"
                value={String(rows.reduce((a, r) => a + r.moves.length, 0))}
                note={`${rows.filter((r) => r.moves.length > 0).length} of ${rows.length} tickers`}
                delay={0.05}
              />
              <StatTile label="Open case files" value={String(openCases)} note="followed until they hold or break" delay={0.1} />
              <StatTile
                label="Sectors credits used"
                value={String(credits.used)}
                note={`${Math.max(0, credits.limit - credits.used)} left of ${credits.limit}`}
                delay={0.15}
              />
            </KpiRow>
          </div>
        )}

        <div className="hairline" />
        {rows.length > 0 ? (
          <>
            <Watchlist rows={rows} />
            <FadeIn delay={0.4} className="mt-16">
              <WatchTimeline rows={rows} />
            </FadeIn>
          </>
        ) : (
          <FadeIn delay={0.3}>
            <p className="py-16 text-muted">
              Your watchlist is empty. Add a ticker and Stonks will flag its unusual moves, then test what caused each one.
            </p>
          </FadeIn>
        )}
      </section>
    </main>
  );
}
