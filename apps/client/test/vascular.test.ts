import { describe, expect, it } from "vitest";
import { createGame, getBoard, PLAYABLE_STRAINS, resolveTurn } from "@swarm/sim";
import { chooseOrders } from "@swarm/bot";
import { scenario } from "@swarm/sim/testing";
import { isTrunk, trunkLoad, vascular, vesselWidth } from "../src/game/vascular";

describe("supply tree (colony life, phase 1)", () => {
  // A core with a straight line of three cells, plus a cut-off cell of the same owner.
  const s = scenario({
    cells: [
      { q: 0, r: 0, owner: 0, biomass: 5, core: true },
      { q: 1, r: 0, owner: 0, biomass: 3 },
      { q: 2, r: 0, owner: 0, biomass: 2 },
      { q: 3, r: 0, owner: 0, biomass: 1 },
      { q: -3, r: 3, owner: 0, biomass: 2 },
      { q: 0, r: -3, owner: 1, biomass: 5, core: true },
    ],
  });
  const body = s.bodies[0]!;
  const board = getBoard(body.radius);
  const at = (q: number, r: number) => board.indexOf(q, r);
  const v = vascular(body.radius, body.colony, (i) => (i === at(3, 0) ? 2 : 0));

  it("feeds each connected cell from its neighbour nearer the core", () => {
    expect(v.parent[at(0, 0)]).toBe(-1);
    expect(v.parent[at(1, 0)]).toBe(at(0, 0));
    expect(v.parent[at(2, 0)]).toBe(at(1, 0));
    expect(v.depth[at(3, 0)]).toBe(3);
    expect(isTrunk(v, at(1, 0), at(2, 0))).toBe(true);
  });

  it("load counts the cells fed through a vein; income flows to the core", () => {
    expect(v.load[at(0, 0)]).toBe(4);
    expect(trunkLoad(v, at(0, 0), at(1, 0))).toBe(3);
    expect(trunkLoad(v, at(2, 0), at(3, 0))).toBe(1);
    expect(v.income[at(0, 0)]).toBe(2);
    expect(v.income[at(1, 0)]).toBe(2);
  });

  it("cut-off cells are outside the tree, and colonies never feed each other", () => {
    expect(v.depth[at(-3, 3)]).toBe(-1);
    expect(v.load[at(-3, 3)]).toBe(0);
    expect(v.load[at(0, -3)]).toBe(1);
  });

  it("vessels widen with load, within bounds", () => {
    expect(vesselWidth(1)).toBeLessThan(vesselWidth(8));
    expect(vesselWidth(10_000)).toBeLessThanOrEqual(5.5);
  });

  it("matches the sim's connectivity on real games: in the tree exactly when connected", () => {
    let st = createGame(
      { mode: "system", playerCount: 3, strains: [...PLAYABLE_STRAINS].slice(0, 3) },
      "vascular-1",
    );
    for (let t = 0; t < 15 && !st.result; t++) {
      const orders: Record<number, ReturnType<typeof chooseOrders>> = {};
      for (const p of st.players) orders[p.id] = chooseOrders(st, p.id, "normal", `v-${p.id}`);
      st = resolveTurn(st, orders).state;
      for (const b of st.bodies) {
        const vb = vascular(b.radius, b.colony);
        b.colony.forEach((c, i) => {
          if (c) expect((vb.depth[i] ?? -1) >= 0, `body ${b.id} cell ${i}`).toBe(c.connected);
        });
      }
    }
  });
});
