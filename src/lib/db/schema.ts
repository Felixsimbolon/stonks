import { sql } from "drizzle-orm";
import { integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const createdAt = () => text("created_at").notNull().default(sql`(datetime('now'))`);

export const watchlist = sqliteTable("watchlist", {
  ticker: text("ticker").primaryKey(),
  notes: text("notes"),
  addedAt: createdAt(),
});

// Past daily bars never change, so once stored they are never re-fetched.
export const priceBars = sqliteTable(
  "price_bars",
  {
    ticker: text("ticker").notNull(), // stock ticker or index code (e.g. "IHSG")
    date: text("date").notNull(),
    open: real("open").notNull(),
    high: real("high").notNull(),
    low: real("low").notNull(),
    close: real("close").notNull(),
    volume: real("volume").notNull(),
    marketCap: real("market_cap"), // IDR; null for indices and bars stored before it was kept
  },
  (t) => [primaryKey({ columns: [t.ticker, t.date] })],
);

// Daily foreign flow per ticker (IDR). Like price bars, past days never change.
export const foreignFlows = sqliteTable(
  "foreign_flows",
  {
    ticker: text("ticker").notNull(),
    date: text("date").notNull(),
    net: real("net"),
    buy: real("buy").notNull(),
    sell: real("sell").notNull(),
    foreignShare: real("foreign_share"),
  },
  (t) => [primaryKey({ columns: [t.ticker, t.date] })],
);

// Which date range of price_bars is already stored per ticker/index, so only
// the missing part is fetched. `through` is the last fully settled date.
export const barCoverage = sqliteTable("bar_coverage", {
  ticker: text("ticker").primaryKey(),
  from: text("from").notNull(),
  through: text("through").notNull(),
  checkedAt: integer("checked_at", { mode: "timestamp_ms" }).notNull(),
});

// Raw Sectors responses for non-price endpoints, keyed by path + query.
export const apiCache = sqliteTable("api_cache", {
  path: text("path").primaryKey(),
  payload: text("payload").notNull(),
  fetchedAt: integer("fetched_at", { mode: "timestamp_ms" }).notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
});

// One row per billed Sectors call (cache hits never reach this table).
export const apiCalls = sqliteTable("api_calls", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  path: text("path").notNull(),
  status: integer("status").notNull(),
  credits: integer("credits").notNull().default(1),
  at: createdAt(),
});

// ── Case files ───────────────────────────────────────────────────────────
// An investigation frozen at filing time, then followed: its falsifiers are
// re-checked against later sessions until each one breaks or survives.

export const moves = sqliteTable(
  "moves",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ticker: text("ticker").notNull(),
    date: text("date").notNull(),
    data: text("data", { mode: "json" }).notNull(), // engine Move, frozen at filing
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("moves_ticker_date").on(t.ticker, t.date)],
);

/** One case file per move. */
export const investigations = sqliteTable("investigations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  moveId: integer("move_id")
    .notNull()
    .unique()
    .references(() => moves.id),
  status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
  decomposition: text("decomposition", { mode: "json" }).notNull(), // engine Decomposition
  evidence: text("evidence", { mode: "json" }).notNull(), // engine Evidence[]
  hypotheses: text("hypotheses", { mode: "json" }).notNull(), // engine HypothesisResult[]
  summaryMd: text("summary_md"), // LLM narration, optional
  filedOn: text("filed_on").notNull(), // WIB date the case was filed
  closedOn: text("closed_on"), // market date of the last resolved falsifier
  createdAt: createdAt(),
});

export const falsifiers = sqliteTable("falsifiers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  investigationId: integer("investigation_id")
    .notNull()
    .references(() => investigations.id, { onDelete: "cascade" }),
  hypothesisType: text("hypothesis_type").notNull(),
  description: text("description").notNull(),
  rule: text("rule", { mode: "json" }).notNull(), // engine FalsifierRule
  window: integer("window").notNull(),
  status: text("status", { enum: ["pending", "triggered", "survived"] }).notNull().default("pending"),
  daysObserved: integer("days_observed").notNull().default(0),
  triggeredOn: text("triggered_on"),
  checkedAt: text("checked_at"),
});

/** Timeline of a case, dated by market date. */
export const caseEvents = sqliteTable("case_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  investigationId: integer("investigation_id")
    .notNull()
    .references(() => investigations.id, { onDelete: "cascade" }),
  date: text("date").notNull(),
  kind: text("kind", { enum: ["move", "falsifier_broke", "falsifier_held", "closed", "refiled"] }).notNull(),
  hypothesisType: text("hypothesis_type"),
  message: text("message").notNull(),
  createdAt: createdAt(),
});

export const alerts = sqliteTable("alerts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["move", "falsifier"] }).notNull(),
  refId: integer("ref_id").notNull(),
  channel: text("channel").notNull(),
  message: text("message").notNull(),
  sentAt: createdAt(),
});
