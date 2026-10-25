import Anthropic from "@anthropic-ai/sdk";
import { AnthropicFoundry } from "@anthropic-ai/foundry-sdk";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import { todayWib } from "@/lib/sectors";

// One place for the Claude client, model choice, refusal fallback, and the
// daily token budget. Every call is metered into llm_calls.
//
// Provider: the first-party Claude API by default; a Microsoft Foundry URL in
// ANTHROPIC_API_URL (https://{resource}.services.ai.azure.com/…) selects the
// Foundry client, with the resource name taken from the host.

export const MODEL = env.CLAUDE_MODEL ?? env.LLM_MODEL ?? "claude-opus-5-5";

type Provider = { kind: "anthropic"; baseURL?: string } | { kind: "foundry"; resource: string };

function provider(): Provider {
  const url = env.ANTHROPIC_API_URL;
  if (!url) return { kind: "anthropic" };
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new LlmError(`ANTHROPIC_API_URL is not a valid URL.`);
  }
  if (host.endsWith(".services.ai.azure.com")) return { kind: "foundry", resource: host.split(".")[0] };
  return { kind: "anthropic", baseURL: url };
}

/** Provider kind for display and feature gating; an invalid URL surfaces later, when a call is made. */
export const PROVIDER: Provider["kind"] = (() => {
  try {
    return provider().kind;
  } catch {
    return "anthropic";
  }
})();

/**
 * Server-side refusal fallback (if a safety classifier declines, the API
 * re-runs the request on Anthropic's recommended model for that category).
 * Only the first-party API supports it; Foundry requests go without.
 */
export function fallbackParams(): { betas?: Anthropic.Beta.AnthropicBeta[]; fallbacks?: "default" } {
  return PROVIDER === "anthropic" ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {};
}

type ClaudeClient = Anthropic | AnthropicFoundry;
let client: ClaudeClient | null = null;

export function llmConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

export function getClient(): ClaudeClient {
  if (!env.ANTHROPIC_API_KEY) throw new LlmError("ANTHROPIC_API_KEY is not set. Add it to .env to use AI features.");
  if (!client) {
    const p = provider();
    client =
      p.kind === "foundry"
        ? new AnthropicFoundry({ resource: p.resource, apiKey: env.ANTHROPIC_API_KEY })
        : new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: p.baseURL });
  }
  return client;
}

export class LlmError extends Error {}

/** Billed-at-full-rate tokens today: input, output, and cache writes (cache reads are ~10% and left out). */
export async function tokensUsedToday(): Promise<number> {
  const [row] = await db
    .select({
      n: sql<number>`coalesce(sum(${schema.llmCalls.inputTokens} + ${schema.llmCalls.outputTokens} + ${schema.llmCalls.cacheWriteTokens}), 0)`,
    })
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
  provider: "anthropic" | "foundry";
  usedToday: number;
  limit: number;
}

export async function llmUsage(): Promise<LlmUsage> {
  return {
    configured: llmConfigured(),
    model: MODEL,
    provider: PROVIDER,
    usedToday: await tokensUsedToday(),
    limit: env.LLM_DAILY_TOKEN_LIMIT,
  };
}
