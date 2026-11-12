import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  databaseAvailable,
  freshDatabaseUrl,
  ManualClock,
  startServer,
  type Harness,
} from "./support";

// Deployment: one server serves the API, the WebSocket and the built client (Render), and lets
// the GitHub Pages copy of the client call the API (CORS).
const PAGES = "https://example.github.io";
let h: Harness;
let drop: () => Promise<void>;
beforeAll(async () => {
  if (!databaseAvailable) return;
  const client = mkdtempSync(join(tmpdir(), "swarm-client-"));
  mkdirSync(join(client, "assets"));
  writeFileSync(join(client, "index.html"), "<!doctype html><title>Swarm Bodies</title>");
  writeFileSync(join(client, "assets", "app-abc123.js"), "console.log(1)");
  writeFileSync(join(client, "sw.js"), "// worker");
  const db = await freshDatabaseUrl();
  drop = db.drop;
  h = await startServer(db.url, new ManualClock(), { clientDir: client, corsOrigins: [PAGES] });
});
afterAll(async () => {
  if (!databaseAvailable) return;
  await h.close();
  await drop();
});

describe.skipIf(!databaseAvailable)("deployment: static client, SPA fallback, CORS", () => {
  it("serves the client shell, hashed assets with long caching, and the worker uncached", async () => {
    const root = await h.app.inject({ method: "GET", url: "/" });
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain("Swarm Bodies");
    const asset = await h.app.inject({ method: "GET", url: "/assets/app-abc123.js" });
    expect(asset.headers["cache-control"]).toContain("immutable");
    const sw = await h.app.inject({ method: "GET", url: "/sw.js" });
    expect(sw.headers["cache-control"]).toBe("no-cache");
  });

  it("app routes fall back to the shell; unknown API paths stay JSON 404s", async () => {
    const replay = await h.app.inject({ method: "GET", url: "/replay/0000-abc?x=1" });
    expect(replay.statusCode).toBe(200);
    expect(replay.body).toContain("Swarm Bodies");
    const api = await h.app.inject({ method: "GET", url: "/api/nope" });
    expect(api.statusCode).toBe(404);
    expect(api.json()).toMatchObject({ code: "notFound" });
    expect((await h.app.inject({ method: "GET", url: "/api/health" })).json()).toEqual({
      ok: true,
    });
  });

  it("allows the listed origin (with the auth header) and no other", async () => {
    const pre = await h.app.inject({
      method: "OPTIONS",
      url: "/api/games",
      headers: {
        origin: PAGES,
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization,content-type",
      },
    });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers["access-control-allow-origin"]).toBe(PAGES);
    expect(String(pre.headers["access-control-allow-headers"])).toContain("authorization");
    const other = await h.app.inject({
      method: "GET",
      url: "/api/health",
      headers: { origin: "https://evil.example" },
    });
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
