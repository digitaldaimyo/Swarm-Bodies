import { describe, expect, it } from "vitest";
import { resolveTurn, validateOrderSet, type GameState, type OrderSet } from "@swarm/sim";
import { cellAt, scenario, type CellSpec } from "@swarm/sim/testing";
import { chooseOrders, generateCandidates, analyse, NORMAL_WEIGHTS } from "../src/index";

/** Plays one turn: the bot (player 0) against a passing opponent. */
function botTurn(state: GameState, difficulty: "easy" | "normal" = "normal") {
  const orders = chooseOrders(state, 0, difficulty, "puzzle");
  expect(validateOrderSet(state, 0, orders)).toMatchObject({ ok: true });
  return { orders, ...resolveTurn(state, { 0: orders, 1: [] }) };
}

const growTargets = (orders: OrderSet) =>
  orders.flatMap((o) => (o.type === "grow" ? o.path.slice(1).map((h) => `${h.q},${h.r}`) : []));

describe("SPEC §13.4 scenario puzzles (Normal)", () => {
  it("reinforces its threatened core", () => {
    const s = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        { q: -1, r: 0, owner: 0, biomass: 1 },
        { q: 1, r: 0, owner: 1, biomass: 7 },
        { q: 2, r: 0, owner: 1, biomass: 5, core: true },
      ],
      nutrients: [3, 10],
    });
    const { orders } = botTurn(s);
    expect(orders).toEqual([{ type: "reinforce", body: 0, cell: { q: 0, r: 0 } }]);
  });

  it("cuts a single-link supply line", () => {
    // Enemy core at (-3,0); (-2,0) is the only link to six more enemy cells. The other
    // capturable cell, (-1,0), is not a cut point ((-1,-1) bypasses it) but sits on a mineral
    // deposit, so only the sever value makes (-2,0) the better target.
    const enemyTail: CellSpec[] = [
      [-1, 0],
      [-1, -1],
      [0, 0],
      [1, 0],
      [0, -1],
      [1, -1],
    ].map(([q, r]) => ({ q: q!, r: r!, owner: 1, biomass: 2 }));
    const s = scenario({
      cells: [
        { q: -3, r: 0, owner: 1, biomass: 5, core: true },
        { q: -2, r: 0, owner: 1, biomass: 2 },
        ...enemyTail,
        { q: -2, r: 2, owner: 0, biomass: 5, core: true },
        { q: -2, r: 1, owner: 0, biomass: 8 },
      ],
      deposits: [{ q: -1, r: 0, kind: "mineral" }],
      nutrients: [3, 10],
    });
    const { orders, state } = botTurn(s);
    expect(growTargets(orders)).toEqual(["-2,0"]);
    expect(cellAt(state, -2, 0)).toMatchObject({ owner: 0 });
    for (const c of enemyTail)
      expect(cellAt(state, c.q, c.r)).toMatchObject({ owner: 1, connected: false });
  });

  it("captures the enemy's last core when it can", () => {
    const s = scenario({
      cells: [
        { q: -4, r: 0, owner: 0, biomass: 5, core: true },
        { q: -3, r: 0, owner: 0, biomass: 2 },
        { q: -2, r: 0, owner: 0, biomass: 9 },
        { q: -1, r: 0, owner: 1, biomass: 3, core: true },
        { q: 0, r: 0, owner: 1, biomass: 2 },
      ],
      deposits: [{ q: -4, r: 2, kind: "organic" }],
      nutrients: [2, 10],
    });
    const { state } = botTurn(s);
    expect(state.result).toEqual({ winner: 0, reason: "lastStanding", turn: 1 });
  });

  it("grows onto a nearby deposit before plain ground", () => {
    const s = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        { q: -8, r: 0, owner: 1, biomass: 5, core: true },
      ],
      deposits: [{ q: 1, r: 1, kind: "organic" }],
      nutrients: [4, 10],
    });
    const { orders } = botTurn(s);
    expect(growTargets(orders)).toContain("1,1");
  });

  it("reinforces a feeder to make an assault succeed", () => {
    // Attack 5 vs defense 5+1 fails; after +3 it captures and severs the enemy's tail.
    const s = scenario({
      cells: [
        { q: -2, r: 0, owner: 0, biomass: 5, core: true },
        { q: -1, r: 0, owner: 0, biomass: 5 },
        { q: 0, r: 0, owner: 1, biomass: 5 },
        { q: 1, r: -1, owner: 1, biomass: 5, core: true },
        { q: 0, r: 1, owner: 1, biomass: 1 },
        { q: 0, r: 2, owner: 1, biomass: 1 },
        { q: 0, r: 3, owner: 1, biomass: 1 },
      ],
      nutrients: [5, 10],
    });
    const { orders, state } = botTurn(s);
    expect(orders).toEqual([
      { type: "reinforce", body: 0, cell: { q: -1, r: 0 } },
      { type: "grow", body: 0, path: [{ q: -1, r: 0 }, expect.objectContaining({})] },
    ]);
    expect(orders[1]).toMatchObject({ path: [{}, { q: 0, r: 0 }] });
    expect(cellAt(state, 0, 0)).toMatchObject({ owner: 0 });
  });

  it("does nothing with no nutrients, and nothing once eliminated or finished", () => {
    const s = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        { q: -8, r: 0, owner: 1, biomass: 5, core: true },
      ],
      nutrients: [0, 0],
    });
    expect(chooseOrders(s, 0, "normal", "x")).toEqual([]);
    const rich = { ...s, players: s.players.map((p) => ({ ...p, nutrients: 50 })) };
    expect(
      chooseOrders(
        { ...rich, result: { winner: 1, reason: "dominance", turn: 2 } },
        0,
        "normal",
        "x",
      ),
    ).toEqual([]);
    const gone = {
      ...rich,
      players: rich.players.map((p) => (p.id === 0 ? { ...p, eliminated: true } : p)),
    };
    expect(chooseOrders(gone, 0, "normal", "x")).toEqual([]);
  });
});

describe("SPEC §13.2 Easy", () => {
  it("never values severing", () => {
    const s = scenario({
      cells: [
        { q: -3, r: 0, owner: 1, biomass: 5, core: true },
        { q: -2, r: 0, owner: 1, biomass: 2 },
        { q: -1, r: 0, owner: 1, biomass: 2 },
        { q: 0, r: 0, owner: 1, biomass: 2 },
        { q: -2, r: 2, owner: 0, biomass: 5, core: true },
        { q: -2, r: 1, owner: 0, biomass: 9 },
      ],
    });
    const a = analyse(s, 0, NORMAL_WEIGHTS);
    const link = (sever: boolean) =>
      generateCandidates(a, { ignoreThreats: false, sever }).find(
        (c) =>
          c.kind === "assault" &&
          c.claims.length === 1 &&
          c.orders.length === 1 &&
          c.key.endsWith(`,${a.bodies[0]!.board.indexOf(-2, 0)}`),
      )!;
    expect(link(true).value).toBeGreaterThan(link(false).value);
  });

  it("still plays legal, budget-respecting sets", () => {
    const s = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        { q: -8, r: 0, owner: 1, biomass: 5, core: true },
      ],
      nutrients: [7, 7],
    });
    for (const seed of ["a", "b", "c", "d"]) {
      const orders = chooseOrders(s, 0, "easy", seed);
      expect(validateOrderSet(s, 0, orders)).toMatchObject({ ok: true });
    }
  });
});
