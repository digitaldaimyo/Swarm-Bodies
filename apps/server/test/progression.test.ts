import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chooseOrders } from "@swarm/bot";
import { dailySetup, emptyProgress, sectorFor, seasonAt } from "@swarm/content";
import { ordersBySeat } from "@swarm/protocol";
import { createGame, hashState, resolveTurn, type GameState, type OrderSet } from "@swarm/sim";
import {
  api,
  databaseAvailable,
  freshDatabaseUrl,
  guest,
  startServer,
  TestClient,
  type Harness,
} from "./support";

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

/** Plays today's Daily with a bot in your seat; returns your orders per turn. */
function playDaily(date: string, you: "easy" | "normal" | "hard"): OrderSet[] {
  const setup = dailySetup(date);
  let state = createGame(setup.config, setup.seed);
  const mine: OrderSet[] = [];
  while (!state.result) {
    const o = chooseOrders(state, 0, you, `player-${you}`);
    mine.push(o);
    state = resolveTurn(state, { 0: o, 1: chooseOrders(state, 1, "normal", setup.botSeed) }).state;
  }
  return mine;
}

const TODAY = "2026-11-12"; // ManualClock's default day

describe.skipIf(!databaseAvailable)("M7 progression (SPEC §11)", () => {
  it("progress syncs by union and never rolls back", async () => {
    const a = await guest(h);
    const first = await api<{ progress: { completedNodes: string[] } }>(
      h,
      "PUT",
      "/api/progress",
      a.token,
      {
        progress: {
          ...emptyProgress(),
          completedNodes: ["c01", "c02"],
          achievements: ["first_win"],
        },
      },
    );
    expect(first.status).toBe(200);
    // Another device that only knows c01 still ends up with both.
    const second = await api<{ progress: { completedNodes: string[]; achievements: string[] } }>(
      h,
      "PUT",
      "/api/progress",
      a.token,
      { progress: { ...emptyProgress(), completedNodes: ["c01", "c03"] } },
    );
    expect(second.body.progress.completedNodes).toEqual(["c01", "c02", "c03"]);
    expect(second.body.progress.achievements).toEqual(["first_win"]);
    const got = await api<{ progress: { completedNodes: string[] } }>(
      h,
      "GET",
      "/api/progress",
      a.token,
    );
    expect(got.body.progress.completedNodes).toEqual(["c01", "c02", "c03"]);
    expect(
      (await api(h, "PUT", "/api/progress", a.token, { progress: { version: 2 } })).status,
    ).toBe(400);
  });

  it("validates Daily runs by replaying them, keeps the best, and ranks the leaderboard", async () => {
    const hard = playDaily(TODAY, "hard");
    const easy = playDaily(TODAY, "easy");
    const a = await guest(h);
    const b = await guest(h);
    const ra = await api<{ score: number; rank: number; best: boolean; streak: number }>(
      h,
      "POST",
      "/api/daily",
      a.token,
      { date: TODAY, turns: hard },
    );
    expect(ra.status).toBe(200);
    expect(ra.body).toMatchObject({ best: true, rank: 1, streak: 1 });
    const rb = await api<{ score: number }>(h, "POST", "/api/daily", b.token, {
      date: TODAY,
      turns: easy,
    });
    expect(rb.status).toBe(200);
    // A rerun only replaces the stored run when it scores higher.
    const again = await api<{ best: boolean; score: number }>(h, "POST", "/api/daily", a.token, {
      date: TODAY,
      turns: easy,
    });
    expect(again.body.best).toBe(again.body.score > ra.body.score);
    const best = Math.max(ra.body.score, again.body.score);

    const board = await api<{
      entries: { name: string; score: number; you: boolean; rank: number }[];
      me: { score: number } | null;
      players: number;
    }>(h, "GET", "/api/daily", a.token);
    expect(board.status).toBe(200);
    expect(board.body.players).toBeGreaterThanOrEqual(2);
    const scores = board.body.entries.map((e) => e.score);
    expect(scores).toEqual([...scores].sort((x, y) => y - x));
    expect(board.body.entries.find((e) => e.you)?.score).toBe(best);
    expect(board.body.me?.score).toBe(best);
  });

  it("rejects forged, unfinished and closed Daily runs", async () => {
    const a = await guest(h);
    const run = playDaily(TODAY, "normal");
    // Unfinished: the last turn is missing.
    const short = await api<{ code: string }>(h, "POST", "/api/daily", a.token, {
      date: TODAY,
      turns: run.slice(0, -1),
    });
    expect(short.body.code).toBe("badDaily");
    // Forged: an order the sim rejects (a reinforce of a cell you do not own).
    const forged = [[{ type: "reinforce", body: 0, cell: { q: 9, r: -9 } }], ...run.slice(1)];
    expect(
      (
        await api<{ code: string }>(h, "POST", "/api/daily", a.token, {
          date: TODAY,
          turns: forged,
        })
      ).body.code,
    ).toBe("badDaily");
    // Extra turns after the game ended.
    expect(
      (
        await api<{ code: string }>(h, "POST", "/api/daily", a.token, {
          date: TODAY,
          turns: [...run, []],
        })
      ).body.code,
    ).toBe("badDaily");
    // Last week's seed is closed.
    expect(
      (
        await api<{ code: string }>(h, "POST", "/api/daily", a.token, {
          date: "2026-11-05",
          turns: playDaily("2026-11-05", "normal"),
        })
      ).body.code,
    ).toBe("staleDaily");
  });

  it("counts a Daily streak over consecutive days", async () => {
    const a = await guest(h);
    const yesterday = "2026-11-11";
    expect(
      (
        await api(h, "POST", "/api/daily", a.token, {
          date: yesterday,
          turns: playDaily(yesterday, "normal"),
        })
      ).status,
    ).toBe(200);
    const r = await api<{ streak: number }>(h, "POST", "/api/daily", a.token, {
      date: TODAY,
      turns: playDaily(TODAY, "normal"),
    });
    expect(r.body.streak).toBe(2);
  });

  it("ranked queue makes a sector game; its result moves Glicko-2 ratings onto the ladder", async () => {
    const a = await guest(h);
    const b = await guest(h);
    const qa = await api<{ status: string }>(h, "POST", "/api/queue", a.token, {
      pace: "live",
      strain: "swarmer",
      ranked: true,
    });
    expect(qa.body.status).toBe("queued");
    // A casual queue does not match a ranked one.
    const c = await guest(h);
    expect(
      (
        await api<{ status: string }>(h, "POST", "/api/queue", c.token, {
          pace: "live",
          strain: "biofilm",
        })
      ).body.status,
    ).toBe("queued");
    const qb = await api<{ status: string; gameId: string }>(h, "POST", "/api/queue", b.token, {
      pace: "live",
      strain: "biofilm",
      ranked: true,
    });
    expect(qb.body.status).toBe("matched");
    const gameId = qb.body.gameId;
    const meta = await api<{ ranked?: boolean; sector?: string }>(
      h,
      "GET",
      `/api/games/${gameId}`,
      a.token,
    );
    const season = seasonAt(h.clock.now()).season;
    expect(meta.body).toMatchObject({ ranked: true, sector: sectorFor(season).name });

    const ca = await TestClient.open(h, a.token);
    const cb = await TestClient.open(h, b.token);
    ca.send({ type: "subscribe", gameId });
    cb.send({ type: "subscribe", gameId });
    let state = (await ca.type("gameState")).state as GameState;
    await cb.type("gameState");
    // Seat 0 is whoever queued first (A).
    for (let turn = 1; state.result === null && turn <= 60; turn++) {
      ca.send({
        type: "submitOrders",
        gameId,
        turn,
        orders: chooseOrders(state, 0, "normal", "a"),
      });
      cb.send({ type: "submitOrders", gameId, turn, orders: chooseOrders(state, 1, "easy", "b") });
      const r = await ca.type("turnResolved", (m) => m.turn === turn);
      state = resolveTurn(state, ordersBySeat(r.ordersByPlayer)).state;
      expect(hashState(state)).toBe(r.stateHash);
    }
    expect(state.result).not.toBeNull();
    await ca.type("gameOver");
    ca.close();
    cb.close();

    const ladder = await api<{
      season: number;
      sector: { name: string };
      entries: unknown[];
      me: { rating: number; games: number; rank: number; wins: number };
    }>(h, "GET", "/api/ladder?mode=duel", a.token);
    expect(ladder.status).toBe(200);
    expect(ladder.body.season).toBe(season);
    expect(ladder.body.me.games).toBe(1);
    // One game is provisional: rated, but not yet placed on the board.
    expect(ladder.body.me.rank).toBe(0);
    expect(ladder.body.entries).toHaveLength(0);
    const winner = state.result?.winner;
    const mine = ladder.body.me.rating;
    if (winner === 0) expect(mine).toBeGreaterThan(1500);
    if (winner === 1) expect(mine).toBeLessThan(1500);
    // The replay carries the sector rules so a link reproduces the game.
    const replay = await api<{ ranked: boolean; turns: unknown[] }>(
      h,
      "GET",
      `/api/replays/${gameId}`,
      a.token,
    );
    expect(replay.body.ranked).toBe(true);
    expect(replay.body.turns).toHaveLength(state.turn - 1);
  });

  it("places players on the ladder after enough games and grants the season reward later", async () => {
    const accounts = await Promise.all([guest(h), guest(h)]);
    const season = seasonAt(h.clock.now()).season;
    // Rate five finished duels directly (the queue path is covered above).
    const final = (winner: number) =>
      ({
        ...createGame({ mode: "singleRock", playerCount: 2 }, "x"),
        result: { winner, reason: "dominance", turn: 20 },
      }) as GameState;
    for (let i = 0; i < 5; i++)
      await h.progression.rateFinished(
        season,
        accounts.map((a, seat) => ({ accountId: a.accountId, seat })),
        final(0),
      );
    const board = await api<{ entries: { name: string; rank: number; wins: number }[] }>(
      h,
      "GET",
      "/api/ladder?mode=duel",
      accounts[1]!.token,
    );
    expect(board.body.entries.map((e) => e.name).slice(0, 2)).toContain(accounts[0]!.name);
    const top = board.body.entries.find((e) => e.name === accounts[0]!.name);
    expect(top?.wins).toBe(5);
    // The season trail arrives once the season is over.
    const before = await api<{ progress: { rewards: string[] } }>(
      h,
      "GET",
      "/api/progress",
      accounts[0]!.token,
    );
    expect(before.body.progress.rewards).not.toContain("season");
    h.clock.advance(43 * 86_400_000);
    const after = await api<{ progress: { rewards: string[] } }>(
      h,
      "GET",
      "/api/progress",
      accounts[0]!.token,
    );
    expect(after.body.progress.rewards).toContain("season");
    h.clock.advance(-43 * 86_400_000);
  });
});
