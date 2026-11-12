import { describe, expect, it } from "vitest";
import {
  createGame,
  resolveTurn,
  validateOrderSet,
  type GameState,
  type OrderSet,
  type PlayerId,
} from "@swarm/sim";
import { systemScenario } from "@swarm/sim/testing";
import { chooseOrders } from "../src/index";

type Spec = Parameters<typeof systemScenario>[0];
type Cells = NonNullable<Spec["bodies"][0]["cells"]>;

/** A at (3,0), B at (9,0) — exactly launch range — and empty C at (−12,0), out of range. */
const ABC = (cellsA: Cells, extra: Partial<Spec> = {}) =>
  systemScenario({
    bodies: [
      {
        orbit: { radius: 3, period: 360, phase: 0 },
        cells: [{ q: 0, r: 0, owner: 0, biomass: 5, core: true }, ...cellsA],
      },
      { orbit: { radius: 9, period: 360, phase: 0 } },
      {
        orbit: { radius: 12, period: 360, phase: 180 },
        cells: [{ q: 0, r: 0, owner: 1, biomass: 5, core: true }],
      },
    ],
    ...extra,
  });

const pick = (s: GameState) => {
  const orders = chooseOrders(s, 0, "normal", "puzzle");
  expect(validateOrderSet(s, 0, orders)).toMatchObject({ ok: true });
  return orders;
};
const ofType = (orders: OrderSet, t: string) => orders.filter((o) => o.type === t);

describe("SPEC §13.2 spore play (Normal)", () => {
  it("launches a mature fruiting body at the empty body in range", () => {
    const s = ABC([{ q: 1, r: 0, owner: 0, biomass: 1, fruiting: 0 }]);
    const launches = ofType(pick(s), "launch");
    expect(launches).toHaveLength(1);
    expect(launches[0]).toMatchObject({ body: 0, cell: { q: 1, r: 0 }, targetBody: 1 });
  });

  it("does not launch an immature fruiting body", () => {
    const s = ABC([{ q: 1, r: 0, owner: 0, biomass: 1, fruiting: 1 }]);
    expect(ofType(pick(s), "launch")).toHaveLength(0);
  });

  it("grows a fruiting body when a launch window is coming", () => {
    const s = ABC([
      { q: 1, r: 0, owner: 0, biomass: 6 },
      { q: -1, r: 0, owner: 0, biomass: 2 },
    ]);
    const fruits = ofType(pick(s), "fruit");
    expect(fruits).toEqual([{ type: "fruit", body: 0, cell: { q: 1, r: 0 } }]);
  });

  it("does not fruit on a lone body with no window", () => {
    const s = systemScenario({
      bodies: [
        {
          orbit: { radius: 3, period: 360, phase: 0 },
          cells: [
            { q: 0, r: 0, owner: 0, biomass: 5, core: true },
            { q: 1, r: 0, owner: 0, biomass: 6 },
          ],
        },
        {
          orbit: { radius: 12, period: 360, phase: 180 },
          cells: [{ q: 0, r: 0, owner: 1, biomass: 5, core: true }],
        },
      ],
    });
    expect(ofType(pick(s), "fruit")).toHaveLength(0);
  });
});

describe("SPEC §15 M5: bots use launches in system games", () => {
  it("Normal bots launch spores in most games, always with legal sets", () => {
    let withLaunch = 0;
    const games = 6;
    for (let g = 0; g < games; g++) {
      const seed = `launch-${g}`;
      const players = 2 + (g % 3);
      let s = createGame({ mode: "system", playerCount: players }, seed);
      let launched = false;
      while (!s.result && !launched) {
        const sets: Record<PlayerId, OrderSet> = {};
        for (const p of s.players) {
          const orders = chooseOrders(s, p.id, "normal", `${seed}:${p.id}`);
          expect(validateOrderSet(s, p.id, orders)).toMatchObject({ ok: true });
          sets[p.id] = orders;
        }
        launched = Object.values(sets).some((o) => o.some((x) => x.type === "launch"));
        s = resolveTurn(s, sets).state;
      }
      if (launched) withLaunch++;
    }
    expect(withLaunch).toBeGreaterThanOrEqual(games - 1);
  });
});
