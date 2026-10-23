import { z } from "zod";

// Everything Sectors-related is optional at boot so the app (and tests) run
// before the API key is configured. Calls fail with a clear message instead —
// see requireSectorsKey().
const schema = z.object({
  DATABASE_URL: z.string().default("file:./data/stonks.db"),
  DATABASE_AUTH_TOKEN: z.string().optional(),

  SECTORS_API_KEY: z.string().trim().optional(),
  SECTORS_API_BASE: z.string().url().default("https://api.sectors.app/v2"),
  SECTORS_CREDIT_LIMIT: z.coerce.number().int().positive().default(1000),

  ANTHROPIC_API_KEY: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
});

const blankToUndefined = Object.fromEntries(
  Object.entries(process.env).map(([k, v]) => [k, v?.trim() === "" ? undefined : v]),
);

export const env = schema.parse(blankToUndefined);

export function requireSectorsKey(): string {
  if (!env.SECTORS_API_KEY) {
    throw new Error("SECTORS_API_KEY is not set. Add it to .env (see .env.example).");
  }
  return env.SECTORS_API_KEY;
}
