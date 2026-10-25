import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Fact } from "./guardrails";
import type { StockSummary } from "./summary";

// Reading stored summaries. Kept apart from summary.ts so pages can show a
// summary without importing the generator (which imports the views).

export interface StoredSummary {
  summary: StockSummary;
  facts: Fact[];
  dataThrough: string | null;
  model: string;
  generatedAt: string;
}

export async function getSummary(ticker: string): Promise<StoredSummary | null> {
  const [row] = await db.select().from(schema.summaries).where(eq(schema.summaries.ticker, ticker.toUpperCase()));
  if (!row) return null;
  return {
    summary: row.payload as StockSummary,
    facts: row.facts as Fact[],
    dataThrough: row.dataThrough,
    model: row.model,
    generatedAt: row.generatedAt.toISOString(),
  };
}
