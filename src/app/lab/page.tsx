import { runBacktestAction } from "@/app/actions";
import { FadeIn } from "@/components/FadeIn";
import { FetchButton } from "@/components/FetchButton";
import { shortDate } from "@/components/format";
import { LabCharts } from "@/components/LabCharts";
import { readLatestReport } from "@/lib/lab/run";

export const dynamic = "force-dynamic";
// Fetch buttons, Claude calls and the backtest can take a while.
export const maxDuration = 60;

export default async function LabPage() {
  const report = await readLatestReport();

  return (
    <main className="mx-auto max-w-6xl px-5 sm:px-8">
      <section className="flex flex-col gap-8 pb-14 pt-20 sm:flex-row sm:items-end sm:justify-between sm:pt-28">
        <div>
          <FadeIn>
            <p className="eyebrow mb-6">lab · the outside judge</p>
          </FadeIn>
          <FadeIn delay={0.08}>
            <h1 className="display max-w-3xl text-6xl sm:text-7xl">
              Does the engine <em className="gradient-text">earn its claims?</em>
            </h1>
          </FadeIn>
          <FadeIn delay={0.14}>
            <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted">
              The engine replayed over stored history, one session at a time, with no look-ahead. The judge is what happened
              next: how often it raises false alarms, whether its falsifiers break by chance on quiet days, and whether its
              probabilities match outcomes.
            </p>
          </FadeIn>
        </div>
        <FadeIn delay={0.2}>
          <FetchButton
            action={runBacktestAction}
            label={report ? "re-run the backtest" : "run the backtest"}
            pendingLabel="replaying history…"
            hint={`0 credits · stored data only${report ? ` · last run ${shortDate(report.generatedAt.slice(0, 10))}` : ""} · more history: npm run backtest -- --backfill 2`}
            className="sm:text-right"
          />
        </FadeIn>
      </section>

      {report ? (
        <FadeIn delay={0.25}>
          <LabCharts report={report} />
        </FadeIn>
      ) : (
        <p className="max-w-2xl text-muted">No backtest yet. Run it above; it uses only data already stored, so it costs nothing.</p>
      )}
    </main>
  );
}
