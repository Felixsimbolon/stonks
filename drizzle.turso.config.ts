import { defineConfig } from "drizzle-kit";

// Schema push to the Turso database used by deployments:
//   npm run db:push:turso
// Reads TURSO_DATABASE_URL / TURSO_AUTH_TOKEN from .env.
try {
  process.loadEnvFile(".env");
} catch {}

const clean = (v?: string) => v?.trim().replace(/^"|"$/g, "") || undefined;
const url = clean(process.env.TURSO_DATABASE_URL);
if (!url) throw new Error("Set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN) in .env");

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: { url, authToken: clean(process.env.TURSO_AUTH_TOKEN) },
});
