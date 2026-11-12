import { describe, expect, it } from "vitest";
import {
  BASE_RULES,
  bodyPosition,
  cosFx,
  createGame,
  distanceScaled,
  forecast,
  getBoard,
  hashState,
  hexDistance,
  inLaunchRange,
  isOneRegion,
  orbitAngle,
  resolveTurn,
  sinFx,
  randomOrderSet,
  travelTime,
  upgradeState,
  validateOrderSet,
  type Body,
  type GameEvent,
  type GameState,
  type Order,
} from "./sim";
import { cellAt as cellAtBody0, systemScenario } from "../src/testing";

const ofType = <T extends GameEvent["type"]>(events: GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

const cellAt = (s: GameState, body: number, q: number, r: number) => {
  const b = s.bodies[body]!;
  return b.colony[getBoard(b.radius).indexOf(q, r)] ?? null;
};
const fruit = (body: number, q: number, r: number): Order => ({
  type: "fruit",
  body,
  cell: { q, r },
});
const launch = (
  body: number,
  q: number,
  r: number,
  targetBody: number,
  tq: number,
  tr: number,
): Order => ({
  type: "launch",
  body,
  cell: { q, r },
  targetBody,
  targetCell: { q: tq, r: tr },
});

/**
 * Three bodies at turn 0 (period 360, so each moves 1° per turn): A at (3, 0), B at (9, 0) —
 * exactly 6 units from A, the launch range — and C at (−12, 0), out of range of both.
 */
const ABC = (
  extra: Partial<Parameters<typeof systemScenario>[0]> = {},
  cellsA = [] as NonNullable<Parameters<typeof systemScenario>[0]["bodies"][0]["cells"]>,
  cellsB = [] as typeof cellsA,
) =>
  systemScenario({
    bodies: [
      {
        orbit: { radius: 3, period: 360, phase: 0 },
        cells: [{ q: 0, r: 0, owner: 0, biomass: 5, core: true }, ...cellsA],
      },
      {
        orbit: { radius: 9, period: 360, phase: 0 },
        cells: [{ q: 0, r: 0, owner: 1, biomass: 5, core: true }, ...cellsB],
      },
      { orbit: { radius: 12, period: 360, phase: 180 } },
    ],
    ...extra,
  });

describe("SPEC §4.1–4.4 system generation", () => {
  // M6 balance: playerCount + 1, at least 3 (DECISIONS).
  it.each([
    [2, 3],
    [3, 4],
    [4, 5],
  ])("%i players get %i bodies (playerCount + systemExtraBodies)", (players, bodies) => {
    expect(createGame({ mode: "system", playerCount: players }, "count").bodies).toHaveLength(
      bodies,
    );
  });

  it("clamps the body count to the configured range", () => {
    expect(
      createGame({ mode: "system", playerCount: 4, rules: { systemExtraBodies: 9 } }, "x").bodies,
    ).toHaveLength(7);
    expect(
      createGame({ mode: "system", playerCount: 2, rules: { systemExtraBodies: 0 } }, "x").bodies,
    ).toHaveLength(BASE_RULES.systemMinBodies);
    expect(() => createGame({ mode: "system", playerCount: 5 }, "x")).toThrow();
  });

  it.each(Array.from({ length: 12 }, (_, i) => `sys-${i}`))(
    "seed %s: homes, orbits, terrain and schedule follow the spec",
    (seed) => {
      const players = 2 + (Number(seed.slice(4)) % 3);
      const s = createGame(
        { mode: "system", playerCount: players, strains: ["swarmer", "biofilm"] },
        seed,
      );
      expect(
        hashState(
          createGame(
            { mode: "system", playerCount: players, strains: ["swarmer", "biofilm"] },
            seed,
          ),
        ),
      ).toBe(hashState(s));

      // Orbits (§4.5): distinct integer radii 3–12, periods 8–24 growing with radius, phases 0–359.
      const orbits = s.bodies.map((b) => b.orbit!);
      expect(new Set(orbits.map((o) => o.radius)).size).toBe(orbits.length);
      for (const [i, o] of orbits.entries()) {
        expect(o.radius).toBeGreaterThanOrEqual(3);
        expect(o.radius).toBeLessThanOrEqual(12);
        expect(o.period).toBeGreaterThanOrEqual(8);
        expect(o.period).toBeLessThanOrEqual(24);
        expect(o.phase).toBeGreaterThanOrEqual(0);
        expect(o.phase).toBeLessThan(360);
        if (i > 0) expect(o.period).toBeGreaterThanOrEqual(orbits[i - 1]!.period - 2);
      }

      // Homes (§4.1, §4.4): one Medium Carbonaceous/Icy body per player, alone, standard start.
      for (const p of s.players) {
        const home = s.bodies[p.home.body]!;
        expect(home.home).toBe(p.id);
        expect(home.size).toBe("medium");
        expect(["carbonaceous", "icy"]).toContain(home.type);
        const own = home.colony.filter((c) => c);
        expect(own).toHaveLength(3);
        expect(own.every((c) => c!.owner === p.id)).toBe(true);
        expect(cellAt(s, home.id, 0, 0)).toEqual({
          owner: p.id,
          biomass: 5,
          core: true,
          connected: true,
          fruiting: null,
          cut: 0,
        });
        expect(p.nutrients).toBe(BASE_RULES.startNutrients);
        const board = getBoard(home.radius);
        const near = board.cells
          .map((h, i) => ({ d: home.deposits[i], dist: hexDistance(h, { q: 0, r: 0 }) }))
          .filter((x) => x.dist <= 3);
        expect(near.some((x) => x.d === "organic")).toBe(true);
        expect(near.some((x) => x.d === "ice")).toBe(true);
      }
      expect(
        s.bodies.filter((b) => b.home === null).every((b) => b.colony.every((c) => c === null)),
      ).toBe(true);

      // Fair homes: no other choice of home bodies has a smaller spread of nearest-neutral distances.
      const spreadOf = (homes: number[]) => {
        const d = homes.map((h) =>
          Math.min(
            ...s.bodies
              .filter((b) => !homes.includes(b.id))
              .map((b) => distanceScaled(s.bodies[h]!, b, 1)),
          ),
        );
        return Math.max(...d) - Math.min(...d);
      };
      const chosen = spreadOf(s.players.map((p) => p.home.body).sort((a, b) => a - b));
      const combos = (start: number, k: number): number[][] =>
        k === 0
          ? [[]]
          : Array.from({ length: s.bodies.length - start }, (_, j) => start + j).flatMap((i) =>
              combos(i + 1, k - 1).map((c) => [i, ...c]),
            );
      for (const c of combos(0, players)) expect(chosen).toBeLessThanOrEqual(spreadOf(c));

      // Terrain (§4.2–4.3): rock ~8% never splitting a body; deposits ~6%, +50% on Irradiated.
      for (const b of s.bodies) {
        const board = getBoard(b.radius);
        expect(isOneRegion(board, b.terrain)).toBe(true);
        const rock = b.terrain.filter((t) => t === "rock").length;
        expect(rock).toBeLessThanOrEqual(Math.ceil(board.cells.length * 0.09));
        const deposits = b.deposits.filter(Boolean).length;
        const target = Math.floor((board.cells.length * 60) / 1000);
        const expected = b.type === "irradiated" ? target + Math.floor(target / 2) : target;
        expect(deposits).toBeGreaterThanOrEqual(expected - 1);
        expect(deposits).toBeLessThanOrEqual(expected + 2);
        b.deposits.forEach((d, i) => d && expect(b.terrain[i]).toBe("regolith"));
      }

      // Events (§8): flares every 7–10 turns, comets every 10–14, within the turn limit.
      const flares = s.schedule.filter((e) => e.kind === "flare").map((e) => e.turn);
      const comets = s.schedule.filter((e) => e.kind === "comet");
      expect(flares[0]!).toBeGreaterThanOrEqual(7);
      flares.slice(1).forEach((t, i) => expect(t - flares[i]!).toBeGreaterThanOrEqual(7));
      flares.slice(1).forEach((t, i) => expect(t - flares[i]!).toBeLessThanOrEqual(10));
      comets.forEach((c) => c.kind === "comet" && expect(c.body).toBeLessThan(s.bodies.length));
      expect(s.schedule.every((e) => e.turn <= s.rules.turnLimit)).toBe(true);
    },
  );
});

describe("SPEC §4.5 orbits and launch windows", () => {
  it("the committed sine table matches Math.sin to within rounding", () => {
    for (let d = -360; d < 720; d++) {
      expect(Math.abs(sinFx(d) - Math.sin((d * Math.PI) / 180) * 10000)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(cosFx(d) - Math.cos((d * Math.PI) / 180) * 10000)).toBeLessThanOrEqual(0.5);
    }
  });

  it("angle(t) = (φ + floor(360·t / T)) mod 360", () => {
    const b = { orbit: { radius: 5, period: 7, phase: 350 } } as Body;
    expect(orbitAngle(b, 0)).toBe(350);
    expect(orbitAngle(b, 1)).toBe((350 + 51) % 360);
    expect(orbitAngle(b, 7)).toBe(350);
    expect(bodyPosition({ orbit: { radius: 4, period: 8, phase: 90 } } as Body, 0)).toEqual({
      x: 0,
      y: 40000,
    });
  });

  it("launch windows are exact at the range boundary, and travel time is max(1, ceil(dist / 3))", () => {
    const s = ABC();
    const [a, b, c] = s.bodies as [Body, Body, Body];
    expect(distanceScaled(a, b, 0)).toBe(60000);
    expect(inLaunchRange(s, a, b, 0, 0)).toBe(true);
    expect(inLaunchRange(s, b, a, 0, 0)).toBe(true);
    expect(inLaunchRange(s, a, c, 0, 0)).toBe(false);
    expect(inLaunchRange(s, a, a, 0, 0)).toBe(false);
    expect(travelTime(s, a, b, 0)).toBe(2);
    // Just outside the range one turn later (B has moved 1° along its orbit).
    expect(inLaunchRange(s, a, b, 1, 0)).toBe(distanceScaled(a, b, 1) <= 60000);
    const near = systemScenario({
      bodies: [
        { orbit: { radius: 3, period: 360, phase: 0 } },
        { orbit: { radius: 4, period: 360, phase: 0 } },
      ],
    });
    expect(travelTime(near, near.bodies[0]!, near.bodies[1]!, 0)).toBe(1);
  });

  it("forecast lists windows and scheduled events for the next turns", () => {
    const s = ABC({
      schedule: [
        { kind: "flare", turn: 2 },
        { kind: "comet", turn: 3, body: 2 },
      ],
    });
    const f = forecast(s, 6);
    expect(f).toHaveLength(7);
    expect(f[0]!.windows).toContainEqual({ from: 0, to: 1, distance: 60000, travel: 2 });
    expect(f[2]!.events).toEqual([{ kind: "flare", turn: 2 }]);
    expect(f[3]!.events).toEqual([{ kind: "comet", turn: 3, body: 2 }]);
  });
});

describe("SPEC §5.1 Fruit", () => {
  const cellsA = [
    { q: 1, r: 0, owner: 0, biomass: 6 },
    { q: 0, r: 1, owner: 0, biomass: 6 },
    { q: -1, r: 0, owner: 0, biomass: 6 },
    { q: 0, r: -1, owner: 0, biomass: 4 },
  ];
  it("costs 10 N on an own connected non-core cell with biomass ≥ 5", () => {
    const s = ABC({}, cellsA);
    expect(validateOrderSet(s, 0, [fruit(0, 1, 0)])).toEqual({ ok: true, cost: 10 });
    expect(validateOrderSet(s, 0, [fruit(0, 0, 0)])).toMatchObject({ reason: "isCore" });
    expect(validateOrderSet(s, 0, [fruit(0, 0, -1)])).toMatchObject({ reason: "tooLittleBiomass" });
    expect(validateOrderSet(s, 0, [fruit(1, 0, 0)])).toMatchObject({ reason: "notOwn" });
    expect(validateOrderSet(s, 0, [fruit(0, 1, 0), fruit(0, 1, 0)])).toMatchObject({
      index: 1,
      reason: "alreadyFruiting",
    });
  });

  it("allows at most 2 fruiting bodies at once, counting existing ones", () => {
    const s = ABC({}, [...cellsA.slice(0, 2), { q: -1, r: 0, owner: 0, biomass: 6, fruiting: 1 }]);
    expect(validateOrderSet(s, 0, [fruit(0, 1, 0), fruit(0, 0, 1)])).toMatchObject({
      index: 1,
      reason: "tooManyFruiting",
    });
  });

  it("is not available on Single Rock, which has nowhere to launch to", () => {
    const rock = createGame({ mode: "singleRock", playerCount: 2 }, "x");
    expect(
      validateOrderSet(rock, 0, [
        fruit(0, rock.players[0]!.home.cell.q, rock.players[0]!.home.cell.r),
      ]),
    ).toMatchObject({ reason: "noLaunches" });
  });

  it("matures in 2 turns", () => {
    let s = ABC({}, cellsA);
    const r1 = resolveTurn(s, { 0: [fruit(0, 1, 0)] });
    expect(ofType(r1.events, "FruitStarted")).toHaveLength(1);
    expect(cellAt(r1.state, 0, 1, 0)?.fruiting).toBe(1);
    s = r1.state;
    expect(validateOrderSet(s, 0, [launch(0, 1, 0, 1, 1, 1)])).toMatchObject({
      reason: "notMature",
    });
    const r2 = resolveTurn(s, {});
    expect(cellAt(r2.state, 0, 1, 0)?.fruiting).toBe(0);
    expect(ofType(r2.events, "FruitMatured")).toHaveLength(1);
  });
});

describe("SPEC §5.1 Launch and §6 spores", () => {
  const ready = (cellsB: NonNullable<Parameters<typeof ABC>[2]> = []) =>
    ABC({}, [{ q: 1, r: 0, owner: 0, biomass: 6, fruiting: 0 }], cellsB);

  it("needs a mature fruiting body, another body, an open window and a non-rock cell", () => {
    const s = ready();
    expect(validateOrderSet(s, 0, [launch(0, 1, 0, 1, 2, 0)])).toEqual({ ok: true, cost: 0 });
    expect(validateOrderSet(s, 0, [launch(0, 0, 0, 1, 2, 0)])).toMatchObject({
      reason: "notFruiting",
    });
    expect(validateOrderSet(s, 0, [launch(0, 1, 0, 0, 2, 0)])).toMatchObject({
      reason: "sameBody",
    });
    expect(validateOrderSet(s, 0, [launch(0, 1, 0, 2, 2, 0)])).toMatchObject({
      reason: "outOfRange",
    });
    expect(validateOrderSet(s, 0, [launch(0, 1, 0, 1, 9, 9)])).toMatchObject({
      reason: "offBoard",
    });
    expect(
      validateOrderSet(s, 0, [launch(0, 1, 0, 1, 2, 0), launch(0, 1, 0, 1, 3, 0)]),
    ).toMatchObject({ index: 1, reason: "duplicateLaunch" });
    expect(
      validateOrderSet(s, 0, [
        { type: "retract", body: 0, cell: { q: 1, r: 0 } },
        launch(0, 1, 0, 1, 2, 0),
      ]),
    ).toMatchObject({
      index: 1,
      reason: "conflictsWithOrder",
    });
  });

  it("launches a spore that lands as a new core after its travel time; the launcher becomes a biomass-1 cell", () => {
    const r1 = resolveTurn(ready(), { 0: [launch(0, 1, 0, 1, 2, 0)] });
    expect(r1.state.spores).toEqual([
      {
        id: 1,
        owner: 0,
        sourceBody: 0,
        targetBody: 1,
        targetCell: { q: 2, r: 0 },
        landing: 3,
        launchedTurn: 0,
        arrivalTurn: 2,
      },
    ]);
    expect(cellAt(r1.state, 0, 1, 0)).toMatchObject({ biomass: 1, fruiting: null, core: false });
    const r2 = resolveTurn(r1.state, {});
    expect(r2.state.spores).toHaveLength(1);
    const r3 = resolveTurn(r2.state, {});
    expect(r3.state.spores).toEqual([]);
    expect(ofType(r3.events, "SporeLanded")).toMatchObject([{ outcome: "newCore", biomass: 3 }]);
    expect(cellAt(r3.state, 1, 2, 0)).toMatchObject({ owner: 0, core: true, biomass: 3 });
  });

  const land = (
    target: { q: number; r: number },
    cellsB: NonNullable<Parameters<typeof ABC>[2]>,
    landing = 3,
  ) => {
    const s = ready(cellsB);
    return resolveTurn(
      {
        ...s,
        spores: [
          {
            id: 9,
            owner: 0,
            sourceBody: 0,
            targetBody: 1,
            targetCell: target,
            landing,
            launchedTurn: -2,
            arrivalTurn: 0,
          },
        ],
      },
      {},
    );
  };

  it("landing on an own cell makes it a core with the larger biomass", () => {
    const s = ABC({}, [], []);
    const own = resolveTurn(
      {
        ...s,
        bodies: s.bodies.map((b) =>
          b.id === 1
            ? {
                ...b,
                colony: b.colony.map((c, i) =>
                  i === getBoard(b.radius).indexOf(3, 0)
                    ? {
                        owner: 0,
                        biomass: 2,
                        core: false,
                        connected: false,
                        fruiting: null,
                        cut: 0,
                      }
                    : c,
                ),
              }
            : b,
        ),
        spores: [
          {
            id: 9,
            owner: 0,
            sourceBody: 0,
            targetBody: 1,
            targetCell: { q: 3, r: 0 },
            landing: 3,
            launchedTurn: -2,
            arrivalTurn: 0,
          },
        ],
      },
      {},
    );
    expect(cellAt(own.state, 1, 3, 0)).toMatchObject({ owner: 0, core: true, biomass: 3 });
  });

  it("landing on an enemy cell contests landing biomass against its defense", () => {
    const won = land({ q: 3, r: 0 }, [{ q: 3, r: 0, owner: 1, biomass: 1 }], 3);
    // Defense 1 (disconnected, no support) vs 3: captured as a core with 2.
    expect(cellAt(won.state, 1, 3, 0)).toMatchObject({ owner: 0, core: true, biomass: 2 });
    expect(ofType(won.events, "SporeLanded")).toMatchObject([{ outcome: "captured", from: 1 }]);
    const lost = land({ q: 1, r: 0 }, [{ q: 1, r: 0, owner: 1, biomass: 4 }], 3);
    expect(cellAt(lost.state, 1, 1, 0)).toMatchObject({ owner: 1, biomass: 3 });
    expect(ofType(lost.events, "SporeLanded")).toMatchObject([{ outcome: "repelled" }]);
    const core = land({ q: 0, r: 0 }, [], 9);
    expect(ofType(core.events, "CoreDestroyed")).toMatchObject([{ player: 1, by: 0 }]);
  });

  it("simultaneous landings on one cell: the strongest lands, a tie kills every spore", () => {
    const s = ABC();
    const spore = (id: number, owner: number, landing: number) => ({
      id,
      owner,
      sourceBody: 2,
      targetBody: 1,
      targetCell: { q: 3, r: 0 },
      landing,
      launchedTurn: -1,
      arrivalTurn: 0,
    });
    const win = resolveTurn({ ...s, spores: [spore(1, 0, 3), spore(2, 1, 4)] }, {});
    expect(cellAt(win.state, 1, 3, 0)).toMatchObject({ owner: 1, core: true, biomass: 4 });
    const tie = resolveTurn({ ...s, spores: [spore(1, 0, 3), spore(2, 1, 3)] }, {});
    expect(cellAt(tie.state, 1, 3, 0)).toBeNull();
    expect(ofType(tie.events, "SporeLanded").map((e) => e.outcome)).toEqual([
      "collided",
      "collided",
    ]);
  });

  it("a launch fizzles if its fruiting body is captured during growth", () => {
    const s = ABC({}, [{ q: 1, r: 0, owner: 0, biomass: 1, fruiting: 0 }], []);
    // Player 1 also owns a strong cell on body 0 next to the launcher.
    const b0 = s.bodies[0]!;
    const i = getBoard(b0.radius).indexOf(2, 0);
    const s2 = {
      ...s,
      bodies: s.bodies.map((b) =>
        b.id === 0
          ? {
              ...b,
              colony: b.colony.map((c, k) =>
                k === i
                  ? { owner: 1, biomass: 9, core: false, connected: true, fruiting: null, cut: 0 }
                  : c,
              ),
            }
          : b,
      ),
    };
    const r = resolveTurn(s2, {
      0: [launch(0, 1, 0, 1, 2, 0)],
      1: [
        {
          type: "grow",
          body: 0,
          path: [
            { q: 2, r: 0 },
            { q: 1, r: 0 },
          ],
        },
      ],
    });
    expect(ofType(r.events, "LaunchFizzled")).toHaveLength(1);
    expect(r.state.spores).toEqual([]);
  });

  it("a player with no cores but a spore in flight is not eliminated (SPEC §3)", () => {
    const s = systemScenario({
      bodies: [
        {
          orbit: { radius: 3, period: 360, phase: 0 },
          cells: [{ q: 1, r: 0, owner: 0, biomass: 3 }],
        },
        {
          orbit: { radius: 9, period: 360, phase: 0 },
          cells: [{ q: 0, r: 0, owner: 1, biomass: 5, core: true }],
        },
      ],
    });
    const flying = {
      ...s,
      spores: [
        {
          id: 1,
          owner: 0,
          sourceBody: 0,
          targetBody: 1,
          targetCell: { q: 3, r: 0 },
          landing: 3,
          launchedTurn: 0,
          arrivalTurn: 1,
        },
      ],
    };
    const r1 = resolveTurn(flying, {});
    expect(r1.state.players[0]!.eliminated).toBe(false);
    const r2 = resolveTurn(r1.state, {});
    expect(r2.state.players[0]!.eliminated).toBe(false);
    expect(cellAt(r2.state, 1, 3, 0)).toMatchObject({ owner: 0, core: true });
    const bare = resolveTurn(s, {});
    expect(bare.state.players[0]!.eliminated).toBe(true);
  });
});

describe("SPEC §4.3 body types", () => {
  it("Metallic: growth costs +1 N and max biomass is +2", () => {
    const s = systemScenario({
      bodies: [
        {
          orbit: { radius: 3, period: 360, phase: 0 },
          type: "metallic",
          cells: [
            { q: 0, r: 0, owner: 0, biomass: 12, core: true },
            { q: 1, r: 0, owner: 0, biomass: 9 },
          ],
        },
        {
          orbit: { radius: 9, period: 360, phase: 0 },
          cells: [{ q: 0, r: 0, owner: 1, biomass: 5, core: true }],
        },
      ],
    });
    expect(
      validateOrderSet(s, 0, [
        {
          type: "grow",
          body: 0,
          path: [
            { q: 1, r: 0 },
            { q: 2, r: 0 },
          ],
        },
      ]),
    ).toEqual({ ok: true, cost: 3 });
    const r = resolveTurn(s, {
      0: [
        { type: "reinforce", body: 0, cell: { q: 0, r: 0 } },
        { type: "reinforce", body: 0, cell: { q: 1, r: 0 } },
      ],
    });
    expect(cellAt(r.state, 0, 0, 0)?.biomass).toBe(14);
    expect(cellAt(r.state, 0, 1, 0)?.biomass).toBe(11);
  });

  it("Irradiated: every non-core biomass-1 cell is removed at the end of the turn", () => {
    const s = systemScenario({
      bodies: [
        {
          orbit: { radius: 3, period: 360, phase: 0 },
          type: "irradiated",
          cells: [
            { q: 0, r: 0, owner: 0, biomass: 1, core: true },
            { q: 1, r: 0, owner: 0, biomass: 1 },
            { q: 0, r: 1, owner: 0, biomass: 2 },
          ],
        },
        {
          orbit: { radius: 9, period: 360, phase: 0 },
          cells: [{ q: 0, r: 0, owner: 1, biomass: 5, core: true }],
        },
      ],
    });
    const r = resolveTurn(s, {});
    expect(cellAt(r.state, 0, 1, 0)).toBeNull();
    expect(cellAt(r.state, 0, 0, 1)).toMatchObject({ biomass: 2 });
    expect(cellAt(r.state, 0, 0, 0)).toMatchObject({ core: true, biomass: 1 });
    expect(ofType(r.events, "Irradiated")).toHaveLength(1);
  });

  it("Irradiated spares cells gained this turn once, so they can be thickened (DECISIONS)", () => {
    const s = systemScenario({
      bodies: [
        {
          orbit: { radius: 3, period: 360, phase: 0 },
          type: "irradiated",
          cells: [
            { q: 0, r: 0, owner: 0, biomass: 5, core: true },
            { q: 1, r: 0, owner: 0, biomass: 3 },
          ],
        },
        {
          orbit: { radius: 9, period: 360, phase: 0 },
          cells: [{ q: 0, r: 0, owner: 1, biomass: 5, core: true }],
        },
      ],
    });
    const grow: Order = {
      type: "grow",
      body: 0,
      path: [
        { q: 1, r: 0 },
        { q: 2, r: 0 },
      ],
    };
    const t1 = resolveTurn(s, { 0: [grow] });
    expect(cellAt(t1.state, 0, 2, 0)).toMatchObject({ owner: 0, biomass: 1 });
    expect(ofType(t1.events, "Irradiated")).toEqual([]);
    // Left thin, it burns at the end of the next turn; reinforced, it stays.
    expect(cellAt(resolveTurn(t1.state, {}).state, 0, 2, 0)).toBeNull();
    const kept = resolveTurn(t1.state, {
      0: [{ type: "reinforce", body: 0, cell: { q: 2, r: 0 } }],
    });
    expect(cellAt(kept.state, 0, 2, 0)).toMatchObject({ biomass: 4 });
  });
});

describe("SPEC §8 events", () => {
  it("a flare hits the sun-facing half of each body: −2 biomass, removed at 0, cores kept at ≥ 1", () => {
    // Body 0 sits at (3, 0): the star is to its −x side, so cells with 2q + r ≤ 0 face it.
    // The spec's flare (M6 ships a gentler one, tested below; DECISIONS).
    const s = ABC(
      {
        rules: { flareLoss: 2, flareMinBiomass: 0 },
        schedule: [
          { kind: "flare", turn: 0 },
          { kind: "flare", turn: 1 },
        ],
      },
      [
        { q: -2, r: 0, owner: 0, biomass: 5 },
        { q: -1, r: 0, owner: 0, biomass: 2 },
        { q: 1, r: 0, owner: 0, biomass: 5 },
        { q: 2, r: 0, owner: 0, biomass: 5 },
      ],
    );
    const core1 = s.bodies[0]!.colony.map((c) => (c?.core ? { ...c, biomass: 1 } : c));
    const r = resolveTurn(
      { ...s, bodies: s.bodies.map((b) => (b.id === 0 ? { ...b, colony: core1 } : b)) },
      {},
    );
    expect(cellAt(r.state, 0, -2, 0)?.biomass).toBe(3);
    expect(cellAt(r.state, 0, -1, 0)).toBeNull();
    expect(cellAt(r.state, 0, 1, 0)?.biomass).toBe(5);
    expect(cellAt(r.state, 0, 2, 0)?.biomass).toBe(5);
    expect(cellAt(r.state, 0, 0, 0)).toMatchObject({ core: true, biomass: 1 });
    expect(ofType(r.events, "FlareWarning")).toEqual([{ type: "FlareWarning", impactTurn: 1 }]);
    // Body 1 at (9, 0): its core at (0, 0) is on the boundary (dot = 0) and is hit too.
    expect(ofType(r.events, "FlareStruck").some((e) => e.cell.body === 1)).toBe(true);
  });

  it("the tuned flare weakens sun-facing cells by 1 but never below 1 (DECISIONS)", () => {
    const s = ABC({ schedule: [{ kind: "flare", turn: 0 }] }, [
      { q: -2, r: 0, owner: 0, biomass: 5 },
      { q: -1, r: 0, owner: 0, biomass: 1 },
    ]);
    const r = resolveTurn(s, {});
    expect(cellAt(r.state, 0, -2, 0)?.biomass).toBe(4);
    expect(cellAt(r.state, 0, -1, 0)).toMatchObject({ biomass: 1 });
    expect(ofType(r.events, "FlareStruck").some((e) => e.cell.q === -1 && e.cell.body === 0)).toBe(
      false,
    );
  });

  it("a comet is announced 2 turns ahead, seeds a yield-5 Organic deposit for 6 turns, then fades", () => {
    // Body 1's only open cell next to the core is (1, 0): everything else is rock or deposit.
    const rock = getBoard(5).cells.filter(
      (h) => !(h.q === 0 && h.r === 0) && !(h.q === 1 && h.r === 0),
    );
    const s = systemScenario({
      bodies: [
        {
          orbit: { radius: 3, period: 360, phase: 0 },
          cells: [{ q: 0, r: 0, owner: 0, biomass: 5, core: true }],
        },
        {
          orbit: { radius: 9, period: 360, phase: 0 },
          rock,
          cells: [{ q: 0, r: 0, owner: 1, biomass: 5, core: true }],
        },
      ],
      schedule: [{ kind: "comet", turn: 2, body: 1 }],
    });
    let r = resolveTurn(s, {});
    expect(ofType(r.events, "CometWarning")).toEqual([
      { type: "CometWarning", arrivalTurn: 2, body: 1 },
    ]);
    r = resolveTurn(r.state, {});
    r = resolveTurn(r.state, {});
    expect(ofType(r.events, "CometArrived")).toMatchObject([
      { cell: { body: 1, q: 1, r: 0 }, until: 8, yield: 5 },
    ]);
    // Player 1 grows onto it and earns 2 (core) + 5 (comet) from then on.
    r = resolveTurn(r.state, {
      1: [
        {
          type: "grow",
          body: 1,
          path: [
            { q: 0, r: 0 },
            { q: 1, r: 0 },
          ],
        },
      ],
    });
    expect(ofType(r.events, "Income").find((e) => e.player === 1)?.amount).toBe(7);
    for (let t = r.state.turn; t < 8; t++) r = resolveTurn(r.state, {});
    expect(r.state.bodies[1]!.comets).toHaveLength(1);
    r = resolveTurn(r.state, {});
    expect(ofType(r.events, "CometFaded")).toHaveLength(1);
    expect(r.state.bodies[1]!.comets).toEqual([]);
  });
});

void cellAtBody0;

describe("stored states from before M5", () => {
  it("upgrade to the current shape and keep resolving identically", () => {
    const fresh = createGame({ mode: "singleRock", playerCount: 2 }, "upgrade");
    // What an M4 snapshot looked like: no orbits, comets, fruiting, spores or schedule.
    const old = JSON.parse(JSON.stringify(fresh)) as Record<string, unknown> & GameState;
    delete (old as Partial<GameState>).spores;
    delete (old as Partial<GameState>).nextSporeId;
    delete (old as Partial<GameState>).schedule;
    for (const b of old.bodies) {
      delete (b as Partial<Body>).orbit;
      delete (b as Partial<Body>).home;
      delete (b as Partial<Body>).comets;
      for (const c of b.colony) if (c) delete (c as Partial<typeof c>).fruiting;
    }
    const up = upgradeState(old);
    expect(up).toEqual(fresh);
    expect(hashState(up)).toBe(hashState(fresh));
    const orders = { 0: randomOrderSet(fresh, 0, "u"), 1: randomOrderSet(fresh, 1, "v") };
    expect(hashState(resolveTurn(up, orders).state)).toBe(
      hashState(resolveTurn(fresh, orders).state),
    );
    // Current states pass through unchanged.
    expect(upgradeState(fresh)).toEqual(fresh);
  });
});
