import { describe, expect, it } from "vitest";
import { createGame, playerRules, resolveTurn, validateOrderSet } from "./sim";
import { cellAt, grow, reinforce, scenario, type CellSpec } from "./helpers";

const P1: CellSpec = { q: -8, r: 0, owner: 1, biomass: 5, core: true };

describe("SPEC §7.1 strains", () => {
  it("createGame assigns strains by seat", () => {
    const s = createGame(
      { mode: "singleRock", playerCount: 2, strains: ["swarmer", "biofilm"] },
      "s",
    );
    expect(s.players.map((p) => p.strain)).toEqual(["swarmer", "biofilm"]);
    expect(
      createGame({ mode: "singleRock", playerCount: 2 }, "s").players.map((p) => p.strain),
    ).toEqual(["base", "base"]);
  });

  it("resolves per-player rules", () => {
    const s = scenario({ cells: [P1], strains: ["swarmer", "biofilm"] });
    expect(playerRules(s, 0)).toMatchObject({
      growReach: 4,
      entryCostDelta: -1,
      maxBiomass: 7,
      coreMaxBiomass: 10,
    });
    expect(playerRules(s, 1)).toMatchObject({
      growReach: 2,
      maxBiomass: 12,
      coreMaxBiomass: 15,
      defenseSupport: 2,
      reinforceAmount: 4,
    });
  });

  describe("Swarmer: reach 4, entry cost −1, max biomass 7", () => {
    const s = () =>
      scenario({
        cells: [
          { q: 0, r: 0, owner: 0, biomass: 5, core: true },
          { q: 1, r: 0, owner: 0, biomass: 6 },
          P1,
        ],
        deposits: [{ q: 2, r: 0, kind: "mineral" }],
        strains: ["swarmer", "base"],
      });
    it("grows up to 4 cells at 1 N each (mineral still +1)", () => {
      expect(validateOrderSet(s(), 0, [grow([1, 0], [2, 0], [3, 0], [4, 0], [5, 0])])).toEqual({
        ok: true,
        cost: 2 + 1 + 1 + 1,
      });
      expect(
        validateOrderSet(s(), 0, [grow([1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [6, 0])]),
      ).toMatchObject({ reason: "pathTooLong" });
    });
    it("caps reinforcement and captures at 7", () => {
      const { state } = resolveTurn(s(), { 0: [reinforce(1, 0)] });
      expect(cellAt(state, 1, 0)?.biomass).toBe(7);
      expect(validateOrderSet(state, 0, [reinforce(1, 0)])).toMatchObject({
        reason: "atMaxBiomass",
      });
      const cap = scenario({
        cells: [
          { q: 0, r: 0, owner: 0, biomass: 9, core: true },
          { q: 1, r: 0, owner: 1, biomass: 1 },
          P1,
        ],
        strains: ["swarmer", "base"],
      });
      expect(cellAt(resolveTurn(cap, { 0: [grow([0, 0], [1, 0])] }).state, 1, 0)).toMatchObject({
        owner: 0,
        biomass: 7,
      });
    });
  });

  describe("Biofilm: reach 2, max biomass 12, support 2, reinforce +4", () => {
    it("limits reach to 2", () => {
      const s = scenario({
        cells: [{ q: 0, r: 0, owner: 0, biomass: 5, core: true }, P1],
        strains: ["biofilm", "base"],
      });
      expect(validateOrderSet(s, 0, [grow([0, 0], [1, 0], [2, 0])]).ok).toBe(true);
      expect(validateOrderSet(s, 0, [grow([0, 0], [1, 0], [2, 0], [3, 0])])).toMatchObject({
        reason: "pathTooLong",
      });
    });
    it("reinforces by 4 up to 12 (cores up to 15)", () => {
      const s = scenario({
        cells: [
          { q: 0, r: 0, owner: 0, biomass: 12, core: true },
          { q: 1, r: 0, owner: 0, biomass: 9 },
          P1,
        ],
        strains: ["biofilm", "base"],
      });
      const { state } = resolveTurn(s, { 0: [reinforce(0, 0), reinforce(1, 0)] });
      expect(cellAt(state, 0, 0)?.biomass).toBe(15);
      expect(cellAt(state, 1, 0)?.biomass).toBe(12);
    });
    it("defends with support 2 per connected neighbour", () => {
      const cells: CellSpec[] = [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        { q: 1, r: 0, owner: 0, biomass: 6 },
        { q: 2, r: 0, owner: 1, biomass: 2 },
        { q: 3, r: 0, owner: 1, biomass: 5, core: true },
      ];
      const base = resolveTurn(scenario({ cells }), { 0: [grow([1, 0], [2, 0])] });
      expect(base.events).toContainEqual(
        expect.objectContaining({ type: "CellCaptured", attack: 6, defense: 3 }),
      );
      const film = resolveTurn(scenario({ cells, strains: ["base", "biofilm"] }), {
        0: [grow([1, 0], [2, 0])],
      });
      expect(film.events).toContainEqual(
        expect.objectContaining({ type: "CellCaptured", attack: 6, defense: 4 }),
      );
    });
  });
});
