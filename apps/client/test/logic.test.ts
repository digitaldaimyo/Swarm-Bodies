import { describe, expect, it } from "vitest";
import { applyDraftPick, createGame, hashState, resolveTurn, type Hex } from "@swarm/sim";
import { chooseOrders } from "@swarm/bot";
import { cellAt, grow, reinforce, scenario } from "@swarm/sim/testing";
import { hexToPixel, pixelToHex } from "../src/game/layout";
import { PathPainter } from "../src/game/painter";
import { Planner, previewPath } from "../src/game/planner";
import { buildTimeline, describeEvents, timelineDuration } from "../src/game/timeline";
import { neutralBodies, SkirmishSession, type SavedSkirmish } from "../src/game/session";
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
          cs.map((c) => (c ? { ...c, connected: false, cut: 0 } : null));
        expect(strip(lastEvent.colony.get(0)!)).toEqual(strip(state.bodies[0]!.colony));
      }
      s = state;
    }
  });

  it("folds system turns (spores, flares, comets) into the same boards as the sim (M5)", () => {
    const seen = new Set<string>();
    for (const seed of ["sys-a", "sys-b"]) {
      let s = createGame({ mode: "system", playerCount: 3 }, seed);
      while (!s.result) {
        const orders = {
          0: chooseOrders(s, 0, "normal", "a"),
          1: chooseOrders(s, 1, "normal", "b"),
          2: chooseOrders(s, 2, "easy", "c"),
        };
        const { state, events } = resolveTurn(s, orders);
        const frames = buildTimeline(s, state, events, orders);
        for (const f of frames) for (const e of f.effects) seen.add(e.kind);
        const lastEvent = frames.filter((f) => f.phase !== "final").at(-1);
        if (lastEvent) {
          // Fruiting progress (phase 11) has no event; the final frame carries it.
          const strip = (cs: (typeof state.bodies)[0]["colony"]) =>
            cs.map((c) => (c ? { ...c, connected: false, fruiting: null, cut: 0 } : null));
          for (const b of state.bodies)
            expect(strip(lastEvent.colony.get(b.id)!)).toEqual(strip(b.colony));
        }
        // Phases play in resolution order (SPEC §10.5).
        const order = ["prep", "growth", "launch", "starve", "income", "events", "final"];
        const idx = frames.map((f) => order.indexOf(f.phase));
        expect(idx).toEqual([...idx].sort((x, y) => x - y));
        s = state;
      }
    }
    for (const k of ["fruit", "launch", "land", "flash", "flare"]) expect(seen).toContain(k);
  });

  it("logs launches and landings", () => {
    let s = createGame({ mode: "system", playerCount: 2 }, "log-sys");
    const texts: string[] = [];
    while (!s.result && !texts.some((t) => t.includes("launched a spore"))) {
      const orders = { 0: chooseOrders(s, 0, "normal", "a"), 1: chooseOrders(s, 1, "normal", "b") };
      const { state, events } = resolveTurn(s, orders);
      texts.push(...describeEvents(events, 0, () => "Bot").map((l) => l.text));
      s = state;
    }
    expect(texts.some((t) => /launched a spore toward body \d+ \(lands turn \d+\)/.test(t))).toBe(
      true,
    );
  });

  it("plays multi-bot system skirmishes", async () => {
    const s = new SkirmishSession(
      {
        seed: "multi",
        difficulty: "easy",
        strain: "swarmer",
        botStrain: "biofilm",
        map: "system",
        bots: 3,
        size: "wide",
      },
      syncBot,
    );
    expect(s.state.players).toHaveLength(4);
    expect(s.state.bodies).toHaveLength(4 + neutralBodies(4, "wide"));
    await s.submitAndWait();
    expect(s.state.turn).toBe(2);
    expect(s.seats().map((x) => x.name)).toEqual(["You", "Bot 1", "Bot 2", "Bot 3"]);
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
    const a = new SkirmishSession(
      { seed: "sess", difficulty: "easy", strain: "swarmer", botStrain: "biofilm" },
      syncBot,
    );
    const start = a.state.players[0]!.home.cell;
    const legal = a.planner.add({
      type: "grow",
      body: 0,
      path: [start, { q: start.q - 1, r: start.r }],
    });
    if (!legal.ok) a.planner.clear();
    await a.submitAndWait();
    await a.submitAndWait();
    expect(a.history).toHaveLength(2);
    expect(a.state.turn).toBe(3);
    const saved: SavedSkirmish = JSON.parse(JSON.stringify(a.save()));
    const b = SkirmishSession.restore(saved, syncBot);
    expect(hashState(b.state)).toBe(hashState(a.state));
    expect(b.stats).toHaveLength(3);
  });
});

describe("projected income (M5)", () => {
  it("counts comet deposits under connected cells, like the sim", async () => {
    const { incomeOf } = await import("../src/game/planner");
    let s = createGame({ mode: "system", playerCount: 2 }, "income-comets");
    for (let t = 0; t < 30 && !s.result; t++) {
      const orders = { 0: chooseOrders(s, 0, "normal", "a"), 1: chooseOrders(s, 1, "normal", "b") };
      const { state, events } = resolveTurn(s, orders);
      // Income this turn is paid on the board after starvation, which is the next state's board
      // except for fruiting and event-phase changes; compare where no event phase touched cells.
      const touched = events.some((e) =>
        ["FlareStruck", "CometArrived", "CometFaded", "Irradiated"].includes(e.type),
      );
      if (!touched) {
        for (const e of events)
          if (e.type === "Income") expect(incomeOf(state, e.player)).toBe(e.amount);
      }
      s = state;
    }
  });
});

describe("draft picks in the planner (M6)", () => {
  it("puts the pick first, applies it to later orders, and replaces an earlier pick", () => {
    const base = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        { q: 1, r: 0, owner: 0, biomass: 3 },
        { q: 2, r: 0, owner: 1, biomass: 3 },
        { q: -8, r: 0, owner: 1, biomass: 5, core: true },
      ],
    });
    const s = {
      ...base,
      players: base.players.map((p) =>
        p.id === 0
          ? { ...p, draft: { index: 0, options: ["acid_tendrils", "quorum", "dormancy"] as const } }
          : p,
      ),
    } as typeof base;
    const planner = new Planner(s, 0);
    expect(planner.add(grow([0, 0], [-1, 0])).ok).toBe(true);
    expect(planner.pickDraft("quorum").ok).toBe(true);
    expect(planner.orders[0]).toEqual({ type: "draft", mutation: "quorum" });
    expect(planner.pickDraft("acid_tendrils").ok).toBe(true);
    expect(planner.orders.filter((o) => o.type === "draft")).toHaveLength(1);
    expect(planner.draftPick).toBe("acid_tendrils");
    expect(planner.orders).toHaveLength(2);
    // Acid Tendrils is in effect for the preview of an assault planned after the pick.
    const preview = previewPath(applyDraftPick(s, 0, "acid_tendrils"), 0, 0, [
      { q: 1, r: 0 },
      { q: 2, r: 0 },
    ]);
    expect(preview[0]).toMatchObject({ kind: "assault", outcome: "capture" });
    expect(planner.pickDraft("thick_veins" as never).ok).toBe(false);
  });
});
