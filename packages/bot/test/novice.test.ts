import { describe, expect, it } from "vitest";
import {
  createGame,
  getBoard,
  PLAYABLE_STRAINS,
  resolveTurn,
  type GameState,
  type PlayerId,
} from "@swarm/sim";
import { chooseOrders, type Difficulty } from "../src/index";
import { NOVICE } from "../src/weights";

/** Every (state, Novice orders) pair from whole games, Novice in seat 1. */
function* novicePlans(
  seed: string,
  mode: "singleRock" | "system",
  foe: Difficulty,
): Generator<{ state: GameState; orders: ReturnType<typeof chooseOrders> }> {
  let s = createGame({ mode, playerCount: 2, strains: [...PLAYABLE_STRAINS].slice(0, 2) }, seed);
  while (!s.result) {
    const orders = chooseOrders(s, 1, "novice", `${seed}:1`);
    yield { state: s, orders };
    s = resolveTurn(s, { 0: chooseOrders(s, 0, foe, `${seed}:0`), 1: orders }).state;
  }
}

/** Grow paths that enter a cell another player owns at the start of the turn. */
function assaults(state: GameState, me: PlayerId, orders: ReturnType<typeof chooseOrders>) {
  let n = 0;
  for (const o of orders) {
    if (o.type !== "grow") continue;
    const body = state.bodies[o.body]!;
    const board = getBoard(body.radius);
    for (const h of o.path.slice(1)) {
      const c = body.colony[board.indexOf(h.q, h.r)];
      if (c && c.owner !== me) n++;
    }
  }
  return n;
}

describe("Novice bot (campaign nodes 1–3, DECISIONS #122)", () => {
  it("keeps to its order cap and starts no fights before its peace turn", () => {
    let turns = 0;
    let fights = 0;
    for (const [seed, mode, foe] of [
      ["novice-1", "singleRock", "easy"],
      ["novice-2", "system", "normal"],
      ["novice-3", "singleRock", "normal"],
    ] as const) {
      for (const { state, orders } of novicePlans(seed, mode, foe)) {
        turns++;
        const plan = orders.filter((o) => o.type !== "draft");
        expect(plan.length).toBeLessThanOrEqual(NOVICE.maxOrders);
        const a = assaults(state, 1, plan);
        if (state.turn < NOVICE.peaceUntilTurn) expect(a).toBe(0);
        fights += a;
      }
    }
    expect(turns).toBeGreaterThan(30);
    // It still fights once the peace is over: a soft opponent, not a passive one.
    expect(fights).toBeGreaterThan(0);
  });

  it("loses to Easy far more often than Easy loses to itself", () => {
    const wins = { novice: 0, easy: 0 };
    for (const d of ["novice", "easy"] as const) {
      for (let g = 0; g < 8; g++) {
        let s = createGame({ mode: "singleRock", playerCount: 2 }, `novice-vs-${g}`);
        while (!s.result) {
          s = resolveTurn(s, {
            0: chooseOrders(s, 0, "easy", `e${g}`),
            1: chooseOrders(s, 1, d, `n${g}`),
          }).state;
        }
        if (s.result?.winner === 1) wins[d]++;
      }
    }
    expect(wins.novice).toBeLessThan(wins.easy);
  });
});
