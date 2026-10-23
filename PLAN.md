# Stonks — Evidence-First Watchlist Investigator

> **See what moved a stock, test which explanation holds, and know what would prove it wrong.**

Built on the Sectors (sectors.app) MCP/REST API for IDX (Indonesia Stock Exchange) data.

---

## 0. Status check against the hackathon rules

| Item | Rule | Status (as of 18 Oct 2026) |
|---|---|---|
| Registration | closed 22 Sep 2026, 23:59 WIB | **Closed** |
| Submission | closed 30 Sep 2026, 23:59 WIB | **Closed** |
| Winners | announced 9 Oct 2026 | Already announced |

**This edition of the hackathon is over.** This plan still follows the rules so the project can
(a) be a portfolio piece, (b) be ready for the next edition / a similar competition, or (c) be shown to
the Sectors team. If you want to enter something else, the rules here are still a sensible bar.

Rules that shape the design (they apply either way):
- **Sectors MCP or REST API must be the main data source** → every number on screen comes from Sectors, with a source tag.
- **Working end-to-end prototype** → no mock-only screens.
- **No automated trading** → analysis and alerts only. No order buttons, no broker integration.
- **No financial advice** → language is "evidence / hypothesis / falsifier", never "buy/sell/target price". A disclaimer is always shown.
- **1,000 API credits per team** → aggressive caching plus a credit budget shown in the UI.
- **Public GitHub repo; the repo must be created during the build window and frozen at submission.**
- **Judging:** usability 40%, video 30%, technical innovation 30% → put most effort into a clear core flow and a demo that tells a story.
- Best tracks: **Market Intelligence** (primary) or **AI Agents & Assistants**.

---

## 1. Product concept

Most "why did this stock move?" tools give you one confident story. This one treats every story as a
**hypothesis**: it gathers evidence, scores each one, and says which observations would **falsify** it.
Then it keeps watching for those observations.

### Core loop
1. **Detect:** daily scan of the watchlist flags unusual moves (abnormal return vs IHSG/sector, volume spike, gap).
2. **Investigate:** for each flagged move, build an *evidence board* from Sectors data.
3. **Hypothesize:** generate competing explanations from a fixed set of types.
4. **Test:** run deterministic checks for each hypothesis → verdict: `Supported` / `Partial` / `Weak` / `Refuted`.
5. **Falsify:** each surviving hypothesis gets concrete, machine-checkable kill conditions.
6. **Monitor:** the daily job re-checks the falsifiers and alerts when a story breaks or gets stronger.

### Hypothesis taxonomy (fixed, so tests stay deterministic)
| Type | Example | Test (code, not LLM) |
|---|---|---|
| Market beta | "IHSG fell 2%, BBCA just followed" | Regress return on IHSG; residual vs. explained share |
| Sector rotation | "The whole banking subsector sold off" | Peer/subsector median return on the same day; dispersion |
| Earnings / fundamentals | "Q3 earnings beat" | Report date inside the window; YoY/QoQ change in revenue/NI |
| Dividend / corporate action | "Ex-dividend drop" | Ex-date matches the move; size of drop ≈ dividend yield |
| Liquidity / flow | "Volume 5× average, a large player is entering" | Volume z-score; value traded vs. 20-day average |
| Index event | "Added to / removed from LQ45/IDX30" | Membership change near the date (if the data is available) |
| Idiosyncratic / noise | "No clear catalyst" | Residual within normal volatility band → default null hypothesis |

The **null hypothesis ("just noise / market")** is always on the board. Other stories must beat it.

### Example output (one investigation card)
```
ADRO  −6.8% (12 Okt)   abnormal vs IHSG: −5.9%   volume 3.4× avg
──────────────────────────────────────────────────────────────
H1 Sector rotation (coal)        SUPPORTED   peers median −5.1%, 7/8 down
H2 Market beta                   WEAK        IHSG −0.9%, β-explained −1.1%
H3 Earnings                      REFUTED     no report in ±5 days
H0 Noise                         REFUTED     residual = 2.9σ

What would prove H1 wrong:
 ✗ ADRO keeps falling while coal peers recover (spread > 3% within 5 days)
 ✗ Peer median turns positive but ADRO does not follow
Monitoring: daily ✓   Next check: 13 Okt 17:00 WIB
Evidence: [sectors:/daily/ADRO] [sectors:/subsector/coal] ...   ⚠ Not financial advice
```

---

## 2. Architecture

```
┌────────────── Next.js (App Router, TS) ──────────────┐
│ UI: Watchlist · Move feed · Investigation board ·    │
│     Falsifier tracker · Credit meter                 │
│ API routes / server actions                          │
└───────┬────────────────────┬─────────────────────────┘
        │                    │
  ┌─────▼──────┐     ┌───────▼────────┐      ┌───────────────┐
  │ Sectors    │     │ Evidence engine│      │ LLM layer     │
  │ REST client│◄────┤ (pure TS, no   │─────►│ (Claude API)  │
  │ + cache    │     │  LLM): stats,  │      │ narrate,      │
  │ + credit   │     │  tests,        │      │ phrase        │
  │   ledger   │     │  verdicts      │      │ falsifiers,   │
  └─────┬──────┘     └───────┬────────┘      │ chat Q&A      │
        │                    │               └───────────────┘
  ┌─────▼────────────────────▼──────┐
  │ SQLite (dev) / Postgres (prod)  │  watchlist, snapshots, investigations,
  │ via Drizzle ORM                 │  hypotheses, falsifiers, alerts, api_calls
  └─────────────────────────────────┘
        ▲
  ┌─────┴──────────┐      ┌─────────────────┐
  │ Daily cron     │─────►│ Notifier        │  Telegram bot / email
  │ (after close)  │      │                 │
  └────────────────┘      └─────────────────┘
```

**Key design principle: the LLM never makes up numbers.** The evidence engine computes every metric
and verdict in code. The LLM only (a) writes the narrative, (b) proposes which taxonomy types are
relevant and phrases falsifiers *from a structured schema*, and (c) answers follow-up questions using
tools that return only cached Sectors data. Every claim must cite an evidence ID, and responses
whose citations fail validation are rejected. This is the "technical innovation" story for the judges.

### Stack
- **Next.js 15 + TypeScript + Tailwind + shadcn/ui**, charts with Recharts/lightweight-charts
- **Drizzle ORM**: SQLite locally, Postgres (Neon/Supabase) when deployed
- **Claude API** (`claude-sonnet-5-5` for chat and narration, `claude-haiku-5-5` for cheap classification) with tool use
- **Sectors REST API v2** (`https://api.sectors.app/v2`, raw key in `Authorization`) as the data path for the engine. v1 was shut down on 2026-05-11.
  - Sectors MCP stays an option later for the chat agent only.
- **Cron:** Vercel Cron or a GitHub Actions schedule (17:00 WIB, after IDX close)
- **Notifications:** Telegram bot (simple, popular in Indonesia)
- **Tests:** Vitest for the evidence engine (fixtures recorded from real Sectors responses)

---

## 3. Sectors data usage (REST v2, verified 2026-10-23)

Wired up so far: `/daily/{t}/` (OHLCV, ≤90 days per call, 1 credit), `/index-daily/ihsg/`
(close only), `/company/report/{t}/?sections=peers` (1 credit per section), and
`/company/corporate-actions/{t}/` (dividends with ex-dates). The quarterly-dates endpoint returns
period ends, not release dates, so earnings timing is **untested** for now. Candidates for later:
`/news/`, `foreign-flow-by-symbol`, and `broker-summary-by-symbol` (strong evidence for the
liquidity/flow hypothesis).

Original estimates, kept for reference:

| Need | Likely underlying endpoint | Cache TTL |
|---|---|---|
| Daily OHLCV per ticker | `/daily/{ticker}/` (date range) | 1 day (immutable once past) |
| Index (IHSG, LQ45) daily | `/index-daily/{index}/` | 1 day |
| Company report (profile, financials, dividends, peers) | `/company/report/{ticker}/` with sections | 7 days |
| Subsector list and its companies | `/subsectors/`, `/companies/?sub_sector=` | 30 days |
| Top movers / most traded (move feed) | `/companies/top-changes/`, `/most-traded/` | 1 day |
| Financials (quarterly) | `/financials/quarterly/{ticker}/` | 7 days |
| Corporate actions / dividends | inside company report or a dedicated endpoint | 7 days |

**Credit budget (1,000 credits):**
- Historical price data is immutable → fetch once, store forever.
- Batch the watchlist: max ~10 tickers in the demo.
- Estimate: ~10 tickers × (1 daily + amortized report) ≈ 15 credits/day → ~60 days of operation, plus dev usage.
- An `api_calls` ledger table plus a UI meter; hard stop at a configurable limit.
- Record fixtures in dev so tests don't spend credits.

---

## 4. Data model (main tables)

- `watchlist(ticker, added_at, notes)`
- `price_bars(ticker, date, o, h, l, c, volume, value)` — PK (ticker, date)
- `index_bars(index_code, date, close)`
- `company_cache(ticker, section, payload_json, fetched_at)`
- `moves(id, ticker, date, ret, abnormal_ret, vol_z, trigger_reason)`
- `investigations(id, move_id, created_at, summary_md, status)`
- `evidence(id, investigation_id, kind, value_json, source_endpoint, fetched_at)`
- `hypotheses(id, investigation_id, type, verdict, score, rationale, evidence_ids[])`
- `falsifiers(id, hypothesis_id, rule_json, description, status[pending|triggered|expired], checked_at)`
- `alerts(id, falsifier_id|move_id, sent_at, channel)`
- `api_calls(id, endpoint, credits, at)`

Falsifier `rule_json` is a small DSL that runs deterministically, for example:
```json
{ "metric": "spread_vs_peer_median", "ticker": "ADRO", "window_days": 5, "op": ">", "value": 0.03 }
```

---

## 5. Implementation phases

### Phase 0: Setup and verification (day 1)
- [ ] `git init`, create the public GitHub repo, MIT license, README skeleton with disclaimer
- [ ] Scaffold Next.js + Tailwind + Drizzle + Vitest
- [x] Confirm v2 endpoints and credit costs
- [x] `.env.example` (`SECTORS_API_KEY`, `ANTHROPIC_API_KEY`, `TELEGRAM_BOT_TOKEN`, `DATABASE_URL`)
- [x] REST client with response cache, stored price bars, credit ledger, and retry/backoff on 429

### Phase 1: Data and detection (days 2–4)
- [ ] Backfill 1 year of daily bars for the watchlist and IHSG
- [ ] Move detector: abnormal return (vs. rolling β to IHSG), volume z-score, gap; configurable thresholds
- [ ] Watchlist CRUD UI and move feed

### Phase 2: Evidence engine (days 5–9) ← the core
- [ ] Return decomposition: market / sector / residual
- [ ] Peer co-movement (subsector median, breadth)
- [ ] Event alignment: earnings dates, ex-dividend dates, corporate actions
- [ ] One test function per hypothesis type → `{verdict, score, evidenceIds}`
- [ ] Null hypothesis baseline and ranking
- [ ] Unit tests with recorded fixtures (deterministic and reproducible)

### Phase 3: Falsifiers and monitoring (days 10–12)
- [ ] Falsifier DSL plus evaluator
- [ ] Generate default falsifiers per hypothesis type (template-based, refined by the LLM)
- [ ] Daily cron: refresh data → detect new moves → re-check falsifiers → send alerts
- [ ] Telegram notifier

### Phase 4: LLM layer (days 13–16)
- [ ] Narration: structured JSON in → Bahasa/English summary out, with mandatory `[E#]` citations
- [ ] Citation validator (reject or regenerate if a number has no matching evidence)
- [ ] "Ask the investigator" chat: tool use over cached data only (`get_evidence`, `get_bars`, `compare_peers`); refuses advice-style questions
- [ ] Guardrail prompt plus output filter for "buy/sell/target price" phrasing

### Phase 5: UI polish and demo (days 17–21)
- [ ] Investigation board: hypothesis cards, evidence chips, price chart with event markers
- [ ] Falsifier tracker timeline ("story still holds / broke on date X")
- [ ] Credit meter, empty states, loading states, mobile layout
- [ ] Deploy (Vercel + Neon)
- [ ] Seed a demo with 2–3 real, interesting moves

### Phase 6: Submission material
- [ ] README: problem statement, architecture diagram, how to run, Sectors endpoints used, disclaimer
- [ ] One-sentence problem statement (draft below)
- [ ] 1-minute teaser plus 3-minute walkthrough (script below)
- [ ] Social media post with the official hashtag
- [ ] Remove secrets from history, then freeze the repo

---

## 6. Problem statement (draft)

> Retail investors in Indonesia get one confident story about why a stock moved, usually from social
> media, with no way to check it; Stonks tests competing explanations against Sectors data and tells
> you what evidence would prove each one wrong.

## 7. 3-minute video script (outline)
1. **0:00–0:20 Hook:** "ADRO dropped 7% today. Twitter says it's X. Is that true?"
2. **0:20–1:10:** Watchlist → move feed → open the investigation; hypotheses ranked, null hypothesis refuted
3. **1:10–1:50:** Click evidence chips → raw Sectors data; show the falsifiers
4. **1:50–2:30:** Fast-forward: the daily job finds a falsifier triggered → Telegram alert "the story broke"
5. **2:30–3:00:** Architecture in one slide (deterministic engine + citation-checked LLM), credit efficiency, disclaimer

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Sectors has no news endpoint, so "news" hypotheses can't be tested | Limit the taxonomy to what Sectors data can test; label anything else "untested" |
| Credits run out | Immutable caching, small watchlist, fixtures in dev, hard budget cap |
| LLM hallucinates numbers | Code computes every number; citation validator |
| Seen as financial advice | Wording rules, output filter, permanent disclaimer, no price targets |
| Index membership data unavailable | Drop that hypothesis type |
