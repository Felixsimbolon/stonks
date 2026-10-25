import type Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { db, schema } from "@/lib/db";
import { assertBudget, fallbackParams, getClient, LlmError, MODEL, recordUsage } from "./client";
import { buildStockFacts } from "./facts";
import { adviceFindings, checkPoints, type Fact, type PointIssue } from "./guardrails";

// AI summary of one stock, written only from engine facts and checked by our
// guardrails before it is stored. Generated on request; never automatically.

const Point = z.object({
  text: z.string().describe("One or two plain sentences. Every number must come from the cited facts, written as they appear."),
  facts: z.array(z.string()).describe("IDs of the facts this point uses, e.g. [\"F3\", \"F7\"]."),
});

const SummarySchema = z.object({
  headline: z.string().describe("One sentence: what has been going on with the stock, with no numbers."),
  points: z.array(Point).describe("3 to 6 points: what moved it and why, by the evidence."),
  watch: z.array(Point).describe("1 to 3 conditions from the facts that would change this picture (falsifiers, license expiry, flow reversal)."),
  gaps: z.string().describe("One sentence on what the data cannot tell (untested explanations, missing data)."),
});

export type StockSummary = z.infer<typeof SummarySchema> & {
  /** Points dropped because they failed the guardrails twice. */
  dropped: number;
};

const SYSTEM = `You write short, factual briefs about Indonesian (IDX) stocks for Stonks, an evidence-first information tool.

Rules:
- Use only the numbered facts you are given. Do not add knowledge, news, or numbers from anywhere else.
- Every point cites the fact IDs it relies on. Copy numbers exactly as they appear in those facts (rounding is fine); never compute new numbers.
- Describe; never advise. No buy/sell/hold calls, price targets, fair values, or predictions of where the price will go. Say what the evidence shows and what would change it.
- Explanations come with verdicts from the engine (holds, partly holds, weak, refuted, not needed, untested). Report them as the engine's verdicts; don't upgrade or overrule them.
- If facts are thin, say so in "gaps" rather than filling in.
- Write in English, plainly, without hype.`;

function render(facts: Fact[]): string {
  return facts.map((f) => `${f.id} | ${f.label} | ${f.value} | source: ${f.source}`).join("\n");
}

async function callOnce(ticker: string, facts: Fact[], feedback?: string) {
  const client = getClient();
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: "text", text: `Stock: ${ticker}\n\nFacts:\n${render(facts)}` },
  ];
  if (feedback) content.push({ type: "text", text: feedback });

  const res = await client.beta.messages.parse({
    ...fallbackParams(),
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium", format: betaZodOutputFormat(SummarySchema) },
    system: SYSTEM,
    messages: [{ role: "user", content }],
  });
  await recordUsage("summary", res.model, res.usage);

  if (res.stop_reason === "refusal") throw new LlmError("Claude declined to summarize this stock.");
  if (res.stop_reason === "max_tokens") throw new LlmError("The summary was cut off. Try again.");
  if (!res.parsed_output) throw new LlmError("Claude's summary didn't match the expected format.");
  return res.parsed_output;
}

function describeIssues(label: string, issues: PointIssue[]): string[] {
  return issues.map((i) => `${label} ${i.index + 1}: ${i.problems.join("; ")}`);
}

// Summaries now start automatically when a page opens; two tabs (or React's
// dev double-mount) must not pay for the same summary twice.
const inFlight = new Map<string, Promise<StockSummary>>();

/** Generate (or join an in-flight generation of) a ticker's summary. */
export function generateSummary(ticker: string): Promise<StockSummary> {
  const t = ticker.toUpperCase();
  const running = inFlight.get(t);
  if (running) return running;
  const p = writeSummary(t).finally(() => inFlight.delete(t));
  inFlight.set(t, p);
  return p;
}

/** Generate, check, retry once with the problems, drop what still fails, store. */
async function writeSummary(t: string): Promise<StockSummary> {
  const { facts, dataThrough } = await buildStockFacts(t);
  if (facts.length < 3) throw new LlmError(`Not enough stored data on ${t} to summarize. Update prices first.`);
  await assertBudget();

  let out = await callOnce(t, facts);
  const problems = () => [
    ...describeIssues("Point", checkPoints(out.points, facts)),
    ...describeIssues("Watch item", checkPoints(out.watch, facts)),
    ...adviceFindings(`${out.headline} ${out.gaps}`).map((why) => `Headline/gaps: reads as advice (${why})`),
  ];

  const first = problems();
  if (first.length) {
    await assertBudget();
    out = await callOnce(
      t,
      facts,
      `Your previous draft broke these rules; write the whole brief again without them:\n- ${first.join("\n- ")}`,
    );
  }

  // Whatever still fails is dropped, never shown.
  const badPoints = new Set(checkPoints(out.points, facts).map((i) => i.index));
  const badWatch = new Set(checkPoints(out.watch, facts).map((i) => i.index));
  const headlineOk = adviceFindings(out.headline).length === 0;
  const gapsOk = adviceFindings(out.gaps).length === 0;
  const summary: StockSummary = {
    headline: headlineOk ? out.headline : "",
    points: out.points.filter((_, i) => !badPoints.has(i)),
    watch: out.watch.filter((_, i) => !badWatch.has(i)),
    gaps: gapsOk ? out.gaps : "",
    dropped: badPoints.size + badWatch.size + (headlineOk ? 0 : 1) + (gapsOk ? 0 : 1),
  };
  if (summary.points.length === 0) throw new LlmError("No part of the summary passed the guardrails. Try again.");

  const row = { ticker: t, payload: summary, facts, dataThrough, model: MODEL, generatedAt: new Date() };
  await db.insert(schema.summaries).values(row).onConflictDoUpdate({ target: schema.summaries.ticker, set: row });
  return summary;
}
