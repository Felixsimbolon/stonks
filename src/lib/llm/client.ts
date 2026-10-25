import Anthropic from "@anthropic-ai/sdk";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { todayWib } from "@/lib/sectors";

// One place for the Claude client, model choice, refusal fallback, and the
// daily token budget. Every call is metered into llm_calls.

export const MODEL = env.LLM_MODEL;

/**
 * Server-side refusal fallback: if a safety classifier declines, the API
 * re-runs the request on Anthropic's recommended model for that category.
 */
export const FALLBACK = {
  betas: ["server-side-fallback-2026-07-01"] as Anthropic.Beta.AnthropicBeta[],
  fallbacks: "default" as const,
};

let client: Anthropic | null = null;

export function llmConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

export function getClient(): Anthropic {
  if (!env.ANTHROPIC_API_KEY) throw new LlmError("ANTHROPIC_API_KEY is not set. Add it to .env to use AI features.");
  client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

export class LlmError extends Error {}

export async function tokensUsedToday(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${schema.llmCalls.inputTokens} + ${schema.llmCalls.outputTokens}), 0)` })
    .from(schema.llmCalls)
    .where(eq(schema.llmCalls.day, todayWib()));
  return Number(row?.n ?? 0);
}

/** Refuse to start a call once today's budget is spent. */
export async function assertBudget(): Promise<void> {
  const used = await tokensUsedToday();
  if (used >= env.LLM_DAILY_TOKEN_LIMIT) {
    throw new LlmError(
      `Today's Claude budget is used up (${used.toLocaleString()} of ${env.LLM_DAILY_TOKEN_LIMIT.toLocaleString()} tokens). Raise LLM_DAILY_TOKEN_LIMIT to continue.`,
    );
  }
}

export async function recordUsage(kind: "summary" | "chat", model: string, usage: Anthropic.Beta.BetaUsage | null | undefined) {
  if (!usage) return;
  await db.insert(schema.llmCalls).values({
    kind,
    model,
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    day: todayWib(),
  });
}

export interface LlmUsage {
  configured: boolean;
  model: string;
  usedToday: number;
  limit: number;
}

export async function llmUsage(): Promise<LlmUsage> {
  return { configured: llmConfigured(), model: MODEL, usedToday: await tokensUsedToday(), limit: env.LLM_DAILY_TOKEN_LIMIT };
}

/** Text of a response's text blocks, joined. */
export function textOf(content: Anthropic.Beta.BetaContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}
