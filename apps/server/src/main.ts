import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./db";
import { buildApp } from "./app";
import { Progression } from "./progression";
import { GameEngine, realScheduler } from "./engine";
import { webPushFromEnv } from "./push";

/** Server entry point. Configuration comes from the environment. */
const port = Number(process.env["PORT"] ?? 8787);
const databaseUrl = process.env["DATABASE_URL"] ?? "postgres://swarm:swarm@localhost:5432/swarm";

const database = await openDatabase(databaseUrl);
const engineLog = {
  info: (o: object, m?: string) => console.log(JSON.stringify({ level: "info", msg: m, ...o })),
  warn: (o: object, m?: string) => console.warn(JSON.stringify({ level: "warn", msg: m, ...o })),
  error: (o: object, m?: string) =>
    console.error(
      JSON.stringify({
        level: "error",
        msg: m,
        ...o,
        err: String((o as { err?: unknown }).err ?? ""),
      }),
    ),
};
const clock = { now: () => Date.now() };
const progression = new Progression(database.db, { clock, log: engineLog });
const engine = new GameEngine(database.db, {
  clock,
  scheduler: realScheduler(),
  push: webPushFromEnv(process.env),
  log: engineLog,
  progression,
});
// The built client is served from the same origin when present (Render runs `pnpm build`).
const clientDir =
  process.env["CLIENT_DIR"] ?? fileURLToPath(new URL("../../client/dist", import.meta.url));
const app = await buildApp({
  engine,
  progression,
  logger: process.env["NODE_ENV"] !== "test",
  clientDir: existsSync(`${clientDir}/index.html`) ? clientDir : undefined,
  corsOrigins: (process.env["CORS_ORIGINS"] ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
});

// Catch up on anything that expired while the server was down, then keep sweeping (SPEC §9.4).
await engine.restore();
await engine.sweep();
const sweeper = setInterval(
  () => void engine.sweep().catch((err) => engineLog.error({ err }, "sweep failed")),
  30_000,
);

await app.listen({ port, host: process.env["HOST"] ?? "0.0.0.0" });

const shutdown = async () => {
  clearInterval(sweeper);
  engine.stop();
  await app.close();
  await database.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
