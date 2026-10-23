"use server";

import { revalidatePath } from "next/cache";
import { investigateMove, scanTicker } from "@/lib/pipeline";
import { SectorsError, creditsUsed } from "@/lib/sectors";
import { TICKER_RE, addToWatchlist, listWatchlist, removeFromWatchlist } from "@/lib/views";

// The only places that call Sectors. Every fetch starts from a user click.

export interface FetchResult {
  error?: string;
  /** Credits this action spent. */
  used?: number;
}

const message = (e: unknown) =>
  e instanceof SectorsError && e.status === 404
    ? "Sectors doesn't know that symbol."
    : e instanceof Error
      ? e.message
      : "Could not reach Sectors.";

async function metered(fn: () => Promise<void>): Promise<FetchResult> {
  const before = await creditsUsed();
  try {
    await fn();
    return { used: (await creditsUsed()) - before };
  } catch (e) {
    return { error: message(e), used: (await creditsUsed()) - before };
  }
}

export interface AddState extends FetchResult {
  added?: string;
}

export async function addTicker(_prev: AddState, form: FormData): Promise<AddState> {
  const ticker = String(form.get("ticker") ?? "").trim().toUpperCase().replace(/\.JK$/, "");
  if (!TICKER_RE.test(ticker)) return { error: "Use a 4-letter IDX code, like BBCA." };
  // Fetches the ticker's price history (and IHSG if it's behind) once.
  const r = await metered(async () => {
    await scanTicker(ticker, { refresh: true });
  });
  if (r.error) return r;
  await addToWatchlist(ticker);
  revalidatePath("/");
  return { ...r, added: ticker };
}

export async function removeTicker(ticker: string) {
  await removeFromWatchlist(ticker);
  revalidatePath("/");
}

/** Fetch sessions published since the last update, for one ticker. */
export async function refreshTicker(ticker: string): Promise<FetchResult> {
  const r = await metered(async () => {
    await scanTicker(ticker, { refresh: true });
  });
  revalidatePath(`/${ticker}`);
  revalidatePath("/");
  return r;
}

/** Fetch sessions published since the last update, for the whole watchlist. */
export async function refreshAll(): Promise<FetchResult> {
  const r = await metered(async () => {
    for (const t of await listWatchlist()) await scanTicker(t, { refresh: true });
  });
  revalidatePath("/");
  return r;
}

/** Fetch peers, peer history and corporate actions needed to investigate one move. */
export async function fetchEvidence(ticker: string, date: string): Promise<FetchResult> {
  const r = await metered(async () => {
    const scan = await scanTicker(ticker);
    const move = scan.moves.find((m) => m.date === date);
    if (!move) throw new Error(`No flagged move on ${date}.`);
    await investigateMove(scan, move, { refresh: true });
  });
  revalidatePath(`/${ticker}`);
  return r;
}
