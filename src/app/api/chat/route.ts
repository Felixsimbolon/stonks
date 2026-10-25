import Anthropic from "@anthropic-ai/sdk";
import { runChat, type ChatEvent } from "@/lib/llm/chat";
import { llmConfigured, LlmError } from "@/lib/llm/client";
import { checkChatInput, type ChatTurn } from "@/lib/llm/guardrails";

export const dynamic = "force-dynamic";

// Ask Stonks: streams newline-delimited JSON events (see ChatEvent).

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
const recent: number[] = [];

/** A small in-process rate limit: this is a single-user local app. */
function rateLimited(): boolean {
  const now = Date.now();
  while (recent.length && now - recent[0] > WINDOW_MS) recent.shift();
  if (recent.length >= MAX_PER_WINDOW) return true;
  recent.push(now);
  return false;
}

function errorMessage(e: unknown): string {
  if (e instanceof LlmError) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY.";
  if (e instanceof Anthropic.RateLimitError) return "Claude is rate-limited right now. Try again in a minute.";
  if (e instanceof Anthropic.BadRequestError) return `Claude rejected the request: ${e.message}`;
  if (e instanceof Anthropic.APIError) return `Claude API error (${e.status ?? "network"}). Try again.`;
  return "Something went wrong answering that.";
}

export async function POST(req: Request) {
  if (!llmConfigured()) {
    return Response.json({ error: "ANTHROPIC_API_KEY is not set. Add it to .env to use Ask Stonks." }, { status: 503 });
  }
  let body: { turns?: unknown; ticker?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Malformed request." }, { status: 400 });
  }
  const invalid = checkChatInput(body.turns);
  if (invalid) return Response.json({ error: invalid }, { status: 400 });
  if (rateLimited()) return Response.json({ error: "Too many questions in a minute. Wait a moment." }, { status: 429 });

  const ticker = typeof body.ticker === "string" && /^[A-Za-z]{4}$/.test(body.ticker) ? body.ticker.toUpperCase() : null;
  const turns = body.turns as ChatTurn[];
  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: ChatEvent) => controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
      try {
        for await (const event of runChat(turns, ticker)) send(event);
      } catch (e) {
        send({ t: "error", message: errorMessage(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
