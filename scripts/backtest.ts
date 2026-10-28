// Replay the engine over stored history and write the outside-judge report.
//   npm run backtest                         stored data only (0 credits)
//   npm run backtest -- --backfill 2 --yes   first extend each watchlist ticker and IHSG to 2 years (costs credits)
import { runAndSaveBacktest } from "../src/lib/lab/run";
import { addDays, creditsUsed, getDailyBars, getIndexBars, todayWib } from "../src/lib/sectors";
import { listWatchlist } from "../src/lib/views";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const tickers = await listWatchlist();
  if (tickers.length === 0) throw new Error("The watchlist is empty.");
  const years = Number(arg("backfill") ?? 0);

  if (years > 0) {
    // ~4 ninety-day calls per year, per ticker plus IHSG; only what isn't stored is fetched.
    const estimate = Math.ceil((years * 365) / 90) * (tickers.length + 1);
    if (!process.argv.includes("--yes")) {
      console.log(`Backfill to ${years}y would cost up to ~${estimate} credits (less if partly stored). Re-run with --yes to proceed.`);
      return;
    }
    const to = todayWib();
    const from = addDays(to, -Math.round(years * 365));
    const before = await creditsUsed();
    await getIndexBars("ihsg", from, to, { refresh: true });
    for (const t of tickers) await getDailyBars(t, from, to, { refresh: true });
    console.log(`Backfill done: ${(await creditsUsed()) - before} credits used.`);
  }

  const report = await runAndSaveBacktest();
  const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);
  console.log("\nFlags per 60 sessions (new vs old rules):");
  for (const t of report.tickers) {
    console.log(`  ${t.ticker.padEnd(6)} ${t.sessions} sessions · new ${t.per60New.toFixed(1)} · old ${t.per60Old.toFixed(1)}`);
  }
  const p = report.placebo;
  console.log(
    `\nPlacebo (quiet sessions, n=${p.sessions}): falsifier broke ${pct(p.breakRateNew)} with bootstrap thresholds, ${pct(p.breakRateLegacy)} with 2σ√n; target ${pct(p.target)}`,
  );
  console.log(`Calibration: ${report.calibration.points} points · Brier ${report.calibration.brier?.toFixed(3) ?? "—"}`);
  console.log(
    `Post-move drift: up moves continued ${pct(report.drift.up.continued)} (n=${report.drift.up.n}), down moves ${pct(report.drift.down.continued)} (n=${report.drift.down.n})`,
  );
  for (const n of report.notes) console.log(`note: ${n}`);
  console.log("\nWrote data/reports/backtest-latest.json · open /lab to see it.");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
