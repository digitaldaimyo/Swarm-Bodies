import { describe, expect, it } from "vitest";
import { authoredGame, getBoard, hashState, resolveTurn, type AuthoredMap } from "../src";

const map: AuthoredMap = {
  radius: 5,
  rock: [{ q: 0, r: -1 }],
  deposits: [{ q: 2, r: -1, kind: "ice" }],
  nutrients: [10, 4],
  cells: [
    { q: -3, r: 0, owner: 0, biomass: 5, core: true },
    { q: -2, r: 0, owner: 0, biomass: 2 },
    { q: 3, r: 0, owner: 1, biomass: 5, core: true },
    { q: -4, r: 4, owner: 0, biomass: 1 },
  ],
};

describe("authored maps (Training grounds)", () => {
  it("builds exactly the board it is given", () => {
    const s = authoredGame(map);
    const body = s.bodies[0]!;
    const board = getBoard(5);
    const at = (q: number, r: number) => board.indexOf(q, r);
    expect(body.radius).toBe(5);
    expect(body.colony.length).toBe(board.cells.length);
    expect(body.terrain[at(0, -1)]).toBe("rock");
    expect(body.deposits[at(2, -1)]).toBe("ice");
    expect(body.colony[at(-2, 0)]).toMatchObject({ owner: 0, biomass: 2, connected: true });
    // Connectivity is computed: the lone cell is cut off from the core.
    expect(body.colony[at(-4, 4)]).toMatchObject({ owner: 0, connected: false });
    expect(body.colony.filter(Boolean)).toHaveLength(4);
    expect(s.players.map((p) => p.nutrients)).toEqual([10, 4]);
    expect(s.players[1]!.home.cell).toEqual({ q: 3, r: 0 });
    expect(s.schedule).toEqual([]);
    expect(s.result).toBeNull();
  });

  it("is deterministic and resolves turns like any other game", () => {
    expect(hashState(authoredGame(map))).toBe(hashState(authoredGame(map)));
    const { state, events } = resolveTurn(authoredGame(map), {
      0: [
        {
          type: "grow",
          body: 0,
          path: [
            { q: -2, r: 0 },
            { q: -1, r: 0 },
          ],
        },
      ],
      1: [],
    });
    expect(events.some((e) => e.type === "CellClaimed")).toBe(true);
    expect(state.turn).toBe(2);
  });

  it("rejects maps that cannot be played", () => {
    expect(() =>
      authoredGame({ ...map, cells: [...map.cells, { q: 9, r: 0, owner: 0, biomass: 1 }] }),
    ).toThrow(/off/);
    expect(() =>
      authoredGame({ ...map, cells: [...map.cells, { q: 0, r: -1, owner: 0, biomass: 1 }] }),
    ).toThrow(/rock/);
    expect(() => authoredGame({ ...map, cells: map.cells.filter((c) => c.owner === 0) })).toThrow(
      /no core/,
    );
  });
});
