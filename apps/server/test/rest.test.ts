import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@swarm/protocol";
import {
  api,
  databaseAvailable,
  freshDatabaseUrl,
  guest,
  startServer,
  TestClient,
  type Harness,
} from "./support";
import type { GameState } from "@swarm/sim";

let h: Harness;
let drop: () => Promise<void>;
beforeAll(async () => {
  if (!databaseAvailable) return;
  const db = await freshDatabaseUrl();
  drop = db.drop;
  h = await startServer(db.url);
});
afterAll(async () => {
  if (!databaseAvailable) return;
  await h.close();
  await drop();
});

describe.skipIf(!databaseAvailable)("REST (SPEC §9.4)", () => {
  it("issues guest tokens and rejects unknown ones", async () => {
    const g = await guest(h);
    expect(g.token.length).toBeGreaterThan(30);
    expect(g.name).toMatch(/\w+ \w+ \d{3}/);
    expect((await api(h, "GET", "/api/games", g.token)).status).toBe(200);
    expect((await api(h, "GET", "/api/games")).status).toBe(401);
    expect((await api(h, "GET", "/api/games", "x".repeat(40))).status).toBe(401);
  });

  it("creates a game with an invite code, joins by code, and only the host can start", async () => {
    const a = await guest(h);
    const b = await guest(h);
    const c = await guest(h);
    const created = await api<{ gameId: string; code: string }>(h, "POST", "/api/games", a.token, {
      settings: DEFAULT_SETTINGS.async,
      strain: "biofilm",
    });
    expect(created.status).toBe(200);
    expect(created.body.code).toMatch(/^[A-Z2-9]{6}$/);
    const { gameId, code } = created.body;
    expect((await api(h, "POST", `/api/games/${gameId}/start`, a.token)).body).toMatchObject({
      code: "notFull",
    });
    expect(
      (
        await api(h, "POST", `/api/games/${code.toLowerCase()}/join`, b.token, {
          strain: "swarmer",
        })
      ).body,
    ).toEqual({ gameId });
    expect(
      (await api(h, "POST", `/api/games/${code}/join`, c.token, { strain: "swarmer" })).body,
    ).toMatchObject({ code: "full" });
    expect(
      (await api(h, "POST", `/api/games/${gameId}/strain`, b.token, { strain: "biofilm" })).status,
    ).toBe(200);
    expect((await api(h, "POST", `/api/games/${gameId}/start`, b.token)).body).toMatchObject({
      code: "notHost",
    });
    expect((await api(h, "POST", `/api/games/${gameId}/start`, a.token)).status).toBe(200);
    expect(
      (await api(h, "POST", `/api/games/${gameId}/strain`, b.token, { strain: "swarmer" })).body,
    ).toMatchObject({ code: "started" });

    const meta = await api<{
      players: { strain: string; you: boolean }[];
      status: string;
      turn: number;
    }>(h, "GET", `/api/games/${gameId}`, b.token);
    expect(meta.body).toMatchObject({ status: "active", turn: 1 });
    expect(meta.body.players.map((p) => [p.strain, p.you])).toEqual([
      ["biofilm", false],
      ["biofilm", true],
    ]);
    const list = await api<{ games: { gameId: string; yourTurn: boolean }[] }>(
      h,
      "GET",
      "/api/games",
      a.token,
    );
    expect(list.body.games).toContainEqual(expect.objectContaining({ gameId, yourTurn: true }));
    expect((await api(h, "GET", `/api/replays/${gameId}`, a.token)).body).toMatchObject({
      code: "notFinished",
    });
  });

  it("creates, fills and starts a 3-player system game (SPEC §4, M5)", async () => {
    const [a, b, c] = [await guest(h), await guest(h), await guest(h)];
    const created = await api<{ gameId: string; code: string }>(h, "POST", "/api/games", a.token, {
      settings: { pace: "live", turnSeconds: 60, map: "system", players: 3 },
      strain: "swarmer",
    });
    expect(created.status).toBe(200);
    const { gameId, code } = created.body;
    await api(h, "POST", `/api/games/${code}/join`, b.token, { strain: "biofilm" });
    // Two of three seats: too early to start.
    expect((await api(h, "POST", `/api/games/${gameId}/start`, a.token)).status).toBe(409);
    await api(h, "POST", `/api/games/${code}/join`, c.token, { strain: "swarmer" });
    expect((await api(h, "POST", `/api/games/${gameId}/start`, a.token)).status).toBe(200);
    const client = await TestClient.open(h, c.token);
    client.send({ type: "subscribe", gameId });
    const state = (await client.type("gameState")).state as GameState;
    expect(state.mode).toBe("system");
    expect(state.players).toHaveLength(3);
    expect(state.bodies.length).toBeGreaterThanOrEqual(5);
    expect(new Set(state.players.map((p) => p.home.body)).size).toBe(3);
    client.close();
  });

  it("rejects a 3-player Single Rock game", async () => {
    const a = await guest(h);
    const bad = await api(h, "POST", "/api/games", a.token, {
      settings: { pace: "live", turnSeconds: 60, map: "singleRock", players: 3 },
      strain: "swarmer",
    });
    expect(bad.status).toBe(400);
  });

  it("validates request bodies with the protocol schemas", async () => {
    const a = await guest(h);
    const bad = await api(h, "POST", "/api/games", a.token, {
      settings: { pace: "live", turnSeconds: 5, map: "singleRock", players: 2 },
      strain: "swarmer",
    });
    expect(bad.status).toBe(400);
    expect(
      (await api(h, "POST", "/api/games/NOPE00/join", a.token, { strain: "predator" })).status,
    ).toBe(400);
    expect(
      (await api(h, "POST", "/api/games/NOPE00/join", a.token, { strain: "swarmer" })).status,
    ).toBe(404);
    expect((await api(h, "GET", "/api/games/not-a-uuid", a.token)).status).toBe(404);
  });

  it("quick-matches two players into a running game", async () => {
    const a = await guest(h);
    const b = await guest(h);
    expect(
      (await api(h, "POST", "/api/queue", a.token, { pace: "live", strain: "swarmer" })).body,
    ).toEqual({ status: "queued", gameId: null });
    const matched = await api<{ status: string; gameId: string }>(
      h,
      "POST",
      "/api/queue",
      b.token,
      { pace: "live", strain: "biofilm" },
    );
    expect(matched.body.status).toBe("matched");
    expect(
      (await api(h, "POST", "/api/queue", a.token, { pace: "live", strain: "swarmer" })).body,
    ).toEqual({ status: "matched", gameId: matched.body.gameId });
    const meta = await api<{ status: string; players: unknown[] }>(
      h,
      "GET",
      `/api/games/${matched.body.gameId}`,
      a.token,
    );
    expect(meta.body).toMatchObject({ status: "active" });
    expect(meta.body.players).toHaveLength(2);
  });

  it("stores push subscriptions and exposes the VAPID key", async () => {
    const a = await guest(h);
    expect((await api(h, "GET", "/api/push/key")).body).toEqual({ publicKey: "test-public-key" });
    const sub = { endpoint: "https://push.example.test/abc", keys: { p256dh: "p", auth: "a" } };
    expect((await api(h, "POST", "/api/push/subscribe", a.token, sub)).status).toBe(200);
    expect(
      (
        await api(h, "POST", "/api/push/subscribe", a.token, {
          endpoint: "not a url",
          keys: sub.keys,
        })
      ).status,
    ).toBe(400);
  });
});
