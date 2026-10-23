// Scan a ticker for unusual moves and investigate the biggest ones.
//   npm run investigate -- BBCA [--top 3] [--scan 60]
import { investigateMove, scanTicker } from "../src/lib/pipeline";
import { creditsUsed } from "../src/lib/sectors";

const pct = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(2)}%`;

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
}

async function main() {
  const ticker = process.argv.slice(2).find((a) => !a.startsWith("--") && Number.isNaN(Number(a)));
  if (!ticker) throw new Error("Usage: npm run investigate -- <TICKER> [--top 3] [--scan 60]");
  const top = arg("top", 3);
  const creditsBefore = await creditsUsed();

  const scan = await scanTicker(ticker, { scanDays: arg("scan", 60), refresh: true });
  const first = scan.bars[0]?.date;
  const last = scan.bars.at(-1)?.date;
  console.log(`\n${scan.ticker}: ${scan.bars.length} bars (${first} → ${last}), IHSG ${scan.market.length} bars`);
  console.log(`${scan.moves.length} flagged move(s) in the scan window\n`);

  for (const m of scan.moves) {
    console.log(
      `  ${m.date}  ret ${pct(m.ret).padStart(8)}  IHSG ${pct(m.marketRet).padStart(8)}  abn ${m.abnormalZ.toFixed(1).padStart(5)}σ  vol ${m.volumeRatio.toFixed(1)}×  [${m.triggers.join(", ")}]`,
    );
  }

  const biggest = [...scan.moves].sort((a, b) => Math.abs(b.abnormalZ) - Math.abs(a.abnormalZ)).slice(0, top);
  for (const move of biggest) {
    const r = await investigateMove(scan, move, { refresh: true });
    const inv = r.investigation;
    console.log(`\n${"─".repeat(78)}`);
    console.log(
      `${inv.ticker}  ${pct(move.ret)} on ${move.date}   abnormal ${pct(move.abnormalRet)} (${move.abnormalZ.toFixed(1)}σ)   β ${move.beta.toFixed(2)}   vol ${move.volumeRatio.toFixed(1)}×`,
    );
    const d = inv.decomposition;
    const sh = (x: number) => `${Math.round(x * 100)}%`;
    console.log(`subsector: ${r.subSector ?? "?"} (${r.peerCount} peers)`);
    console.log(
      `split: market ${pct(d.market)} (${sh(d.shares.market)}) · sector ${d.sector === null ? "n/a" : pct(d.sector)} (${sh(d.shares.sector)}) · stock-specific ${pct(d.stockSpecific)} (${sh(d.shares.stockSpecific)}, ${d.stockSpecificZ.toFixed(1)}σ)` +
        (d.relativeVolume === null ? "" : ` · volume ${d.relativeVolume.toFixed(1)}× peers`) + "\n",
    );
    for (const h of inv.hypotheses) {
      console.log(`  ${h.type.padEnd(16)} ${h.verdict.toUpperCase().padEnd(10)} ${h.score.toFixed(2)}  ${h.rationale}  [${h.evidenceIds.join(",")}]`);
    }
    if (r.falsifiers.length) {
      console.log("\n  What would prove it wrong:");
      for (const f of r.falsifiers) {
        const e = f.evaluation;
        const status = e.status === "triggered" ? `TRIGGERED on ${e.triggeredOn}` : `${e.status} (${e.daysObserved}d observed)`;
        console.log(`   ✗ [${f.hypothesisType}] ${f.description}\n       → ${status}`);
      }
    }
  }

  const creditsAfter = await creditsUsed();
  console.log(`\nCredits: ${creditsAfter - creditsBefore} used this run, ${creditsAfter} total\n`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
