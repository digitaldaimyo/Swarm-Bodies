/** Creates the database named in DATABASE_URL if it does not exist (used by the e2e server). */
import postgres from "postgres";

const url = new URL(
  process.env["DATABASE_URL"] ?? "postgres://swarm:swarm@localhost:5432/swarm_e2e",
);
const name = url.pathname.slice(1);
if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Refusing odd database name: ${name}`);
const admin = new URL(url);
admin.pathname = "/postgres";
const sql = postgres(admin.toString(), { max: 1, onnotice: () => undefined });
const rows = await sql`select 1 from pg_database where datname = ${name}`;
if (rows.length === 0) await sql.unsafe(`CREATE DATABASE ${name}`);
await sql.end();
