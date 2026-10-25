// Our own guardrails around Claude, independent of the model's judgment:
//  1. Advice filter — Stonks is an information tool; anything that reads as
//     a buy/sell/hold call, a price target, or a prediction is withheld.
//  2. Number check — every number in a summary must appear in the facts it
//     was given (the engine computes numbers; the model only words them).
//  3. Citation check — every summary point must cite existing fact IDs.
//  4. Input limits — message length, history length.

export interface Fact {
  id: string; // "F1", "F2", …
  label: string;
  value: string; // display string, as the UI would show it
  source: string;
}

// ── 1. Advice ────────────────────────────────────────────────────────────

const ADVICE_PATTERNS: { re: RegExp; why: string }[] = [
  { re: /\b(you|investors?)\s+(should|ought to|must)\s+(buy|sell|hold|accumulate|exit|take profit)/i, why: "tells the reader what to trade" },
  { re: /\b(i|we)\s+(recommend|suggest|advise)\b/i, why: "makes a recommendation" },
  { re: /\b(strong\s+)?(buy|sell|hold|outperform|underperform|overweight|underweight)\s+(rating|call|signal|recommendation)\b/i, why: "gives a rating" },
  { re: /\b(good|great|bad)\s+(time|entry|opportunity)\s+to\s+(buy|sell|enter|exit)\b/i, why: "times a trade" },
  { re: /\b(target|fair)\s+(price|value)\b|\bprice\s+target\b|\bupside\s+of\b/i, why: "gives a price target or fair value" },
  { re: /\b(will|is going to|is likely to|is expected to)\s+(rise|fall|rally|drop|go up|go down|reach|hit|rebound|recover)\b/i, why: "predicts the price" },
  { re: /\bguarantee(d|s)?\b|\brisk-free\b/i, why: "promises an outcome" },
  // Bahasa Indonesia
  { re: /\b(sebaiknya|disarankan|saran(?:nya)?|rekomendasi(?:nya)?)\b[^.]{0,40}\b(beli|jual|tahan|hold|akumulasi|serok)\b/i, why: "memberi saran transaksi" },
  { re: /\b(beli|jual|serok|akumulasi)\s+(sekarang|saja|aja)\b/i, why: "menyuruh bertransaksi" },
  { re: /\b(target|harga\s+wajar|harga\s+target|target\s+harga)\b[^.]{0,20}\b(rp|idr|\d)/i, why: "memberi target harga" },
  { re: /\b(akan|bakal|pasti)\s+(naik|turun|rebound|terbang|anjlok|tembus)\b/i, why: "memprediksi harga" },
  { re: /\bpasti\s+untung\b|\btanpa\s+risiko\b/i, why: "menjanjikan hasil" },
];

/** Reasons the text reads as financial advice (empty = clean). */
export function adviceFindings(text: string): string[] {
  return ADVICE_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.why);
}

// ── 2. Numbers ───────────────────────────────────────────────────────────

interface NumberToken {
  value: number;
  decimals: number;
  percent: boolean;
}

function numberTokens(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  const re = /[-−+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[-−+]?\d+(?:\.\d+)?/g;
  for (const m of text.matchAll(re)) {
    const raw = m[0].replace(/,/g, "").replace("−", "-");
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    const decimals = raw.includes(".") ? raw.split(".")[1].length : 0;
    const percent = text.slice(m.index! + m[0].length).trimStart().startsWith("%");
    out.push({ value, decimals, percent });
  }
  return out;
}

/** Numbers a reader would take as data, normalized (commas dropped, "−" → "-"). */
export function extractNumbers(text: string): number[] {
  return numberTokens(text).map((t) => t.value);
}

/**
 * Numbers that need no backing: small counts ("3 sessions", "2 peers") and
 * years, which a summary may use in passing. Percentages always need backing.
 */
function isIncidental(t: NumberToken): boolean {
  if (t.percent || t.decimals > 0) return false;
  const a = Math.abs(t.value);
  return a <= 31 || (a >= 1990 && a <= 2100);
}

/**
 * Numbers in `text` that don't match any number in the facts, allowing
 * rounding to the precision they were written with (68 for 67.8, 14.8 for 14.81).
 */
export function unbackedNumbers(text: string, facts: Fact[]): number[] {
  const known = facts.flatMap((f) => extractNumbers(`${f.label} ${f.value}`)).map(Math.abs);
  return numberTokens(text)
    .filter((t) => !isIncidental(t))
    .filter((t) => {
      const a = Math.abs(t.value);
      const tol = 0.5 * 10 ** -t.decimals + 1e-9;
      return !known.some((k) => Math.abs(k - a) <= tol);
    })
    .map((t) => t.value);
}

// ── 3. Citations ─────────────────────────────────────────────────────────

export interface CitedPoint {
  text: string;
  facts: string[];
}

export interface PointIssue {
  index: number;
  problems: string[];
}

/** Check each point: cites ≥1 existing fact, every number is backed, no advice. */
export function checkPoints(points: CitedPoint[], facts: Fact[]): PointIssue[] {
  const ids = new Set(facts.map((f) => f.id));
  const issues: PointIssue[] = [];
  points.forEach((p, index) => {
    const problems: string[] = [];
    if (p.facts.length === 0) problems.push("cites no fact");
    const unknown = p.facts.filter((id) => !ids.has(id));
    if (unknown.length) problems.push(`cites unknown facts ${unknown.join(", ")}`);
    const cited = facts.filter((f) => p.facts.includes(f.id));
    const unbacked = unbackedNumbers(p.text, cited.length ? cited : facts);
    if (unbacked.length) problems.push(`numbers not in its cited facts: ${unbacked.join(", ")}`);
    const advice = adviceFindings(p.text);
    if (advice.length) problems.push(`reads as advice (${advice.join("; ")})`);
    if (problems.length) issues.push({ index, problems });
  });
  return issues;
}

// ── 4. Input limits ──────────────────────────────────────────────────────

export const MAX_MESSAGE_CHARS = 2000;
export const MAX_TURNS = 24;

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/** Validate a chat history from the client; returns an error message or null. */
export function checkChatInput(turns: unknown): string | null {
  if (!Array.isArray(turns) || turns.length === 0) return "Empty conversation.";
  if (turns.length > MAX_TURNS) return `Conversation too long (max ${MAX_TURNS} messages). Start a new one.`;
  for (const [i, t] of turns.entries()) {
    if (!t || typeof t !== "object") return "Malformed message.";
    const { role, content } = t as Record<string, unknown>;
    if (role !== "user" && role !== "assistant") return "Malformed message role.";
    if (typeof content !== "string" || content.trim() === "") return "Empty message.";
    if (content.length > MAX_MESSAGE_CHARS) return `Message too long (max ${MAX_MESSAGE_CHARS} characters).`;
    if (i === 0 && role !== "user") return "Conversation must start with a question.";
  }
  if ((turns.at(-1) as ChatTurn).role !== "user") return "The last message must be a question.";
  return null;
}
