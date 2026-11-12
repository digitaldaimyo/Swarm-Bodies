import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import postgres from "postgres";
import WebSocket from "ws";
import type { FastifyInstance } from "fastify";
import { parseServerMessage, type ClientMessage, type ServerMessage } from "@swarm/protocol";
import { buildApp } from "../src/app";
import { openDatabase, type Database } from "../src/db";
import { GameEngine, type Scheduler } from "../src/engine";
import { Progression } from "../src/progression";
import type { PushPayload, PushSender, PushTarget } from "../src/push";

/**
 * Server suites need Postgres: TEST_DATABASE_URL (CI sets it) or Docker for Testcontainers.
 * Without either they are skipped with a warning rather than failing `pnpm test`.
 */
export const databaseAvailable =
  Boolean(process.env["TEST_DATABASE_URL"]) || existsSync("/var/run/docker.sock");
if (!databaseAvailable) {
  console.warn(
    "Server tests skipped: set TEST_DATABASE_URL (e.g. postgres://swarm:swarm@localhost:5432/postgres) or run Docker.",
  );
}

/**
 * A fresh Postgres database per test file (SPEC §14: server tests run against Postgres).
 * With TEST_DATABASE_URL set (CI service container, local cluster) a throwaway database is
 * created on that server; otherwise a Testcontainers Postgres is started (needs Docker).
 */
export async function freshDatabaseUrl(): Promise<{ url: string; drop(): Promise<void> }> {
  const admin = process.env["TEST_DATABASE_URL"];
  if (admin) {
    const name = `swarm_test_${randomBytes(5).toString("hex")}`;
    const sql = postgres(admin, { max: 1, onnotice: () => undefined });
    await sql.unsafe(`CREATE DATABASE ${name}`);
    await sql.end();
    const url = new URL(admin);
    url.pathname = `/${name}`;
    return {
      url: url.toString(),
      drop: async () => {
        const s = postgres(admin, { max: 1, onnotice: () => undefined });
        await s.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
        await s.end();
      },
    };
  }
  const { PostgreSqlContainer } = await import("@testcontainers/postgresql");
  const container = await new PostgreSqlContainer("postgres:16-alpine").start();
  return { url: container.getConnectionUri(), drop: async () => void (await container.stop()) };
}

export class ManualClock {
  constructor(public t = Date.UTC(2026, 10, 12, 12)) {}
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
}

/** Live timers that only fire when the test says so. */
export class ManualScheduler implements Scheduler {
  readonly timers = new Map<string, { at: number; fn: () => void }>();
  set(key: string, at: number, fn: () => void) {
    this.timers.set(key, { at, fn });
  }
  clear(key: string) {
    this.timers.delete(key);
  }
  /** Fires every timer due at `now` (only those whose key contains `filter`, if given). */
  fireDue(now: number, filter?: string): number {
    let n = 0;
    for (const [key, t] of [...this.timers]) {
      if (t.at <= now && (!filter || key.includes(filter))) {
        this.timers.delete(key);
        t.fn();
        n++;
      }
    }
    return n;
  }
}

export class RecordingPush implements PushSender {
  readonly publicKey = "test-public-key";
  readonly sent: { target: PushTarget; payload: PushPayload }[] = [];
  gone = new Set<string>();
  async send(target: PushTarget, payload: PushPayload) {
    if (this.gone.has(target.endpoint)) return "gone" as const;
    this.sent.push({ target, payload });
    return "sent" as const;
  }
}

export interface Harness {
  url: string;
  database: Database;
  engine: GameEngine;
  progression: Progression;
  app: FastifyInstance;
  clock: ManualClock;
  scheduler: ManualScheduler;
  push: RecordingPush;
  wsUrl: string;
  close(): Promise<void>;
}

/** An engine + HTTP server on a database URL. Call twice on one URL to simulate a restart. */
export async function startServer(
  url: string,
  clock = new ManualClock(),
  appOptions: { clientDir?: string; corsOrigins?: string[] } = {},
): Promise<Harness> {
  const database = await openDatabase(url);
  const scheduler = new ManualScheduler();
  const push = new RecordingPush();
  const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const progression = new Progression(database.db, { clock, log: silent });
  const engine = new GameEngine(database.db, { clock, scheduler, push, log: silent, progression });
  const app = await buildApp({ engine, progression, ...appOptions });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url,
    database,
    engine,
    progression,
    app,
    clock,
    scheduler,
    push,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    close: async () => {
      engine.stop();
      await app.close();
      await database.close();
    },
  };
}

export async function api<T = unknown>(
  h: Harness,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  token?: string,
  body?: unknown,
) {
  const headers: Record<string, string> = {};
  if (token) headers["authorization"] = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await h.app.inject({
    method,
    url: path,
    headers,
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
  return { status: res.statusCode, body: res.json() as T };
}

export async function guest(
  h: Harness,
): Promise<{ token: string; accountId: string; name: string }> {
  return (await api<{ token: string; accountId: string; name: string }>(h, "POST", "/api/guest"))
    .body;
}

/** A WebSocket client that buffers messages and can wait for one matching a predicate. */
export class TestClient {
  readonly messages: ServerMessage[] = [];
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] =
    [];
  private constructor(private readonly ws: WebSocket) {
    ws.on("message", (data) => {
      const m = parseServerMessage(String(data));
      if (!m) throw new Error(`server sent an invalid message: ${String(data)}`);
      this.messages.push(m);
      this.waiters = this.waiters.filter((w) => {
        if (!w.pred(m)) return true;
        w.resolve(m);
        return false;
      });
    });
  }

  static async open(h: Harness, token: string): Promise<TestClient> {
    const ws = new WebSocket(h.wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const c = new TestClient(ws);
    c.send({ type: "hello", authToken: token, clientVersion: "test" });
    await c.next((m) => m.type === "welcome");
    return c;
  }

  send(m: ClientMessage | Record<string, unknown>) {
    this.ws.send(JSON.stringify(m));
  }

  sendRaw(raw: string) {
    this.ws.send(raw);
  }

  /** The first buffered or future message matching `pred`, consumed from the buffer. */
  next<T extends ServerMessage["type"]>(
    pred: (m: ServerMessage) => boolean,
    timeoutMs = 5000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const i = this.messages.findIndex(pred);
    if (i >= 0)
      return Promise.resolve(this.messages.splice(i, 1)[0] as Extract<ServerMessage, { type: T }>);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("timed out waiting for a message")),
        timeoutMs,
      );
      this.waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          this.messages.splice(this.messages.indexOf(m), 1);
          resolve(m as Extract<ServerMessage, { type: T }>);
        },
      });
    });
  }

  type<T extends ServerMessage["type"]>(
    type: T,
    extra: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true,
  ) {
    return this.next<T>((m) => m.type === type && extra(m as Extract<ServerMessage, { type: T }>));
  }

  close() {
    this.ws.close();
  }
}
