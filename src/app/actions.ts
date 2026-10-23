"use server";

import { revalidatePath } from "next/cache";
import { SectorsError, addDays, getDailyBars, todayWib } from "@/lib/sectors";
import { TICKER_RE, addToWatchlist, removeFromWatchlist } from "@/lib/views";

export interface AddState {
  error?: string;
  added?: string;
}

export async function addTicker(_prev: AddState, form: FormData): Promise<AddState> {
  const ticker = String(form.get("ticker") ?? "").trim().toUpperCase().replace(/\.JK$/, "");
  if (!TICKER_RE.test(ticker)) return { error: "Use a 4-letter IDX code, like BBCA." };
  try {
    // Confirms the symbol exists and warms the price store (1 credit).
    await getDailyBars(ticker, addDays(todayWib(), -10), todayWib());
  } catch (e) {
    if (e instanceof SectorsError && e.status === 404) return { error: `${ticker} isn't listed on IDX.` };
    return { error: e instanceof Error ? e.message : "Could not reach Sectors." };
  }
  await addToWatchlist(ticker);
  revalidatePath("/");
  return { added: ticker };
}

export async function removeTicker(ticker: string) {
  await removeFromWatchlist(ticker);
  revalidatePath("/");
}
