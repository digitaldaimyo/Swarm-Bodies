import { describe, expect, it } from "vitest";
import { createGame, randomOrderSet, validateOrderSet } from "@swarm/sim";
import {
  ClientMessageSchema,
  CreateGameRequestSchema,
  GameSettingsSchema,
  OrderSetSchema,
  parseClientMessage,
  parseServerMessage,
  ServerMessageSchema,
  type ClientMessage,
  type ServerMessage,
} from "../src/index";

describe("protocol (SPEC §9.4, §14)", () => {
  it("round-trips every order the sim can produce", () => {
    let s = createGame({ mode: "singleRock", playerCount: 2 }, "proto");
    for (let t = 0; t < 10; t++) {
      const orders = randomOrderSet(s, 0, "p");
      const back = OrderSetSchema.parse(JSON.parse(JSON.stringify(orders)));
      expect(back).toEqual(orders);
      expect(validateOrderSet(s, 0, back).ok).toBe(true);
      s = { ...s, turn: s.turn + 1 };
    }
  });

  it("round-trips client and server messages", () => {
    const client: ClientMessage[] = [
      { type: "hello", authToken: "x".repeat(32), clientVersion: "1" },
      { type: "subscribe", gameId: "g1" },
      {
        type: "submitOrders",
        gameId: "g1",
        turn: 3,
        orders: [{ type: "reinforce", body: 0, cell: { q: 1, r: -1 } }],
      },
      { type: "unsubmit", gameId: "g1", turn: 3 },
      { type: "requestState", gameId: "g1" },
      { type: "hashMismatch", gameId: "g1", turn: 3, clientHash: "a", serverHash: "b" },
      { type: "ping" },
    ];
    for (const m of client) expect(parseClientMessage(JSON.stringify(m))).toEqual(m);
    const server: ServerMessage[] = [
      { type: "welcome", accountId: "a", name: "Guest 1" },
      { type: "playerSubmitted", gameId: "g", seat: 1, turn: 2, submitted: true },
      { type: "playerStatus", gameId: "g", seat: 1, connected: false, botControlled: true },
      {
        type: "turnResolved",
        gameId: "g",
        turn: 2,
        ordersByPlayer: { "0": [], "1": [] },
        stateHash: "h",
        nextDeadline: null,
      },
      { type: "gameOver", gameId: "g", result: { winner: 0, reason: "dominance", turn: 9 } },
      { type: "error", code: "bad", message: "no" },
    ];
    for (const m of server) expect(parseServerMessage(JSON.stringify(m))).toEqual(m);
    expect(
      ServerMessageSchema.safeParse({ type: "gameState", meta: {}, state: null }).success,
    ).toBe(false);
  });

  it("rejects malformed and oversized messages", () => {
    expect(parseClientMessage("{not json")).toBeNull();
    expect(parseClientMessage(JSON.stringify({ type: "launchNukes" }))).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ type: "hello", authToken: "short", clientVersion: "1" })),
    ).toBeNull();
    const tooMany = Array.from({ length: 40 }, () => ({
      type: "reinforce",
      body: 0,
      cell: { q: 0, r: 0 },
    }));
    expect(
      ClientMessageSchema.safeParse({ type: "submitOrders", gameId: "g", turn: 1, orders: tooMany })
        .success,
    ).toBe(false);
    expect(
      OrderSetSchema.safeParse([{ type: "grow", body: 0, path: [{ q: 0.5, r: 0 }] }]).success,
    ).toBe(false);
  });

  it("only accepts the SPEC §3 timer presets", () => {
    expect(
      GameSettingsSchema.safeParse({ pace: "live", turnSeconds: 60, map: "singleRock", players: 2 })
        .success,
    ).toBe(true);
    expect(
      GameSettingsSchema.safeParse({ pace: "live", turnSeconds: 61, map: "singleRock", players: 2 })
        .success,
    ).toBe(false);
    expect(
      GameSettingsSchema.safeParse({
        pace: "async",
        turnSeconds: 43200,
        map: "singleRock",
        players: 2,
      }).success,
    ).toBe(true);
    expect(
      CreateGameRequestSchema.safeParse({
        settings: { pace: "async", turnSeconds: 60, map: "singleRock", players: 2 },
        strain: "swarmer",
      }).success,
    ).toBe(false);
  });
});
