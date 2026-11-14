import { describe, expect, it } from "vitest";
import { arcPoints } from "../src/render/arc";

describe("arc points (playtest: stray lines on rims and rings)", () => {
  it("runs from the start angle to the end angle on the circle", () => {
    const p = arcPoints(10, 20, 8, -Math.PI / 2, Math.PI / 2);
    expect(p[0]).toBeCloseTo(10);
    expect(p[1]).toBeCloseTo(12);
    expect(p[p.length - 2]).toBeCloseTo(10);
    expect(p[p.length - 1]).toBeCloseTo(28);
    for (let k = 0; k < p.length; k += 2) {
      expect(Math.hypot(p[k]! - 10, p[k + 1]! - 20)).toBeCloseTo(8);
    }
  });

  it("has no repeated or near-repeated points, so every segment has a direction", () => {
    for (const [r, a, b] of [
      [14, -Math.PI / 2, (3 * Math.PI) / 2],
      [30, 0, 0.12],
      [8, 1, 1.0001],
    ] as const) {
      const p = arcPoints(0, 0, r, a, b);
      for (let k = 2; k < p.length; k += 2) {
        expect(Math.hypot(p[k]! - p[k - 2]!, p[k + 1]! - p[k - 1]!)).toBeGreaterThan(1e-4);
      }
    }
  });

  it("is empty for a zero sweep or radius", () => {
    expect(arcPoints(0, 0, 10, 1, 1)).toEqual([]);
    expect(arcPoints(0, 0, 0, 0, 1)).toEqual([]);
  });
});
