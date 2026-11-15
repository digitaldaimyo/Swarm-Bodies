import { desc, gte } from "drizzle-orm";
import { openDatabase } from "../src/db";
import { clientErrors } from "../src/schema";

/**
 * Prints recent client error reports, grouped by message (docs/plans/beta.md, step 2).
 *   DATABASE_URL=... pnpm --filter @swarm/server errors [days]
 */
const days = Number(process.argv[2] ?? 7);
const database = await openDatabase(
  process.env["DATABASE_URL"] ?? "postgres://swarm:swarm@localhost:5432/swarm",
);
const since = new Date(Date.now() - days * 86_400_000);
const rows = await database.db
  .select()
  .from(clientErrors)
  .where(gte(clientErrors.createdAt, since))
  .orderBy(desc(clientErrors.createdAt));
const groups = new Map<string, typeof rows>();
for (const r of rows) groups.set(r.message, [...(groups.get(r.message) ?? []), r]);
console.log(`${rows.length} reports in the last ${days} days, ${groups.size} distinct messages\n`);
for (const [message, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
  const [last] = list;
  if (!last) continue;
  const devices = [...new Set(list.map((r) => r.device))].join(", ");
  const builds = [...new Set(list.map((r) => r.build))].join(", ");
  console.log(`× ${list.length}  ${message}`);
  console.log(
    `   last ${last.createdAt.toISOString()} on ${last.screen}; builds ${builds}; ${devices}`,
  );
  if (last.stack)
    console.log(
      last.stack
        .split("\n")
        .slice(0, 6)
        .map((l) => `     ${l}`)
        .join("\n"),
    );
  console.log();
}
await database.close();
