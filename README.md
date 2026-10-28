# Stonks

**An evidence-first watchlist investigator for IDX stocks.** See what moved a stock, test which
explanation holds, and know what would prove it wrong.

> ⚠️ Information tool only. Not financial advice. Stonks never executes trades.

## How it works

1. **Detect:** flag unusual moves on your watchlist (beta-adjusted abnormal return, volume spike, gap).
2. **Investigate:** build an evidence board from Sectors data.
3. **Test:** split the move into market, sector and stock-specific parts, then score competing
   explanations (market, sector, earnings, ex-dividend, volume, foreign flow, news, and the null
   hypothesis "just noise") with deterministic checks, plus a surveillance desk borrowed from
   other fields: broker concentration (exchange surveillance), IDX suspensions (the regulator), and
   conglomerate-group co-movement (network analysis).
   The statistics are done the way empirical finance does them: unusual sessions are flagged by a
   stated false-alarm rate under a heavy-tailed model (≈0.5 false flags per 60 sessions), each move
   gets an event study (abnormal returns and CARs with significance), stock-level explanations get
   Bayesian probabilities with a reserved "something not tested" option and track-record priors,
   and sessions possibly capped by an IDX auto-rejection limit or a halt are marked.
4. **Falsify:** attach machine-checkable conditions that would prove each surviving story wrong.
5. **File and follow:** freeze an investigation as a case file, re-check its conditions as new
   sessions arrive, and close it when each one breaks or survives. Closed cases build the engine's
   track record: how often each kind of explanation actually held (`/cases`), and whether its
   probabilities are calibrated (Brier score, reliability).
6. **Judge from outside:** `/lab` replays the engine over stored history with no look-ahead and grades
   it on what happened next: false alarms old vs new, a placebo test of the falsifiers on quiet
   sessions (target 5%), calibration, and post-move drift. `npm run backtest` (0 credits).

**Mining asset backing** (`/mining` and mining ticker pages): what physically backs coal and
mineral issuers, from Sectors' mining extension. Reserve life and replacement, license runway,
market cap per ton of reserves, and a coal cost curve (cost of revenue per ton sold for the nine
issuers with mining financials) against a draggable coal benchmark.

**AI summaries and Ask Stonks** (optional, needs `ANTHROPIC_API_KEY`): Claude writes a stock's
summary only from numbered facts the engine computes, and answers questions through read-only
tools over the local store. Our own guardrails sit around the model: every number in a summary
must appear in the facts it cites, uncited or advice-like parts are dropped, a finished chat
answer that reads as a buy/sell call, price target or prediction is withheld, and a daily token
cap (`LLM_DAILY_TOKEN_LIMIT`) bounds spend. A stock's summary is written automatically when its
page opens, but only if there is none yet or new sessions have arrived since; otherwise the stored
one is shown without calling Claude. Chat only runs when you ask.

Every number comes from code in [`src/lib/engine`](src/lib/engine), never from an LLM.

**Sectors is only called when you click.** Pages read the local store. Use *update prices* (new sessions since the last update) or *fetch evidence* (peers + corporate actions for a move). Daily bars are fetched once and kept; a session counts as published after 18:00 WIB; peers are re-fetched after 30 days and corporate actions after 7.

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
src/lib/casebook/  case files: pure lifecycle + track record logic (+ tests), DB store
src/lib/db/        Drizzle schema (SQLite / libSQL)
scripts/           CLI helpers
```

See [PLAN.md](PLAN.md) for the full roadmap.
