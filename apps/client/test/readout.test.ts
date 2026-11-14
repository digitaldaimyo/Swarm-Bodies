import { describe, expect, it } from "vitest";
import { createGame, getBoard, PLAYABLE_STRAINS, type Hex, type Order } from "@swarm/sim";
import { scenario } from "@swarm/sim/testing";
import { defenseParts, defenseText, fruitableCells, supplyPath } from "../src/game/readout";
import { vascular } from "../src/game/vascular";

describe("cell readouts (colony life, phase 4)", () => {
  const s = scenario({
    cells: [
      { q: 0, r: 0, owner: 0, biomass: 5, core: true },
      { q: 1, r: 0, owner: 0, biomass: 3 },
      { q: 2, r: 0, owner: 0, biomass: 2 },
      { q: -3, r: 3, owner: 0, biomass: 2 },
    ],
  });
  const body = s.bodies[0]!;
  const board = getBoard(body.radius);
  const at = (q: number, r: number) => board.indexOf(q, r);

  it("splits defense into biomass and support from connected neighbours", () => {
    const d = defenseParts(s, body, body.colony, at(1, 0));
    expect(d.biomass).toBe(3);
    // Two connected own neighbours (the core and the next cell), one support each.
    expect(d.support).toBe(2 * s.rules.defenseSupport);
    expect(d.bonus).toBe(0);
    expect(d.total).toBe(d.biomass + d.support);
    expect(defenseText(d, true)).toBe(`Defense ${d.total}\n3 biomass + ${d.support} support`);
    // A lone cut-off cell has no support.
    const cut = defenseParts(s, body, body.colony, at(-3, 3));
    expect(cut.support).toBe(0);
    expect(defenseText(cut, false)).toContain("Cut off");
  });

  it("traces a cell's supply route to its core, and none for a cut-off cell", () => {
    const v = vascular(body.radius, body.colony);
    expect(supplyPath(v, at(2, 0))).toEqual([at(2, 0), at(1, 0), at(0, 0)]);
    expect(supplyPath(v, at(-3, 3))).toEqual([]);
  });
});

describe("fruitable cells", () => {
  // A system game: fruiting needs somewhere to launch to.
  const base = createGame(
    { mode: "system", playerCount: 2, strains: [...PLAYABLE_STRAINS].slice(0, 2) },
    "readout-1",
  );
  const home = base.players[0]!.home!.body;
  const body0 = base.bodies[home]!;
  const board = getBoard(body0.radius);
  const core = body0.colony.findIndex((c) => c?.owner === 0 && c.core);
  const next = (board.neighbours[core] as readonly number[]).find(
    (n) => body0.terrain[n] !== "rock",
  )!;
  const colony = body0.colony.slice();
  colony[next] = { owner: 0, biomass: 6, core: false, connected: true, fruiting: null, cut: 0 };
  const rich = {
    ...base,
    players: base.players.map((p) => (p.id === 0 ? { ...p, nutrients: 99 } : p)),
    bodies: base.bodies.map((b) => (b.id === home ? { ...b, colony } : b)),
  };
  const body = rich.bodies[home]!;

  it("are the viewer's cells the sim would let fruit now", () => {
    expect(fruitableCells(rich, body, 0, [])).toEqual([next]);
    // Not the opponent's cells, which are never shown.
    expect(fruitableCells(rich, body, 1, [])).toEqual([]);
  });

  it("follow queued orders and the nutrients left", () => {
    const fruit: Order = { type: "fruit", body: home, cell: board.cells[next] as Hex };
    expect(fruitableCells(rich, body, 0, [fruit])).toEqual([]);
    const poor = {
      ...rich,
      players: rich.players.map((p) => (p.id === 0 ? { ...p, nutrients: 0 } : p)),
    };
    expect(fruitableCells(poor, poor.bodies[home]!, 0, [])).toEqual([]);
  });

  it("are none on a single rock, with nowhere to launch", () => {
    const s = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        { q: 1, r: 0, owner: 0, biomass: 8 },
      ],
    });
    expect(fruitableCells(s, s.bodies[0]!, 0, [])).toEqual([]);
  });
});
