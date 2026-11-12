import { describe, expect, it } from "vitest";
import golden from "./golden/replays.json";
import {
  createGame,
  hashState,
  resolveTurn,
  type GameConfig,
  type OrderSet,
  type PlayerId,
} from "./sim";

// SPEC §9.3 / §15 M1: committed golden replays must reproduce their hashes exactly.
// If a sim change moves these deliberately, run `pnpm golden:update` and explain why in the commit.
describe("golden replays", () => {
  it("has 50 replays: 20 Single Rock and 30 star systems (SPEC §15 M5)", () => {
    expect(golden.replays).toHaveLength(50);
    expect(golden.replays.filter((r) => r.config.mode === "system")).toHaveLength(30);
  });

  it.each(golden.replays.map((r) => [r.seed, r] as const))(
    "%s reproduces every turn hash",
    (_seed, replay) => {
      let state = createGame(replay.config as GameConfig, replay.seed);
      expect(hashState(state)).toBe(replay.initialHash);
      replay.orders.forEach((turn, t) => {
        const byPlayer: Record<PlayerId, OrderSet> = {};
        turn.forEach((orders, p) => (byPlayer[p] = orders as OrderSet));
        state = resolveTurn(state, byPlayer).state;
        expect(hashState(state), `turn ${t + 1}`).toBe(replay.hashes[t]);
      });
      expect(state.result).toEqual(replay.result);
    },
  );
});
