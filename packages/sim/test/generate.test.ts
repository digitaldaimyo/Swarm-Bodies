import { describe, expect, it } from "vitest";
import {
  createGame,
  diskCellCount,
  getBoard,
  hashState,
  hexDistance,
  isOneRegion,
  type Hex,
} from "./sim";

const seeds = Array.from({ length: 25 }, (_, i) => `gen-${i}`);

describe("SPEC §4.1–4.4 Single Rock generation", () => {
  it("is deterministic per seed and differs between seeds", () => {
    const a = createGame({ mode: "singleRock", playerCount: 2 }, "same");
    const b = createGame({ mode: "singleRock", playerCount: 2 }, "same");
    const c = createGame({ mode: "singleRock", playerCount: 2 }, "other");
    expect(hashState(a)).toBe(hashState(b));
    expect(hashState(a)).not.toBe(hashState(c));
  });

  it("only supports two players", () => {
    expect(() => createGame({ mode: "singleRock", playerCount: 3 }, "x")).toThrow();
  });

  it.each(seeds)("seed %s: one Large body with sensible terrain", (seed) => {
    const s = createGame({ mode: "singleRock", playerCount: 2 }, seed);
    expect(s.bodies).toHaveLength(1);
    const body = s.bodies[0]!;
    const board = getBoard(body.radius);
    expect(body.size).toBe("large");
    expect(body.radius).toBe(9);
    expect(board.cells).toHaveLength(271);
    expect(diskCellCount(9)).toBe(271);

    // Rock: about 8% (target 21 of 271), never splitting the body.
    const rock = body.terrain.filter((t) => t === "rock").length;
    expect(rock).toBeGreaterThanOrEqual(14);
    expect(rock).toBeLessThanOrEqual(22);
    expect(isOneRegion(board, body.terrain)).toBe(true);

    // Deposits: about 6% (16 of 271), only on regolith.
    const deposits = body.deposits.filter((d) => d !== null).length;
    expect(deposits).toBeGreaterThanOrEqual(14);
    expect(deposits).toBeLessThanOrEqual(17);
    body.deposits.forEach((d, i) => {
      if (d) expect(body.terrain[i]).toBe("regolith");
    });

    // Point symmetry: player 1's position mirrors player 0's.
    board.cells.forEach((h, i) => {
      const m = board.indexOf(-h.q, -h.r);
      expect(body.terrain[m]).toBe(body.terrain[i]);
      expect(body.deposits[m]).toBe(body.deposits[i]);
    });
  });

  it.each(seeds)("seed %s: starting state per SPEC §4.4", (seed) => {
    const s = createGame({ mode: "singleRock", playerCount: 2 }, seed);
    const body = s.bodies[0]!;
    const board = getBoard(body.radius);
    for (const p of s.players) {
      expect(p.nutrients).toBe(10);
      const core = body.colony[board.indexOf(p.home.cell.q, p.home.cell.r)];
      expect(core).toEqual({
        owner: p.id,
        biomass: 5,
        core: true,
        connected: true,
        fruiting: null,
      });
      const own = body.colony
        .map((c, i) => ({ c, h: board.cells[i] as Hex }))
        .filter((x) => x.c?.owner === p.id);
      expect(own).toHaveLength(3);
      for (const { c, h } of own) {
        if (c!.core) continue;
        expect(c).toEqual({
          owner: p.id,
          biomass: 2,
          core: false,
          connected: true,
          fruiting: null,
        });
        expect(hexDistance(h, p.home.cell)).toBe(1);
      }
      // Guaranteed Organic and Ice within 3 cells of the core.
      const near = board.cells
        .map((h, i) => ({ h, d: body.deposits[i] }))
        .filter((x) => hexDistance(x.h, p.home.cell) <= 3);
      expect(near.some((x) => x.d === "organic")).toBe(true);
      expect(near.some((x) => x.d === "ice")).toBe(true);
    }
    // Opposite edges.
    const [a, b] = s.players.map((p) => p.home.cell) as [Hex, Hex];
    expect(a).toEqual({ q: 0 - b.q, r: 0 - b.r });
    expect(hexDistance(a, { q: 0, r: 0 })).toBe(8);
  });
});
