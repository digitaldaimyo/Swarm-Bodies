import { fileURLToPath } from "node:url";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

export interface Database {
  db: Db;
  close(): Promise<void>;
}

const MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));

/** Connects and applies migrations (idempotent). */
export async function openDatabase(url: string): Promise<Database> {
  // Hosted Postgres behind PgBouncer in transaction mode (Neon's "-pooler" hosts) cannot keep
  // named prepared statements across transactions; plain queries work everywhere.
  const pooled = /-pooler\./.test(new URL(url).hostname);
  const client = postgres(url, { max: 10, onnotice: () => undefined, prepare: !pooled });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db, close: () => client.end({ timeout: 5 }) };
}
