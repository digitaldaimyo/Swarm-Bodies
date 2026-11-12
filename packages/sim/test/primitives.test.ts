import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  getBoard,
  hexDistance,
  idiv,
  isqrt,
  rngStream,
  canonicalJson,
  deserialize,
  serialize,
  createGame,
  hashState,
} from "./sim";

describe("integer math", () => {
  it("idiv is floor division", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1e6, max: 1e6 }),
        fc.integer({ min: -1000, max: 1000 }).filter((b) => b !== 0),
        (a, b) => {
          expect(idiv(a, b)).toBe(Math.floor(a / b) + 0);
        },
      ),
    );
  });
  it("isqrt is the integer square root", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e12 }), (n) => {
        const r = isqrt(n);
        expect(r * r).toBeLessThanOrEqual(n);
        expect((r + 1) * (r + 1)).toBeGreaterThan(n);
      }),
    );
  });
});

describe("SPEC §9.3 RNG", () => {
  it("named streams are reproducible and independent", () => {
    const a = rngStream("seed", "events");
    const b = rngStream("seed", "events");
    const c = rngStream("seed", "draft:2:1");
    const xs = Array.from({ length: 20 }, () => a.nextU32());
    expect(Array.from({ length: 20 }, () => b.nextU32())).toEqual(xs);
    expect(Array.from({ length: 20 }, () => c.nextU32())).not.toEqual(xs);
  });
  it("matches committed values (guards against accidental algorithm changes)", () => {
    const r = rngStream("swarm", "golden");
    expect(Array.from({ length: 4 }, () => r.nextU32())).toMatchInlineSnapshot(`
      [
        1366706931,
        246240046,
        2194156941,
        517512796,
      ]
    `);
  });
  it("int stays in range and weighted respects zero weights", () => {
    const r = rngStream("x", "y");
    for (let i = 0; i < 1000; i++) {
      const v = r.int(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
      expect(r.weighted([0, 3, 0])).toBe(1);
    }
  });
});

describe("hex grid", () => {
  it("neighbour lists are symmetric and at distance 1", () => {
    const board = getBoard(5);
    expect(board.cells).toHaveLength(91);
    board.neighbours.forEach((ns, i) => {
      for (const n of ns) {
        expect(hexDistance(board.cells[i]!, board.cells[n]!)).toBe(1);
        expect(board.neighbours[n]).toContain(i);
      }
    });
    expect(board.neighbours[board.indexOf(0, 0)]).toHaveLength(6);
    expect(board.neighbours[board.indexOf(5, 0)]).toHaveLength(3);
  });
});

describe("SPEC §9.2 serialization", () => {
  it("canonical JSON sorts keys", () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: null }] })).toBe('{"a":[{"c":null,"d":2}],"b":1}');
  });
  it("round-trips a state with an identical hash", () => {
    const s = createGame({ mode: "singleRock", playerCount: 2 }, "rt");
    const back = deserialize(serialize(s));
    expect(back).toEqual(s);
    expect(hashState(back)).toBe(hashState(s));
    expect(() => deserialize('{"version":2}')).toThrow();
  });
});
