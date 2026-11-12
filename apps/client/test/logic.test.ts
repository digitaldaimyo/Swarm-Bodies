import { describe, expect, it } from "vitest";
import { createGame, hashState, resolveTurn, type Hex } from "@swarm/sim";
import { chooseOrders } from "@swarm/bot";
import { cellAt, grow, reinforce, scenario } from "@swarm/sim/testing";
import { hexToPixel, pixelToHex } from "../src/game/layout";
import { PathPainter } from "../src/game/painter";
import { Planner, previewPath } from "../src/game/planner";
import { buildTimeline, describeEvents, timelineDuration } from "../src/game/timeline";
import { SkirmishSession, type SavedSkirmish } from "../src/game/session";
import type { BotRunner } from "../src/game/bot-client";

const syncBot: BotRunner = {
  choose: async (s, p, d, seed) => chooseOrders(s, p, d, seed),
  dispose: () => undefined,
};

describe("hex layout", () => {
  it("round-trips hex centres and nearby points", () => {
    for (let q = -9; q <= 9; q++)
      for (let r = -9; r <= 9; r++) {
        const p = hexToPixel({ q, r });
        expect(pixelToHex(p)).toEqual({ q, r });
        expect(pixelToHex({ x: p.x + 8, y: p.y - 8 })).toEqual({ q, r });
      }
  });
});

describe("path painting (SPEC §10.3)", () => {
  const open = () => true;
  it("adds adjacent cells and trims when the finger goes back", () => {
    const p = new PathPainter({ q: 0, r: 0 }, open, 3);
    expect(p.update({ q: 1, r: 0 })).toBe(1);
    expect(p.update({ q: 2, r: 0 })).toBe(1);
    p.update({ q: 1, r: 0 });
    expect(p.path).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 },
    ]);
  });
  it("walks toward a finger that jumped ahead, and stops at the reach", () => {
    const p = new PathPainter({ q: 0, r: 0 }, open, 3);
    p.update({ q: 5, r: 0 });
    expect(p.path).toEqual([
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
      { q: 3, r: 0 },
    ]);
  });
  it("never steps onto impassable cells", () => {
    const rock = (h: Hex) => !(h.q === 1 && h.r === 0);
    const p = new PathPainter({ q: 0, r: 0 }, rock, 3);
    p.update({ q: 2, r: 0 });
    expect(p.path.some((h) => h.q === 1 && h.r === 0)).toBe(false);
    expect(p.tip).toEqual({ q: 2, r: 0 });
  });
});

const duel = () =>
  scenario({
    cells: [
      { q: 0, r: 0, owner: 0, biomass: 5, core: true },
      { q: 1, r: 0, owner: 0, biomass: 9 },
      { q: 2, r: 0, owner: 1, biomass: 2 },
      { q: 3, r: 0, owner: 1, biomass: 5, core: true },
    ],
    nutrients: [10, 10],
  });

describe("planner", () => {
  it("validates with the sim, sums cost and supports undo/remove", () => {
    const p = new Planner(duel(), 0);
    expect(p.add(grow([0, 0], [0, 1])).ok).toBe(true);
    expect(p.add(reinforce(0, 0)).ok).toBe(true);
    expect(p.plannedCost).toBe(5);
    expect(p.add(reinforce(0, 0))).toMatchObject({ ok: false, reason: "alreadyReinforced" });
    p.undo();
    expect(p.plannedCost).toBe(2);
    p.remove(0);
    expect(p.orders).toEqual([]);
    expect(p.projectedIncome).toBe(2);
  });
  it("previews assaults as the sim will resolve them", () => {
    const s = duel();
    const preview = previewPath(s, 0, 0, [
      { q: 1, r: 0 },
      { q: 2, r: 0 },
    ]);
    expect(preview).toEqual([
      {
        cell: { q: 2, r: 0 },
        kind: "assault",
        attack: 9,
        defense: 3,
        outcome: "capture",
        uncertain: true,
      },
    ]);
    const { events } = resolveTurn(s, { 0: [grow([1, 0], [2, 0])] });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "CellCaptured", attack: 9, defense: 3 }),
    );
  });
});

describe("replay timeline (SPEC §10.5)", () => {
  it("ends on the real resolved board and orders frames by phase", () => {
    const s = duel();
    const orders = {
      0: [reinforce(0, 0), grow([1, 0], [2, 0], [2, 1])],
      1: [grow([3, 0], [3, 1])],
    };
    const { state, events } = resolveTurn(s, orders);
    const frames = buildTimeline(s, state, events, orders);
    expect(frames.map((f) => `${f.phase}${f.step || ""}`)).toEqual([
      "prep",
      "growth1",
      "growth2",
      "income",
      "final",
    ]);
    expect(frames.at(-1)!.colony.get(0)).toEqual(state.bodies[0]!.colony);
    const step1 = frames[1]!;
    expect(step1.effects).toContainEqual({
      kind: "tendril",
      body: 0,
      from: { q: 1, r: 0 },
      to: { q: 2, r: 0 },
      player: 0,
      outcome: "capture",
    });
    // The intermediate board after step 1 already shows the capture.
    const board = step1.colony.get(0)!;
    expect(
      board.find(
        (c, i) => c?.owner === 0 && i === state.bodies[0]!.colony.indexOf(cellAt(state, 2, 0)),
      ),
    ).toBeTruthy();
    const d = timelineDuration(frames);
    expect(d).toBeGreaterThan(1000);
    expect(d).toBeLessThan(6000);
  });

  it("reconstructs every intermediate board consistently over whole games", () => {
    let s = createGame({ mode: "singleRock", playerCount: 2 }, "timeline");
    while (!s.result) {
      const orders = { 0: chooseOrders(s, 0, "normal", "a"), 1: chooseOrders(s, 1, "easy", "b") };
      const { state, events } = resolveTurn(s, orders);
      const frames = buildTimeline(s, state, events, orders);
      // Folding events must reproduce the resolved board exactly (connectivity aside).
      const lastEvent = frames.filter((f) => f.phase !== "final").at(-1);
      if (lastEvent) {
        const strip = (cs: (typeof state.bodies)[0]["colony"]) =>
          cs.map((c) => (c ? { ...c, connected: false } : null));
        expect(strip(lastEvent.colony.get(0)!)).toEqual(strip(state.bodies[0]!.colony));
      }
      s = state;
    }
  });

  it("describes key events for the log", () => {
    const s = duel();
    const { events } = resolveTurn(s, { 0: [grow([1, 0], [2, 0])] });
    const log = describeEvents(events, 0, () => "Bot");
    expect(log.map((l) => l.text)).toContain("You captured a cell from Bot (9 vs 3)");
  });
});

describe("skirmish session", () => {
  it("plays a turn, records history, and restores from seed + orders", async () => {
    const a = new SkirmishSession({ seed: "sess", difficulty: "easy" }, syncBot);
    const start = a.state.players[0]!.home.cell;
    const legal = a.planner.add({
      type: "grow",
      body: 0,
      path: [start, { q: start.q - 1, r: start.r }],
    });
    if (!legal.ok) a.planner.clear();
    await a.submit();
    await a.submit();
    expect(a.history).toHaveLength(2);
    expect(a.state.turn).toBe(3);
    const saved: SavedSkirmish = JSON.parse(JSON.stringify(a.save()));
    const b = SkirmishSession.restore(saved, syncBot);
    expect(hashState(b.state)).toBe(hashState(a.state));
    expect(b.stats).toHaveLength(3);
  });
});
