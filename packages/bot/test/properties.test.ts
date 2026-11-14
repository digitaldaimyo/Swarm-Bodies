import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createGame, resolveTurn, validateOrderSet, type GameState } from "@swarm/sim";
import { chooseOrders, type Difficulty } from "../src/index";

function* play(seed: string, a: Difficulty, b: Difficulty): Generator<GameState> {
  let s = createGame({ mode: "singleRock", playerCount: 2 }, seed);
  while (!s.result) {
    yield s;
    s = resolveTurn(s, {
      0: chooseOrders(s, 0, a, `${seed}:0`),
      1: chooseOrders(s, 1, b, `${seed}:1`),
    }).state;
  }
}

describe("SPEC §13.1 bot contract", () => {
  it("always returns a valid set within budget, deterministically", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.constantFrom<Difficulty>("easy", "normal", "hard"),
        fc.constantFrom<Difficulty>("novice", "easy", "normal"),
        (seed, a, b) => {
          let turns = 0;
          for (const s of play(seed, a, b)) {
            if (turns++ % 4 !== 0) continue; // sample turns to keep the run quick
            for (const p of [0, 1]) {
              const d = p === 0 ? a : b;
              const orders = chooseOrders(s, p, d, "prop");
              expect(validateOrderSet(s, p, orders)).toMatchObject({ ok: true });
              expect(orders.length).toBeLessThanOrEqual(s.rules.maxOrdersPerSet);
              expect(chooseOrders(s, p, d, "prop")).toEqual(orders);
            }
          }
        },
      ),
      { numRuns: 12 },
    );
  });
});

describe("SPEC §15 M2 time budget", () => {
  // 200 ms on mobile with a 4× safety factor: under 50 ms per turn in Node, on a Large body.
  it("chooses Normal orders in under 50 ms per turn across full games", () => {
    let worst = 0;
    for (const seed of ["time-0", "time-1", "time-2"]) {
      for (const s of play(seed, "normal", "normal")) {
        for (const p of [0, 1]) {
          chooseOrders(s, p, "normal", "warm"); // warm-up, so JIT compilation is not counted
          const runs: number[] = [];
          for (let i = 0; i < 3; i++) {
            const t = performance.now();
            chooseOrders(s, p, "normal", "t");
            runs.push(performance.now() - t);
          }
          worst = Math.max(worst, runs.sort((x, y) => x - y)[1]!);
        }
      }
    }
    expect(s(worst)).toBeLessThan(50);
  });
});

const s = (ms: number) => Math.round(ms * 10) / 10;
