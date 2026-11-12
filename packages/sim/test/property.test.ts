import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  connectivityOf,
  maxBiomassFor,
  createGame,
  hashState,
  randomOrderSet,
  resolveTurn,
  type GameState,
  type Order,
  type OrderSet,
} from "./sim";

/** SPEC §14 sim invariants, checked after every turn. */
function checkInvariants(s: GameState): void {
  const { rules } = s;
  void rules.maxBiomass;
  for (const body of s.bodies) {
    const flags = connectivityOf(body.radius, body.colony);
    body.colony.forEach((c, i) => {
      if (!c) return;
      expect(body.terrain[i]).not.toBe("rock");
      expect(Number.isInteger(c.biomass)).toBe(true);
      expect(c.biomass).toBeGreaterThanOrEqual(1);
      expect(c.biomass).toBeLessThanOrEqual(maxBiomassFor(s, c, body));
      if (c.core) expect(c.fruiting).toBeNull();
      if (c.fruiting !== null) expect(c.fruiting).toBeGreaterThanOrEqual(0);
      expect(c.connected).toBe(flags[i]);
      expect(s.players.some((p) => p.id === c.owner)).toBe(true);
    });
    const open = body.terrain.filter((t) => t !== "rock").length;
    expect(body.colony.filter(Boolean).length).toBeLessThanOrEqual(open);
  }
  for (const p of s.players) {
    expect(Number.isInteger(p.nutrients)).toBe(true);
    expect(p.nutrients).toBeGreaterThanOrEqual(0);
  }
  expect(s.turn).toBeLessThanOrEqual(rules.turnLimit + 1);
  for (const sp of s.spores) {
    expect(sp.arrivalTurn).toBeGreaterThanOrEqual(s.turn);
    expect(sp.targetBody).not.toBe(sp.sourceBody);
  }
  for (const p of s.players) {
    let fruiting = 0;
    for (const b of s.bodies)
      for (const c of b.colony) if (c?.owner === p.id && c.fruiting !== null) fruiting++;
    expect(fruiting).toBeLessThanOrEqual(rules.maxFruiting);
  }
}

const hexArb = fc.record({
  q: fc.integer({ min: -10, max: 10 }),
  r: fc.integer({ min: -10, max: 10 }),
});
/** Arbitrary, mostly invalid orders: resolution must drop them without breaking anything. */
const junkOrder: fc.Arbitrary<Order> = fc.oneof(
  fc.record({
    type: fc.constant("grow" as const),
    body: fc.constant(0),
    path: fc.array(hexArb, { minLength: 0, maxLength: 5 }),
  }),
  fc.record({
    type: fc.constant("reinforce" as const),
    body: fc.integer({ min: -1, max: 1 }),
    cell: hexArb,
  }),
  fc.record({ type: fc.constant("retract" as const), body: fc.constant(0), cell: hexArb }),
);

function playGame(
  seed: string,
  playSeed: string,
  junk: Order[][] = [],
  turns = Infinity,
): GameState[] {
  let s = createGame({ mode: "singleRock", playerCount: 2 }, seed);
  const states = [s];
  for (let t = 0; t < turns && !s.result; t++) {
    const orders: Record<number, OrderSet> = {};
    for (const p of s.players)
      orders[p.id] = [
        ...randomOrderSet(s, p.id, playSeed),
        ...(junk[t % Math.max(1, junk.length)] ?? []),
      ];
    s = resolveTurn(s, orders).state;
    states.push(s);
  }
  return states;
}

describe("SPEC §14 property tests", () => {
  it("random-legal games keep every invariant and always finish", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.string({ maxLength: 8 }),
        (seed, playSeed) => {
          const states = playGame(seed, playSeed);
          states.forEach(checkInvariants);
          expect(states.at(-1)!.result).not.toBeNull();
        },
      ),
      { numRuns: 30 },
    );
  });

  it("random-legal star-system games (2–4 players) keep every invariant, launch spores, and finish", () => {
    let launched = 0;
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.integer({ min: 2, max: 4 }),
        (seed, players) => {
          let st = createGame(
            {
              mode: "system",
              playerCount: players,
              strains: ["swarmer", "biofilm", "base", "swarmer"],
            },
            seed,
          );
          checkInvariants(st);
          while (!st.result) {
            const orders: Record<number, OrderSet> = {};
            for (const p of st.players) orders[p.id] = randomOrderSet(st, p.id, "sys");
            const r = resolveTurn(st, orders);
            expect(r.events.filter((e) => e.type === "OrderRejected")).toEqual([]);
            launched += r.events.filter((e) => e.type === "SporeLaunched").length;
            st = r.state;
            checkInvariants(st);
          }
        },
      ),
      { numRuns: 15 },
    );
    expect(launched).toBeGreaterThan(0);
  });

  it("junk orders are rejected without breaking invariants", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc.array(fc.array(junkOrder, { maxLength: 14 }), { minLength: 1, maxLength: 5 }),
        (seed, junk) => {
          playGame(seed, "j", junk, 12).forEach(checkInvariants);
        },
      ),
      { numRuns: 40 },
    );
  });

  it("random-legal order sets are always valid", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (seed) => {
        let s = createGame({ mode: "singleRock", playerCount: 2 }, seed);
        for (let t = 0; t < 15 && !s.result; t++) {
          const orders: Record<number, OrderSet> = {};
          for (const p of s.players) orders[p.id] = randomOrderSet(s, p.id, "v");
          const { state, events } = resolveTurn(s, orders);
          expect(events.filter((e) => e.type === "OrderRejected")).toEqual([]);
          s = state;
        }
      }),
      { numRuns: 20 },
    );
  });

  it("resolution is deterministic", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (seed) => {
        const a = playGame(seed, "d").map(hashState);
        const b = playGame(seed, "d").map(hashState);
        expect(a).toEqual(b);
      }),
      { numRuns: 10 },
    );
  });

  it("the key order and prototype of ordersByPlayer do not change results", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.integer({ min: 1, max: 20 }), (seed, turns) => {
        const s = playGame(seed, "k", [], turns).at(-1)!;
        if (s.result) return;
        const o0 = randomOrderSet(s, 0, "k2");
        const o1 = randomOrderSet(s, 1, "k2");
        const forward: Record<number, OrderSet> = { 0: o0, 1: o1 };
        const reverse = Object.create(null) as Record<number, OrderSet>;
        reverse[1] = o1;
        reverse[0] = o0;
        const viaMap = Object.fromEntries(
          new Map<number, OrderSet>([
            [1, o1],
            [0, o0],
          ]),
        );
        const h = hashState(resolveTurn(s, forward).state);
        expect(hashState(resolveTurn(s, reverse).state)).toBe(h);
        expect(hashState(resolveTurn(s, viaMap).state)).toBe(h);
      }),
      { numRuns: 20 },
    );
  });

  it("swapping players on the mirrored map gives the mirrored outcome", () => {
    // Single Rock is point-symmetric. Mirroring every order and swapping who issues them must
    // mirror the board exactly — except where ascending-player-id tie-breaks could matter,
    // which never apply in 2-player contests (ties stalemate). This catches hidden order bias.
    const mirrorOrder = (o: Order): Order =>
      o.type === "grow"
        ? { ...o, path: o.path.map((h) => ({ q: 0 - h.q, r: 0 - h.r })) }
        : { ...o, cell: { q: 0 - o.cell.q, r: 0 - o.cell.r } };
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (seed) => {
        let s = createGame({ mode: "singleRock", playerCount: 2 }, seed);
        for (let t = 0; t < 25 && !s.result; t++) {
          const o0 = randomOrderSet(s, 0, "m");
          const o1 = randomOrderSet(s, 1, "m");
          const a = resolveTurn(s, { 0: o0, 1: o1 }).state;
          // Mirrored world: player 1 plays player 0's mirrored orders and vice versa.
          const swapped = mirrorState(s);
          const b = resolveTurn(swapped, { 0: o1.map(mirrorOrder), 1: o0.map(mirrorOrder) }).state;
          expect(hashState(mirrorState(b))).toBe(hashState(a));
          s = a;
        }
      }),
      { numRuns: 10 },
    );
  });
});

/** Reflects the board through the centre and swaps player ids 0 and 1. */
function mirrorState(s: GameState): GameState {
  const body = s.bodies[0]!;
  const n = body.colony.length;
  // Canonical cell order is by r then q, so the reflection of index i is n - 1 - i.
  const flip = <T>(xs: T[]): T[] => xs.map((_, i) => xs[n - 1 - i] as T);
  return {
    ...s,
    bodies: [
      {
        ...body,
        terrain: flip(body.terrain),
        deposits: flip(body.deposits),
        colony: flip(body.colony).map((c) => (c ? { ...c, owner: 1 - c.owner } : null)),
      },
    ],
    players: [s.players[1]!, s.players[0]!].map((p, i) => ({
      ...p,
      id: i,
      home: { body: p.home.body, cell: { q: 0 - p.home.cell.q, r: 0 - p.home.cell.r } },
    })),
    result: s.result
      ? { ...s.result, winner: s.result.winner === null ? null : 1 - s.result.winner }
      : null,
  };
}
