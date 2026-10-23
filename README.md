# Stonks

**An evidence-first watchlist investigator for IDX stocks.** See what moved a stock, test which
explanation holds, and know what would prove it wrong.

> ⚠️ Information tool only. Not financial advice. Stonks never executes trades.

## How it works

1. **Detect:** flag unusual moves on your watchlist (beta-adjusted abnormal return, volume spike, gap).
2. **Investigate:** build an evidence board from Sectors data.
3. **Test:** score competing explanations (market beta, sector rotation, earnings, dividend,
   liquidity, and the null hypothesis "just noise") with deterministic checks.
4. **Falsify:** attach machine-checkable conditions that would prove each surviving story wrong.
5. **Monitor:** re-check those conditions every trading day and alert when a story breaks.

Every number comes from code in [`src/lib/engine`](src/lib/engine), never from an LLM.

## Setup

```bash
npm install
cp .env.example .env     # then fill in SECTORS_API_KEY
npm run db:push          # create the local SQLite schema
npm run investigate -- BBCA   # scan + investigate from the terminal
npm run dev
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the Next.js dev server |
| `npm test` | Run engine tests (no network, no credits) |
| `npm run typecheck` | TypeScript check |
| `npm run db:push` | Sync the DB schema |
| `npm run investigate -- <TICKER>` | Scan a ticker and investigate its biggest moves |

## Project layout

```
src/lib/engine/    pure evidence engine: stats, detector, hypotheses, falsifiers (+ tests)
src/lib/sectors/   Sectors REST v2 client: cache, stored bars, credit ledger; typed data access
src/lib/pipeline.ts  glue: fetch data → run engine
src/lib/db/        Drizzle schema (SQLite / libSQL)
scripts/           CLI helpers
```

See [PLAN.md](PLAN.md) for the full roadmap.
