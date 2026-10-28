"use client";

import { hypothesisLabel } from "@/lib/casebook/logic";
import type { BacktestReport } from "@/lib/lab/backtest";
import { BarList } from "./charts/BarList";
import { ChartFrame, KpiRow, StatTile } from "./charts/kit";
import { LineChart } from "./charts/LineChart";
import { StackedBars } from "./charts/StackedBars";
import { pct } from "./format";

const rate = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0);

export function LabCharts({ report: r }: { report: BacktestReport }) {
  const per60New = avg(r.tickers.map((t) => t.per60New));
  const per60Old = avg(r.tickers.map((t) => t.per60Old));
  const sessions = r.tickers.reduce((a, t) => a + t.sessions, 0);
  const bins = r.calibration.bins;

  return (
    <div className="space-y-16">
      <KpiRow>
        <StatTile label="Sessions replayed" value={sessions.toLocaleString()} note={`${r.tickers.length} ticker${r.tickers.length === 1 ? "" : "s"}`} />
        <StatTile label="Flags per 60 sessions" value={per60New.toFixed(1)} note={`old fixed rules: ${per60Old.toFixed(1)}`} delay={0.05} />
        <StatTile
          label="Placebo false breaks"
          value={rate(r.placebo.breakRateNew)}
          note={`old 2σ√n: ${rate(r.placebo.breakRateLegacy)} · target ${rate(r.placebo.target)}`}
          delay={0.1}
        />
        <StatTile
          label="Brier score"
          value={r.calibration.brier === null ? "—" : r.calibration.brier.toFixed(3)}
          note={`${r.calibration.points} probability calls · lower is better`}
          delay={0.15}
        />
      </KpiRow>

      <div className="grid gap-14 lg:grid-cols-2">
        <ChartFrame
          title="False alarms: flags per 60 sessions"
          subtitle="New: heavy-tailed p-values at a stated false-alarm rate · sublabel: the old fixed rules on the same sessions"
          table={{
            columns: ["ticker", "sessions", "new per 60", "old per 60"],
            rows: r.tickers.map((t) => [t.ticker, t.sessions, t.per60New.toFixed(2), t.per60Old.toFixed(2)]),
          }}
        >
          <BarList
            items={r.tickers.map((t) => ({
              key: t.ticker,
              label: t.ticker,
              sublabel: `old rules: ${t.per60Old.toFixed(1)}`,
              value: t.per60New,
              display: t.per60New.toFixed(1),
            }))}
          />
        </ChartFrame>

        <ChartFrame
          title="Placebo: falsifiers on quiet sessions"
          subtitle="How often “the stock keeps moving on its own” breaks when nothing happened. It should be near 5%."
          table={{
            columns: ["threshold", "break rate"],
            rows: [
              ["bootstrap (new)", rate(r.placebo.breakRateNew)],
              ["2σ√n (old)", rate(r.placebo.breakRateLegacy)],
              ["target", rate(r.placebo.target)],
            ],
          }}
        >
          <BarList
            items={[
              { key: "new", label: "Bootstrap (new)", value: r.placebo.breakRateNew, display: rate(r.placebo.breakRateNew), emphasis: true },
              { key: "old", label: "2σ√n (old)", value: r.placebo.breakRateLegacy, display: rate(r.placebo.breakRateLegacy) },
              { key: "target", label: "Target", value: r.placebo.target, display: rate(r.placebo.target) },
            ]}
          />
          <p className="mt-3 text-xs text-faint">{r.placebo.sessions} quiet sessions sampled.</p>
        </ChartFrame>
      </div>

      <div className="grid gap-14 lg:grid-cols-2">
        <ChartFrame
          title="Calibration: stated probability vs what held"
          subtitle="Bins of the engine's probabilities for stock-level explanations, against how often those explanations survived their falsifiers"
          legend={[
            { label: "stated probability", color: "var(--c-market)", kind: "line" },
            { label: "held rate", color: "var(--c-sector)", kind: "line" },
          ]}
          table={{
            columns: ["bin", "calls", "mean stated", "held rate"],
            rows: bins.map((b) => [`${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}%`, b.n, rate(b.meanP), rate(b.heldRate)]),
          }}
        >
          {r.calibration.points > 0 ? (
            <LineChart
              height={200}
              xs={bins.map((b) => `${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}%`)}
              format={(v) => `${Math.round(v * 100)}%`}
              series={[
                { key: "p", label: "stated probability", color: "var(--c-market)", values: bins.map((b) => b.meanP) },
                { key: "held", label: "held rate", color: "var(--c-sector)", values: bins.map((b) => b.heldRate) },
              ]}
            />
          ) : (
            <p className="text-sm text-faint">No resolved probability calls yet.</p>
          )}
        </ChartFrame>

        <ChartFrame
          title="Falsifier outcomes on real flagged moves"
          subtitle="Explanations standing when the move was flagged, by whether their falsifier held over the next sessions"
          legend={[
            { label: "held", color: "var(--c-pos)" },
            { label: "broke", color: "var(--c-neg)" },
          ]}
          table={{
            columns: ["explanation", "standing", "held", "broke"],
            rows: r.falsifiers.map((f) => [hypothesisLabel(f.type), f.standing, f.held, f.broke]),
          }}
        >
          {r.falsifiers.length > 0 ? (
            <StackedBars
              mode="absolute"
              format={(v) => String(v)}
              categories={[
                { key: "held", label: "held", color: "var(--c-pos)" },
                { key: "broke", label: "broke", color: "var(--c-neg)" },
              ]}
              rows={r.falsifiers.map((f) => ({
                key: f.type,
                label: hypothesisLabel(f.type),
                values: { held: f.held, broke: f.broke },
                total: `${Math.round((f.held / f.standing) * 100)}% held`,
              }))}
            />
          ) : (
            <p className="text-sm text-faint">No resolved flagged moves yet.</p>
          )}
        </ChartFrame>
      </div>

      <div>
        <p className="eyebrow mb-5">after a flagged move: continuation or reversal?</p>
        <KpiRow>
          <StatTile
            label="Up moves that kept rising (+1..+5)"
            value={rate(r.drift.up.continued)}
            note={`${r.drift.up.n} moves · mean CAR ${r.drift.up.meanCar === null ? "—" : pct(r.drift.up.meanCar)}`}
          />
          <StatTile
            label="Down moves that kept falling (+1..+5)"
            value={rate(r.drift.down.continued)}
            note={`${r.drift.down.n} moves · mean CAR ${r.drift.down.meanCar === null ? "—" : pct(r.drift.down.meanCar)}`}
            delay={0.05}
          />
        </KpiRow>
        <p className="mt-4 max-w-2xl text-xs leading-relaxed text-faint">
          Beta-adjusted, so a market-wide rebound doesn&apos;t count. A historical pattern in this sample, not a forecast.
        </p>
      </div>

      {r.notes.length > 0 && (
        <ul className="space-y-1 border-l border-hair pl-4 text-sm text-muted">
          {r.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
