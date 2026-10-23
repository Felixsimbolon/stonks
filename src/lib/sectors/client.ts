import { eq, sum } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env, requireSectorsKey } from "@/lib/env";

// The only path to Sectors data. Every call goes through the response cache
// and the credit ledger so the credit budget is never blown by accident.
//
// Billing (per Sectors docs): 2xx and 404 are billed; 400/401/403/429/5xx are not.

export class SectorsError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    message: string,
  ) {
    super(`Sectors ${status} on ${path}: ${message}`);
  }
}

/** Thrown in cache-only mode when nothing has been fetched for a path yet. */
export class NotCachedError extends Error {
  constructor(readonly path: string) {
    super(`Not fetched yet: ${path}`);
  }
}

export interface GetOptions {
  /** Cache lifetime in ms; `Infinity` for immutable data; 0 to bypass the response cache. */
  ttlMs: number;
  /** Credits this call costs on success (company report: 1 per section). */
  credits?: number;
  /** Never call Sectors: return the cached payload even if stale, or throw NotCachedError. */
  cacheOnly?: boolean;
}

const isBilled = (status: number) => (status >= 200 && status < 300) || status === 404;
const MAX_RETRIES = 3;

export async function creditsUsed(): Promise<number> {
  const [row] = await db.select({ n: sum(schema.apiCalls.credits) }).from(schema.apiCalls);
  return Number(row?.n ?? 0);
}

async function fetchWithRetry(url: string, key: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: key } });
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= MAX_RETRIES) return res;
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt;
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

/** GET a Sectors v2 path such as `/daily/BBCA/?start=...`. */
export async function sectorsGet<T>(path: string, { ttlMs, credits = 1, cacheOnly = false }: GetOptions): Promise<T> {
  const now = Date.now();

  if (ttlMs > 0 || cacheOnly) {
    const [cached] = await db.select().from(schema.apiCache).where(eq(schema.apiCache.path, path));
    if (cached && (cacheOnly || !cached.expiresAt || cached.expiresAt.getTime() > now)) {
      return JSON.parse(cached.payload) as T;
    }
    if (cacheOnly) throw new NotCachedError(path);
  }

  const used = await creditsUsed();
  if (used + credits > env.SECTORS_CREDIT_LIMIT) {
    throw new Error(
      `Sectors credit limit reached (${used}/${env.SECTORS_CREDIT_LIMIT}). Raise SECTORS_CREDIT_LIMIT to continue.`,
    );
  }

  const res = await fetchWithRetry(`${env.SECTORS_API_BASE}${path}`, requireSectorsKey());
  const body = await res.text();
  if (isBilled(res.status)) {
    await db.insert(schema.apiCalls).values({ path, status: res.status, credits });
  }
  if (!res.ok) {
    let message = body.slice(0, 300);
    try {
      const j = JSON.parse(body);
      message = j.message ?? j.error ?? message;
    } catch {}
    throw new SectorsError(res.status, path, message);
  }

  if (ttlMs > 0) {
    const row = {
      path,
      payload: body,
      fetchedAt: new Date(now),
      expiresAt: Number.isFinite(ttlMs) ? new Date(now + ttlMs) : null,
    };
    await db.insert(schema.apiCache).values(row).onConflictDoUpdate({ target: schema.apiCache.path, set: row });
  }
  return JSON.parse(body) as T;
}
