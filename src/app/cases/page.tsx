import { checkCasesAction } from "@/app/actions";
import { CaseList } from "@/components/CaseList";
import { ChartFrame, KpiRow, StatTile } from "@/components/charts/kit";
import { LineChart } from "@/components/charts/LineChart";
import { FadeIn } from "@/components/FadeIn";
import { FetchButton } from "@/components/FetchButton";
import { TrackRecord } from "@/components/TrackRecord";
import { getCasesView } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function CasesPage() {
  const { cases, record, headline, calibration } = await getCasesView();
  const open = cases.filter((c) => c.status === "open");
  const closed = cases.filter((c) => c.status === "closed");

  return (
    <main className="mx-auto max-w-6xl px-5 sm:px-8">
      <section className="flex flex-col gap-8 pb-14 pt-20 sm:flex-row sm:items-end sm:justify-between sm:pt-28">
        <div>
          <FadeIn>
            <p className="eyebrow mb-6">case files</p>
          </FadeIn>
          <FadeIn delay={0.08}>
            <h1 className="display max-w-3xl text-6xl sm:text-7xl">
              Every call, <em className="gradient-text">on the record.</em>
            </h1>
          </FadeIn>
          <FadeIn delay={0.14}>
            <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted">
              Each case freezes what the engine concluded about a move, then follows the conditions that would prove it
              wrong. Closed cases show how often its explanations actually held.
            </p>
          </FadeIn>
        </div>
        <FadeIn delay={0.2}>
          <FetchButton
            action={checkCasesAction}
            label="check open cases"
            pendingLabel="checking…"
            hint="0 credits · update prices first for new sessions"
            className="sm:text-right"
          />
        </FadeIn>
      </section>

      {cases.length > 0 && (
        <section className="mb-16">
          <KpiRow>
            <StatTile label="Case files" value={String(cases.length)} />
            <StatTile label="Open" value={String(open.length)} note="still being followed" delay={0.05} />
            <StatTile label="Closed" value={String(closed.length)} note="every condition resolved" delay={0.1} />
            <StatTile
              label="“Holds” calls that held"
              value={headline.filed ? `${Math.round((headline.held / headline.filed) * 100)}%` : "—"}
              note={headline.filed ? `${headline.held} of ${headline.filed} closed` : "no closed “holds” calls yet"}
              delay={0.15}
            />
          </KpiRow>
        </section>
      )}

      <section>
        <p className="eyebrow mb-6">track record</p>
        <TrackRecord rows={record} headline={headline} />
        <div className="mt-14">
          <ChartFrame
            title="Are the engine's probabilities honest?"
            subtitle={`Stated probability vs how often the explanation held, across closed cases · ${calibration.points} calls · Brier ${calibration.brier === null ? "—" : calibration.brier.toFixed(3)} (0 is perfect, 0.25 is guessing 50%)`}
            legend={[
              { label: "stated probability", color: "var(--c-market)", kind: "line" },
              { label: "held rate", color: "var(--c-sector)", kind: "line" },
            ]}
            table={{
              columns: ["bin", "calls", "mean stated", "held rate"],
              rows: calibration.bins.map((b) => [
                `${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}%`,
                b.n,
                b.meanP === null ? "—" : `${Math.round(b.meanP * 100)}%`,
                b.heldRate === null ? "—" : `${Math.round(b.heldRate * 100)}%`,
              ]),
            }}
          >
            {calibration.points > 0 ? (
              <LineChart
                height={200}
                xs={calibration.bins.map((b) => `${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}%`)}
                format={(v) => `${Math.round(v * 100)}%`}
                series={[
                  { key: "p", label: "stated probability", color: "var(--c-market)", values: calibration.bins.map((b) => b.meanP) },
                  { key: "held", label: "held rate", color: "var(--c-sector)", values: calibration.bins.map((b) => b.heldRate) },
                ]}
              />
            ) : (
              <p className="text-sm text-faint">
                No closed case carries a probability yet. Cases filed from now on do; the backtest on /lab gives a larger sample today.
              </p>
            )}
          </ChartFrame>
        </div>
      </section>

      <section className="mt-20">
        <p className="eyebrow mb-2">open · {open.length}</p>
        <div className="hairline" />
        {open.length > 0 ? (
          <CaseList cases={open} />
        ) : (
          <p className="py-8 text-sm text-faint">No open cases. File one from any investigation.</p>
        )}
      </section>

      <section className="mt-16">
        <p className="eyebrow mb-2">closed · {closed.length}</p>
        <div className="hairline" />
        {closed.length > 0 ? <CaseList cases={closed} /> : <p className="py-8 text-sm text-faint">Nothing closed yet.</p>}
      </section>
    </main>
  );
}
