import { describe, expect, it } from "vitest";
import { getBoard, PLAYABLE_STRAINS } from "@swarm/sim";
import { scenario } from "@swarm/sim/testing";
import { frontier, spread, strainStyle } from "../src/game/personality";

describe("strain personality (colony life, phase 5)", () => {
  it("styles echo the strains: thin and quick, thick and slow, dark and jagged, specks", () => {
    const sw = strainStyle("swarmer");
    const bf = strainStyle("biofilm");
    expect(sw.vein).toBeLessThan(1);
    expect(sw.pace).toBeLessThan(1);
    expect(bf.vein).toBeGreaterThan(1);
    expect(bf.pace).toBeGreaterThan(1);
    expect(strainStyle("predator").shade).toBeLessThan(0);
    expect(strainStyle("predator").jag).toBeGreaterThan(0);
    expect(strainStyle("sporer").specks).toBe(true);
    // Every playable strain has its own look, and an unknown one falls back to base.
    const looks = new Set(PLAYABLE_STRAINS.map((s) => JSON.stringify(strainStyle(s))));
    expect(looks.size).toBe(PLAYABLE_STRAINS.length);
    expect(strainStyle(undefined)).toEqual(strainStyle("base"));
  });

  it("feelers reach from connected cells to empty, open neighbours only", () => {
    const s = scenario({
      rock: [{ q: 1, r: -1 }],
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        { q: 1, r: 0, owner: 1, biomass: 2 },
        { q: -3, r: 3, owner: 0, biomass: 2 },
      ],
    });
    const body = s.bodies[0]!;
    const board = getBoard(body.radius);
    const at = (q: number, r: number) => board.indexOf(q, r);
    const f = frontier(body, body.colony, 0);
    // The core's six neighbours, less the rock and the enemy cell; none from the cut-off cell.
    expect(f.every((x) => x.from === at(0, 0))).toBe(true);
    expect(f.map((x) => x.to)).not.toContain(at(1, -1));
    expect(f.map((x) => x.to)).not.toContain(at(1, 0));
    expect(f).toHaveLength(4);
  });

  it("spreads a long list evenly under a cap", () => {
    expect(spread([1, 2, 3], 5)).toEqual([1, 2, 3]);
    expect(spread([0, 1, 2, 3, 4, 5, 6, 7], 4)).toEqual([0, 2, 4, 6]);
  });
});
