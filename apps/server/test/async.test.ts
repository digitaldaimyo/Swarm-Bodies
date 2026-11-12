import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { DEFAULT_SETTINGS, ordersBySeat } from "@swarm/protocol";
import { hashState, randomOrderSet, resolveTurn, type GameState } from "@swarm/sim";
import { gameSnapshots, games } from "../src/schema";
import { twoPlayerGame } from "./fixtures";
import {
  api,
  databaseAvailable,
  freshDatabaseUrl,
  ManualClock,
  startServer,
  TestClient,
  type Harness,
} from "./support";

let url: string;
let drop: () => Promise<void>;
beforeAll(async () => {
  if (!databaseAvailable) return;
  const db = await freshDatabaseUrl();
  url = db.url;
  drop = db.drop;
});
afterAll(async () => {
  if (databaseAvailable) await drop();
});

describe.skipIf(!databaseAvailable)("async games (SPEC §3, §9.4)", () => {
  it("survive a server restart: state rebuilt from snapshot + orders, deadlines still swept", async () => {
    const clock = new ManualClock();
    let h: Harness = await startServer(url, clock);
    const g = await twoPlayerGame(h, DEFAULT_SETTINGS.async);
    let state = g.state;
    // 12 turns of random-legal play (it never ends early): past the turn-11 snapshot.
    for (let turn = 1; turn <= 12; turn++) {
      g.a.client.send({
        type: "submitOrders",
        gameId: g.gameId,
        turn,
        orders: randomOrderSet(state, 0, "a"),
      });
      g.b.client.send({
        type: "submitOrders",
        gameId: g.gameId,
        turn,
        orders: randomOrderSet(state, 1, "b"),
      });
      const r = await g.a.client.type("turnResolved", (m) => m.turn === turn);
      state = resolveTurn(state, ordersBySeat(r.ordersByPlayer)).state;
      if (state.result) throw new Error("game ended too early for this test");
    }
    const snaps = await h.database.db
      .select({ turn: gameSnapshots.turn })
      .from(gameSnapshots)
      .where(eq(gameSnapshots.gameId, g.gameId));
    expect(snaps.map((s) => s.turn).sort((a, b) => a - b)).toEqual([1, 11]);
    // A sealed submission is pending when the server goes down.
    const pending = randomOrderSet(state, 0, "pending");
    g.a.client.send({ type: "submitOrders", gameId: g.gameId, turn: 13, orders: pending });
    await g.b.client.type("playerSubmitted", (m) => m.turn === 13);
    g.a.client.close();
    g.b.client.close();
    await h.close();

    // Restart: a fresh process on the same database.
    h = await startServer(url, clock);
    await h.engine.restore();
    const b = await TestClient.open(h, g.b.token);
    b.send({ type: "subscribe", gameId: g.gameId });
    const s = await b.type("gameState");
    expect(hashState(s.state as GameState)).toBe(hashState(state));
    expect(s.meta.players.map((p) => p.submitted)).toEqual([true, false]);

    // B never plays; the 24 h deadline passes while nothing runs but the sweeper.
    clock.advance(24 * 3600_000 + 1);
    expect(await h.engine.sweep()).toBe(1);
    const r = await b.type("turnResolved", (m) => m.turn === 13);
    expect(r.ordersByPlayer["0"]).toEqual(pending);
    expect(r.ordersByPlayer["1"]).toEqual([]);
    state = resolveTurn(state, ordersBySeat(r.ordersByPlayer)).state;
    expect(hashState(state)).toBe(r.stateHash);
    // Async games never hand seats to the bot.
    const meta = await api<{ players: { botControlled: boolean }[]; turn: number }>(
      h,
      "GET",
      `/api/games/${g.gameId}`,
      g.b.token,
    );
    expect(meta.body.turn).toBe(14);
    expect(meta.body.players.every((p) => !p.botControlled)).toBe(true);
    b.close();
    await h.close();
  });

  it("pushes 'your turn' when a turn opens and a reminder 1 h before the deadline", async () => {
    const clock = new ManualClock();
    const h = await startServer(url, clock);
    const sub = (n: string) => ({
      endpoint: `https://push.example.test/${n}`,
      keys: { p256dh: "p", auth: "a" },
    });
    const g = await (async () => {
      // Subscribe both players before the game starts.
      const game = await twoPlayerGame(h, DEFAULT_SETTINGS.async);
      return game;
    })();
    await api(h, "POST", "/api/push/subscribe", g.a.token, sub("a"));
    await api(h, "POST", "/api/push/subscribe", g.b.token, sub("b"));
    h.push.sent.length = 0;

    // Turn 1 resolves; turn 2 opens: both get "Your turn".
    g.a.client.send({ type: "submitOrders", gameId: g.gameId, turn: 1, orders: [] });
    g.b.client.send({ type: "submitOrders", gameId: g.gameId, turn: 1, orders: [] });
    await g.a.client.type("turnResolved");
    await new Promise((r) => setTimeout(r, 50));
    expect(h.push.sent.map((p) => [p.target.endpoint.slice(-1), p.payload.title]).sort()).toEqual([
      ["a", "Your turn"],
      ["b", "Your turn"],
    ]);

    // A submits; an hour before the deadline only B is reminded, once.
    h.push.sent.length = 0;
    g.a.client.send({ type: "submitOrders", gameId: g.gameId, turn: 2, orders: [] });
    await g.b.client.type("playerSubmitted", (m) => m.turn === 2);
    clock.advance(23 * 3600_000 + 1);
    await h.engine.sweep();
    await h.engine.sweep();
    expect(h.push.sent.map((p) => [p.target.endpoint.slice(-1), p.payload.title])).toEqual([
      ["b", "1 hour left"],
    ]);
    const row = await h.database.db.query.games.findFirst({ where: and(eq(games.id, g.gameId)) });
    expect(row?.reminderSentTurn).toBe(2);

    // Expired subscriptions are dropped.
    h.push.gone.add(sub("b").endpoint);
    clock.advance(3600_000);
    await h.engine.sweep();
    await new Promise((r) => setTimeout(r, 50));
    const left = await h.database.db.query.pushSubscriptions.findMany();
    expect(left.map((s) => s.endpoint).filter((e) => e.endsWith("/b"))).toEqual([]);
    await h.close();
  });
});
