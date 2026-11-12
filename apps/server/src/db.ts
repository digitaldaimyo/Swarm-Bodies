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
  const client = postgres(url, { max: 10, onnotice: () => undefined });
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db, close: () => client.end({ timeout: 5 }) };
}
