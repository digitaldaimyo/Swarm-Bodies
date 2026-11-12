import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { ordersBySeat } from "@swarm/protocol";
import { hashState, randomOrderSet, resolveTurn, type GameState } from "@swarm/sim";
import { chooseOrders } from "@swarm/bot";
import { turnResults } from "../src/schema";
import { twoPlayerGame } from "./fixtures";
import { api, databaseAvailable, freshDatabaseUrl, startServer, type Harness } from "./support";

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

describe.skipIf(!databaseAvailable)("live play over WebSocket (SPEC §9.4)", () => {
  it("keeps orders sealed, resolves when everyone submits, and every client can verify the hash", async () => {
    const g = await twoPlayerGame(h);
    expect(g.state.players.map((p) => p.strain)).toEqual(["swarmer", "biofilm"]);
    const o0 = randomOrderSet(g.state, 0, "a");
    const o1 = randomOrderSet(g.state, 1, "b");

    g.a.client.send({ type: "submitOrders", gameId: g.gameId, turn: 1, orders: o0 });
    const seen = await g.b.client.type("playerSubmitted");
    // Sealed: B learns that A is ready, never what A ordered.
    expect(seen).toEqual({
      type: "playerSubmitted",
      gameId: g.gameId,
      seat: 0,
      turn: 1,
      submitted: true,
    });
    expect(JSON.stringify(g.b.client.messages)).not.toContain(JSON.stringify(o0));

    g.b.client.send({ type: "submitOrders", gameId: g.gameId, turn: 1, orders: o1 });
    const ra = await g.a.client.type("turnResolved");
    const rb = await g.b.client.type("turnResolved");
    expect(ra).toEqual(rb);
    const local = resolveTurn(g.state, ordersBySeat(ra.ordersByPlayer)).state;
    expect(hashState(local)).toBe(ra.stateHash);
    expect(ra.nextDeadline).not.toBeNull();
  });

  it("rejects illegal and malformed orders, wrong turns and outsiders", async () => {
    const g = await twoPlayerGame(h);
    g.a.client.send({
      type: "submitOrders",
      gameId: g.gameId,
      turn: 1,
      orders: [{ type: "reinforce", body: 0, cell: { q: 0, r: 0 } }],
    });
    expect(await g.a.client.type("error")).toMatchObject({ code: "illegalOrder" });
    g.a.client.send({ type: "submitOrders", gameId: g.gameId, turn: 2, orders: [] });
    expect(await g.a.client.type("error")).toMatchObject({ code: "wrongTurn" });
    g.a.client.sendRaw("{nope");
    expect(await g.a.client.type("error")).toMatchObject({ code: "badMessage" });
    g.a.client.send({
      type: "submitOrders",
      gameId: g.gameId,
      turn: 1,
      orders: [{ type: "grow", body: 0, path: [{ q: 0.5, r: 0 }] }],
    });
    expect(await g.a.client.type("error")).toMatchObject({ code: "badMessage" });
    const outsider = await twoPlayerGame(h);
    outsider.a.client.send({ type: "subscribe", gameId: g.gameId });
    expect(await outsider.a.client.type("error")).toMatchObject({ code: "notPlayer" });
  });

  it("allows unsubmit until resolution", async () => {
    const g = await twoPlayerGame(h);
    g.a.client.send({ type: "submitOrders", gameId: g.gameId, turn: 1, orders: [] });
    await g.b.client.type("playerSubmitted", (m) => m.submitted);
    g.a.client.send({ type: "unsubmit", gameId: g.gameId, turn: 1 });
    expect(await g.b.client.type("playerSubmitted", (m) => !m.submitted)).toMatchObject({
      seat: 0,
    });
    g.b.client.send({ type: "submitOrders", gameId: g.gameId, turn: 1, orders: [] });
    await g.b.client.type("playerSubmitted", (m) => m.seat === 1);
    expect(g.a.client.messages.some((m) => m.type === "turnResolved")).toBe(false);
  });

  it("resolves at the live deadline; 3 missed turns hand the seat to a Normal bot until the player returns", async () => {
    const g = await twoPlayerGame(h);
    let state = g.state;
    const tick = async (turn: number) => {
      // A plays; B never submits. The deadline fires.
      g.a.client.send({ type: "submitOrders", gameId: g.gameId, turn, orders: [] });
      await g.b.client.type("playerSubmitted", (m) => m.turn === turn);
      h.clock.advance(61_000);
      expect(h.scheduler.fireDue(h.clock.now(), g.gameId)).toBe(1);
      const r = await g.a.client.type("turnResolved", (m) => m.turn === turn);
      state = resolveTurn(state, ordersBySeat(r.ordersByPlayer)).state;
      expect(hashState(state)).toBe(r.stateHash);
      return r;
    };
    expect((await tick(1)).ordersByPlayer["1"]).toEqual([]);
    await tick(2);
    await tick(3);
    // Shown to everyone (SPEC §3).
    const takeover = await g.a.client.type("playerStatus", (m) => m.seat === 1 && m.botControlled);
    expect(takeover.botControlled).toBe(true);

    // With the bot holding seat 1, A's submission alone resolves the turn, with bot orders.
    g.a.client.send({ type: "submitOrders", gameId: g.gameId, turn: 4, orders: [] });
    const r4 = await g.a.client.type("turnResolved", (m) => m.turn === 4);
    expect((r4.ordersByPlayer["1"] ?? []).length).toBeGreaterThan(0);
    state = resolveTurn(state, ordersBySeat(r4.ordersByPlayer)).state;
    expect(hashState(state)).toBe(r4.stateHash);

    // B comes back: submitting releases the bot.
    g.a.client.messages.length = 0;
    g.b.client.send({ type: "submitOrders", gameId: g.gameId, turn: 5, orders: [] });
    expect(
      await g.a.client.type("playerStatus", (m) => m.seat === 1 && !m.botControlled),
    ).toBeTruthy();
    await g.a.client.type("playerSubmitted", (m) => m.seat === 1 && m.turn === 5);
    const meta = await api<{ players: { botControlled: boolean }[] }>(
      h,
      "GET",
      `/api/games/${g.gameId}`,
      g.a.token,
    );
    expect(meta.body.players[1]?.botControlled).toBe(false);
  });

  it("resolution is idempotent: racing triggers produce exactly one result", async () => {
    const g = await twoPlayerGame(h);
    await Promise.all([
      h.engine.resolve(g.gameId, 1),
      h.engine.resolve(g.gameId, 1),
      h.engine.sweep(),
      h.engine.resolve(g.gameId, 1),
    ]);
    // A second engine on the same database (another process) cannot resolve it again.
    const other = await startServer(h.url, h.clock);
    await other.engine.resolve(g.gameId, 1);
    await other.close();
    const rows = await h.database.db
      .select()
      .from(turnResults)
      .where(eq(turnResults.gameId, g.gameId));
    expect(rows.map((r) => r.turn)).toEqual([1]);
    const resolved = g.a.client.messages.filter((m) => m.type === "turnResolved");
    expect(resolved).toHaveLength(1);
  });

  it("re-subscribing (a reconnect) delivers the full state", async () => {
    const g = await twoPlayerGame(h);
    g.a.client.send({ type: "submitOrders", gameId: g.gameId, turn: 1, orders: [] });
    g.b.client.send({ type: "submitOrders", gameId: g.gameId, turn: 1, orders: [] });
    const r = await g.a.client.type("turnResolved");
    g.b.client.close();
    expect(await g.a.client.type("playerStatus", (m) => m.seat === 1 && !m.connected)).toBeTruthy();
    const { TestClient } = await import("./support");
    const back = await TestClient.open(h, g.b.token);
    back.send({ type: "subscribe", gameId: g.gameId });
    const s = await back.type("gameState");
    expect(hashState(s.state as GameState)).toBe(r.stateHash);
    expect(s.meta.players.find((p) => p.you)?.seat).toBe(1);
    back.send({ type: "requestState", gameId: g.gameId });
    expect(await back.type("gameState")).toBeTruthy();
  });

  it("plays a whole game to gameOver, and the replay endpoint returns seed + orders", async () => {
    const g = await twoPlayerGame(h);
    let state = g.state;
    let over = false;
    for (let turn = 1; !over && turn <= 41; turn++) {
      g.a.client.send({
        type: "submitOrders",
        gameId: g.gameId,
        turn,
        orders: chooseOrders(state, 0, "normal", "a"),
      });
      g.b.client.send({
        type: "submitOrders",
        gameId: g.gameId,
        turn,
        orders: chooseOrders(state, 1, "easy", "b"),
      });
      const r = await g.a.client.type("turnResolved", (m) => m.turn === turn);
      state = resolveTurn(state, ordersBySeat(r.ordersByPlayer)).state;
      expect(hashState(state)).toBe(r.stateHash);
      over = state.result !== null;
    }
    expect(await g.b.client.type("gameOver")).toMatchObject({ result: state.result });
    const replay = await api<{ seed: string; turns: unknown[]; strains: string[] }>(
      h,
      "GET",
      `/api/replays/${g.gameId}`,
      g.a.token,
    );
    expect(replay.status).toBe(200);
    expect(replay.body.turns).toHaveLength(state.turn - 1);
    expect(replay.body.strains).toEqual(["swarmer", "biofilm"]);
    const list = await api<{ games: { gameId: string }[] }>(h, "GET", "/api/games", g.a.token);
    expect(list.body.games.some((x) => x.gameId === g.gameId)).toBe(false);
  });

  it("records client-reported hash mismatches", async () => {
    const g = await twoPlayerGame(h);
    g.a.client.send({
      type: "hashMismatch",
      gameId: g.gameId,
      turn: 1,
      clientHash: "x",
      serverHash: "y",
    });
    g.a.client.send({ type: "ping" });
    await g.a.client.type("pong");
    expect(h.engine.mismatches).toContainEqual({ gameId: g.gameId, turn: 1 });
  });
});
