// Copy the local SQLite database into a Turso (libSQL) database, so a deployed
// instance starts with the data already paid for (prices, cache, case files).
//   1. npm run db:push:turso      create the schema in Turso
//   2. npm run db:copy-to-turso   copy every table's rows (0 Sectors credits)
// Reads TURSO_DATABASE_URL and TURSO_AUTH_TOKEN from .env. Existing rows with
// the same key in Turso are replaced.
import { createClient, type InStatement } from "@libsql/client";

const LOCAL = "file:./data/stonks.db";
const BATCH = 200;

async function main() {
  const url = process.env.TURSO_DATABASE_URL?.trim().replace(/^"|"$/g, "");
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim().replace(/^"|"$/g, "");
  if (!url || !authToken) throw new Error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in .env first.");

  const local = createClient({ url: LOCAL });
  const remote = createClient({ url, authToken });

  const tables = (
    await local.execute(
      "select name from sqlite_master where type = 'table' and name not like 'sqlite_%' and name not like '__drizzle%' order by name",
    )
  ).rows.map((r) => String(r.name));

  const remoteTables = new Set(
    (await remote.execute("select name from sqlite_master where type = 'table'")).rows.map((r) => String(r.name)),
  );

  for (const table of tables) {
    if (!remoteTables.has(table)) {
      console.log(`skip ${table}: not in Turso (run npm run db:push:turso first)`);
      continue;
    }
    const rows = (await local.execute(`select * from "${table}"`)).rows;
    if (rows.length === 0) {
      console.log(`${table}: empty`);
      continue;
    }
    const cols = Object.keys(rows[0]);
    const sql = `insert or replace into "${table}" (${cols.map((c) => `"${c}"`).join(", ")}) values (${cols.map(() => "?").join(", ")})`;
    for (let i = 0; i < rows.length; i += BATCH) {
      const stmts: InStatement[] = rows.slice(i, i + BATCH).map((r) => ({ sql, args: cols.map((c) => r[c] ?? null) }));
      await remote.batch(stmts, "write");
    }
    console.log(`${table}: ${rows.length} rows copied`);
  }
  console.log("\nDone. Point DATABASE_URL / DATABASE_AUTH_TOKEN at Turso in Vercel.");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
