import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { DEFAULT_LIMITS, type Limits } from "../src/app";
import { clientErrors } from "../src/schema";
import { api, databaseAvailable, freshDatabaseUrl, startServer, type Harness } from "./support";

// Beta hygiene (docs/plans/beta.md, step 2): request budgets, the client's real address behind
// Render's proxy, the WebSocket flood guard, and client error reports.
const TIGHT: Limits = {
  ...DEFAULT_LIMITS,
  guest: { max: 2, windowMs: 60_000 },
  errors: { max: 3, windowMs: 60_000 },
  wsPer10s: 5,
};

let behindProxy: Harness;
let direct: Harness;
const drops: (() => Promise<void>)[] = [];
beforeAll(async () => {
  if (!databaseAvailable) return;
  const a = await freshDatabaseUrl();
  const b = await freshDatabaseUrl();
  drops.push(a.drop, b.drop);
  behindProxy = await startServer(a.url, undefined, { limits: TIGHT, trustProxy: 1 });
  direct = await startServer(b.url, undefined, { limits: TIGHT, trustProxy: false });
});
afterAll(async () => {
  if (!databaseAvailable) return;
  await behindProxy.close();
  await direct.close();
  for (const d of drops) await d();
});

const newGuest = (h: Harness, ip?: string) =>
  h.app.inject({
    method: "POST",
    url: "/api/guest",
    headers: ip ? { "x-forwarded-for": ip } : {},
  });

describe.skipIf(!databaseAvailable)("rate limits and error reports", () => {
  it("runs out of guest creations per client, with a clear error", async () => {
    expect((await newGuest(behindProxy, "203.0.113.1")).statusCode).toBe(200);
    expect((await newGuest(behindProxy, "203.0.113.1")).statusCode).toBe(200);
    const third = await newGuest(behindProxy, "203.0.113.1");
    expect(third.statusCode).toBe(429);
    expect(third.json()).toMatchObject({ code: "rateLimited" });
    // Behind the proxy, another client has its own budget.
    expect((await newGuest(behindProxy, "203.0.113.2")).statusCode).toBe(200);
  });

  it("without a trusted proxy, a forged X-Forwarded-For does not buy a new budget", async () => {
    expect((await newGuest(direct, "198.51.100.1")).statusCode).toBe(200);
    expect((await newGuest(direct, "198.51.100.2")).statusCode).toBe(200);
    expect((await newGuest(direct, "198.51.100.3")).statusCode).toBe(429);
  });

  it("stores client error reports and rejects malformed ones", async () => {
    const report = {
      message: "TypeError: x is undefined",
      stack: "at setBoard (view.ts:1)",
      build: "abc1234 · 2026-11-15",
      screen: "match",
      device: "Android Chrome",
    };
    expect((await api(behindProxy, "POST", "/api/errors", undefined, report)).status).toBe(200);
    expect(
      (await api(behindProxy, "POST", "/api/errors", undefined, { ...report, message: "" })).status,
    ).toBe(400);
    const rows = await behindProxy.database.db.select().from(clientErrors);
    expect(rows.map((r) => r.message)).toEqual(["TypeError: x is undefined"]);
  });

  it("closes a WebSocket that floods messages", async () => {
    const ws = new WebSocket(direct.wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const closed = new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));
    for (let i = 0; i < 10; i++) ws.send(JSON.stringify({ type: "ping" }));
    expect(await closed).toBe(1008);
  });
});
