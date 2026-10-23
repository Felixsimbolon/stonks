import { sql } from "drizzle-orm";
import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

export const moves = sqliteTable("moves", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  date: text("date").notNull(),
  data: text("data", { mode: "json" }).notNull(), // engine Move
  createdAt: createdAt(),
});

export const investigations = sqliteTable("investigations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  moveId: integer("move_id").notNull().references(() => moves.id),
  evidence: text("evidence", { mode: "json" }).notNull(), // engine Evidence[]
  hypotheses: text("hypotheses", { mode: "json" }).notNull(), // engine HypothesisResult[]
  summaryMd: text("summary_md"), // LLM narration, optional
  createdAt: createdAt(),
});

export const falsifiers = sqliteTable("falsifiers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  investigationId: integer("investigation_id").notNull().references(() => investigations.id),
  hypothesisType: text("hypothesis_type").notNull(),
  description: text("description").notNull(),
  rule: text("rule", { mode: "json" }).notNull(), // engine FalsifierRule
  status: text("status", { enum: ["pending", "triggered", "survived"] }).notNull().default("pending"),
  triggeredOn: text("triggered_on"),
  checkedAt: text("checked_at"),
});

export const alerts = sqliteTable("alerts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["move", "falsifier"] }).notNull(),
  refId: integer("ref_id").notNull(),
  channel: text("channel").notNull(),
  message: text("message").notNull(),
  sentAt: createdAt(),
});
