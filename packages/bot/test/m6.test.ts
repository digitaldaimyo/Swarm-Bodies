import { describe, expect, it } from "vitest";
import {
  createGame,
  resolveTurn,
  validateOrderSet,
  type GameState,
  type MutationId,
  type OrderSet,
  type PlayerId,
} from "@swarm/sim";
import { chooseOrders } from "../src/index";
import { AFFINITY, pickMutation } from "../src/drafts";

const withDraft = (
  s: GameState,
  options: MutationId[],
  strain = s.players[0]!.strain,
): GameState => ({
  ...s,
  players: s.players.map((p) => (p.id === 0 ? { ...p, strain, draft: { index: 0, options } } : p)),
});

describe("SPEC §13.2 draft picks", () => {
  it("follows the strain's affinity table", () => {
    const s = createGame({ mode: "system", playerCount: 2 }, "draft-bot");
    expect(
      pickMutation(withDraft(s, ["cryophile", "acid_tendrils", "dormancy"], "predator"), 0),
    ).toBe("acid_tendrils");
    expect(
      pickMutation(withDraft(s, ["acid_tendrils", "thick_veins", "dormancy"], "biofilm"), 0),
    ).toBe("thick_veins");
    expect(
      pickMutation(withDraft(s, ["quorum", "hardened_spores", "lithotroph"], "sporer"), 0),
    ).toBe("hardened_spores");
    expect(Object.keys(AFFINITY)).toEqual(["base", "swarmer", "biofilm", "predator", "sporer"]);
  });

  it("never wants spore mutations on Single Rock", () => {
    const s = createGame({ mode: "singleRock", playerCount: 2 }, "draft-rock");
    expect(
      pickMutation(withDraft(s, ["hardened_spores", "rapid_fruiting", "dormancy"], "sporer"), 0),
    ).toBe("dormancy");
  });

  it("puts the pick first and plans with it in effect", () => {
    const s = withDraft(createGame({ mode: "system", playerCount: 2 }, "draft-first"), [
      "chemotaxis",
      "cryophile",
      "dormancy",
    ]);
    for (const d of ["easy", "normal", "hard"] as const) {
      const orders = chooseOrders(s, 0, d, "x");
      expect(orders[0]).toEqual({ type: "draft", mutation: pickMutation(s, 0) });
      expect(validateOrderSet(s, 0, orders)).toMatchObject({ ok: true });
    }
  });
});

describe("SPEC §13.2 Hard", () => {
  it("plays legal, deterministic sets within the time budget", () => {
    for (const [mode, n] of [
      ["singleRock", 2],
      ["system", 4],
    ] as const) {
      let s = createGame(
        {
          mode,
          playerCount: n,
          strains: ["predator", "sporer", "swarmer", "biofilm"].slice(0, n) as never,
        },
        `hard-${mode}`,
      );
      let worst = 0;
      for (let t = 0; t < 16 && !s.result; t++) {
        const sets: Record<PlayerId, OrderSet> = {};
        for (const p of s.players) {
          const t0 = performance.now();
          const o = chooseOrders(s, p.id, p.id === 0 ? "hard" : "normal", "budget");
          if (p.id === 0) worst = Math.max(worst, performance.now() - t0);
          expect(validateOrderSet(s, p.id, o)).toMatchObject({ ok: true });
          sets[p.id] = o;
        }
        if (t % 5 === 0) expect(chooseOrders(s, 0, "hard", "budget")).toEqual(sets[0]);
        s = resolveTurn(s, sets).state;
      }
      // SPEC §13.1: 1 s on the server; phones get the 200 ms budget in a worker. CI machines
      // vary, so this guards against regressions by an order of magnitude, not tight timing.
      expect(worst).toBeLessThan(1000);
    }
  });
});
