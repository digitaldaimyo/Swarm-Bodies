import { describe, expect, it } from "vitest";
import { validateOrder, validateOrderSet, type Order } from "./sim";
import { grow, reinforce, retract, scenario } from "./helpers";

// Player 0 owns a short line along the q axis: core at (0,0), cells at (1,0) and (2,0).
const base = () =>
  scenario({
    cells: [
      { q: 0, r: 0, owner: 0, biomass: 5, core: true },
      { q: 1, r: 0, owner: 0, biomass: 2 },
      { q: 2, r: 0, owner: 0, biomass: 2 },
      { q: -6, r: 0, owner: 1, biomass: 5, core: true },
    ],
    nutrients: [20, 20],
  });

const check = (orders: Order[], state = base()) => validateOrderSet(state, 0, orders);

describe("SPEC §5.1 Grow", () => {
  it("accepts a path from a connected own cell and costs 2 N per new cell (§5.2)", () => {
    expect(check([grow([2, 0], [3, 0], [4, 0], [5, 0])])).toEqual({ ok: true, cost: 6 });
  });

  it("lets a path pass through own cells for free", () => {
    expect(check([grow([0, 0], [1, 0], [2, 0])])).toMatchObject({
      ok: false,
      reason: "pathNoNewCells",
    });
    expect(check([grow([0, 0], [1, 0], [2, 0], [3, 0])])).toEqual({ ok: true, cost: 2 });
  });

  it("limits length to the reach (3) and requires at least one step", () => {
    expect(check([grow([2, 0], [3, 0], [4, 0], [5, 0], [6, 0])])).toMatchObject({
      reason: "pathTooLong",
    });
    expect(check([grow([2, 0])])).toMatchObject({ reason: "pathTooShort" });
  });

  it("requires adjacent, distinct, on-board, non-rock cells", () => {
    expect(check([grow([2, 0], [4, 0])])).toMatchObject({ reason: "pathNotAdjacent" });
    expect(check([grow([2, 0], [3, 0], [2, 0])])).toMatchObject({ reason: "pathRepeats" });
    const edge = scenario({ cells: [{ q: 9, r: 0, owner: 0, biomass: 5, core: true }] });
    expect(validateOrderSet(edge, 0, [grow([9, 0], [10, 0])])).toMatchObject({
      reason: "offBoard",
    });
    const rocky = scenario({
      cells: [{ q: 0, r: 0, owner: 0, biomass: 5, core: true }],
      rock: [{ q: 1, r: 0 }],
    });
    expect(validateOrderSet(rocky, 0, [grow([0, 0], [1, 0], [2, 0])])).toMatchObject({
      reason: "rock",
    });
  });

  it("must start on an own connected cell", () => {
    expect(check([grow([3, 0], [4, 0])])).toMatchObject({ reason: "notOwn" });
    expect(check([grow([-6, 0], [-5, 0])])).toMatchObject({ reason: "notOwn" });
    const cut = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        { q: 4, r: 0, owner: 0, biomass: 3 },
      ],
    });
    expect(validateOrderSet(cut, 0, [grow([4, 0], [5, 0])])).toMatchObject({
      reason: "notConnected",
    });
  });

  it("allows at most one Grow from any one cell", () => {
    expect(check([grow([2, 0], [3, 0]), grow([2, 0], [2, 1])])).toMatchObject({
      index: 1,
      reason: "duplicateGrowStart",
    });
  });

  it("rejects the later of two own paths that target the same cell", () => {
    expect(check([grow([2, 0], [3, 0]), grow([1, 0], [2, -1], [3, -1], [3, 0])])).toMatchObject({
      index: 1,
      reason: "overlappingPath",
    });
  });

  it("treats entering an enemy cell as a normal-cost new cell (assault, §5.2)", () => {
    const s = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        { q: 1, r: 0, owner: 1, biomass: 2 },
        { q: 3, r: 0, owner: 1, biomass: 5, core: true },
      ],
    });
    expect(validateOrderSet(s, 0, [grow([0, 0], [1, 0])])).toEqual({ ok: true, cost: 2 });
  });
});

describe("SPEC §5.2 growth costs", () => {
  it("adds +1 N for mineral deposits", () => {
    const s = scenario({
      cells: [{ q: 0, r: 0, owner: 0, biomass: 5, core: true }],
      deposits: [
        { q: 1, r: 0, kind: "mineral" },
        { q: 2, r: 0, kind: "ice" },
      ],
    });
    expect(validateOrderSet(s, 0, [grow([0, 0], [1, 0], [2, 0])])).toEqual({ ok: true, cost: 5 });
  });

  it("adds +1 N on Metallic bodies", () => {
    const s = scenario({
      cells: [{ q: 0, r: 0, owner: 0, biomass: 5, core: true }],
      bodyType: "metallic",
    });
    expect(validateOrderSet(s, 0, [grow([0, 0], [1, 0])])).toEqual({ ok: true, cost: 3 });
  });

  it("never costs less than 1 N", () => {
    const s = scenario({
      cells: [{ q: 0, r: 0, owner: 0, biomass: 5, core: true }],
      rules: { baseEntryCost: -5 },
    });
    expect(validateOrderSet(s, 0, [grow([0, 0], [1, 0])])).toEqual({ ok: true, cost: 1 });
  });
});

describe("SPEC §5.1 Reinforce", () => {
  it("costs 3 N on an own connected cell", () => {
    expect(check([reinforce(1, 0)])).toEqual({ ok: true, cost: 3 });
  });
  it("only once per cell per turn", () => {
    expect(check([reinforce(1, 0), reinforce(1, 0)])).toMatchObject({
      index: 1,
      reason: "alreadyReinforced",
    });
  });
  it("rejects enemy, empty, disconnected and maxed cells", () => {
    expect(check([reinforce(-6, 0)])).toMatchObject({ reason: "notOwn" });
    expect(check([reinforce(4, 4)])).toMatchObject({ reason: "notOwn" });
    const s = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 12, core: true },
        { q: 1, r: 0, owner: 0, biomass: 9 },
        { q: 5, r: 0, owner: 0, biomass: 2 },
      ],
    });
    expect(validateOrderSet(s, 0, [reinforce(5, 0)])).toMatchObject({ reason: "notConnected" });
    expect(validateOrderSet(s, 0, [reinforce(1, 0)])).toMatchObject({ reason: "atMaxBiomass" });
    expect(validateOrderSet(s, 0, [reinforce(0, 0)])).toMatchObject({ reason: "atMaxBiomass" });
  });
});

describe("SPEC §5.1 Retract", () => {
  it("is free and works on own non-core cells, connected or not", () => {
    expect(check([retract(2, 0)])).toEqual({ ok: true, cost: 0 });
    expect(check([retract(0, 0)])).toMatchObject({ reason: "isCore" });
    expect(check([retract(-6, 0)])).toMatchObject({ reason: "notOwn" });
  });
  it("cannot be combined with other orders on the same cell", () => {
    expect(check([grow([2, 0], [3, 0]), retract(2, 0)])).toMatchObject({
      index: 1,
      reason: "conflictsWithOrder",
    });
    expect(check([reinforce(1, 0), retract(1, 0)])).toMatchObject({
      index: 1,
      reason: "conflictsWithOrder",
    });
    expect(check([retract(1, 0), grow([0, 0], [1, 0], [1, 1])])).toMatchObject({
      index: 1,
      reason: "conflictsWithOrder",
    });
    expect(check([retract(1, 0), retract(1, 0)])).toMatchObject({
      index: 1,
      reason: "duplicateRetract",
    });
  });
});

describe("SPEC §5.1 order sets", () => {
  it("never lets the planned total exceed banked nutrients; refunds do not count", () => {
    const s = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        { q: 1, r: 0, owner: 0, biomass: 2 },
      ],
      nutrients: [4, 4],
    });
    expect(validateOrderSet(s, 0, [reinforce(0, 0)])).toEqual({ ok: true, cost: 3 });
    expect(validateOrderSet(s, 0, [reinforce(0, 0), grow([1, 0], [2, 0])])).toMatchObject({
      index: 1,
      reason: "insufficientNutrients",
    });
    expect(
      validateOrderSet(s, 0, [retract(1, 0), reinforce(0, 0), grow([0, 0], [0, 1])]),
    ).toMatchObject({
      index: 2,
      reason: "insufficientNutrients",
    });
  });

  it("allows at most 12 orders", () => {
    const s = scenario({
      cells: [{ q: 0, r: 0, owner: 0, biomass: 5, core: true }],
      nutrients: [999, 0],
    });
    const dirs: [number, number][] = [
      [1, 0],
      [1, -1],
      [0, -1],
      [-1, 0],
      [-1, 1],
      [0, 1],
    ];
    // 12 single-step paths from distinct own cells: build a 13-cell blob first.
    const blob = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        ...dirs.map(([q, r]) => ({ q, r, owner: 0, biomass: 2 })),
        ...dirs.map(([q, r]) => ({ q: 2 * q, r: 2 * r, owner: 0, biomass: 2 })),
      ],
      nutrients: [999, 0],
    });
    const orders = [
      ...dirs.map(([q, r]) => reinforce(q, r)),
      ...dirs.map(([q, r]) => reinforce(2 * q, 2 * r)),
    ];
    expect(validateOrderSet(blob, 0, orders)).toEqual({ ok: true, cost: 36 });
    expect(validateOrderSet(blob, 0, [...orders, reinforce(0, 0)])).toMatchObject({
      index: 12,
      reason: "tooManyOrders",
    });
    expect(s.rules.maxOrdersPerSet).toBe(12);
  });

  it("rejects malformed orders, unknown bodies, eliminated players and finished games", () => {
    expect(check([{ type: "grow", body: 0, path: [{ q: 1.5, r: 0 }] } as Order])).toMatchObject({
      reason: "malformed",
    });
    expect(check([{ type: "explode" } as unknown as Order])).toMatchObject({ reason: "malformed" });
    expect(check([{ type: "reinforce", body: 3, cell: { q: 0, r: 0 } }])).toMatchObject({
      reason: "noSuchBody",
    });
    const s = base();
    expect(
      validateOrderSet({ ...s, players: s.players.map((p) => ({ ...p, eliminated: true })) }, 0, [
        reinforce(1, 0),
      ]),
    ).toMatchObject({
      reason: "eliminated",
    });
    expect(
      validateOrderSet({ ...s, result: { winner: 1, reason: "dominance", turn: 3 } }, 0, [
        reinforce(1, 0),
      ]),
    ).toMatchObject({
      reason: "gameOver",
    });
  });

  it("validateOrder checks one order against pending ones", () => {
    const s = base();
    expect(validateOrder(s, 0, reinforce(1, 0), [reinforce(1, 0)])).toMatchObject({
      ok: false,
      reason: "alreadyReinforced",
    });
    expect(validateOrder(s, 0, reinforce(2, 0), [reinforce(1, 0)])).toEqual({ ok: true, cost: 3 });
  });
});
