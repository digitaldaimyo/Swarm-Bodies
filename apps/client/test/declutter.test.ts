import { describe, expect, it } from "vitest";
import { declutter, type Disc } from "../src/game/declutter";

const centre = { x: 0, y: 0 };
const clear = (discs: Disc[], p: { x: number; y: number }[], gap: number) => {
  for (let i = 0; i < p.length; i++)
    for (let j = i + 1; j < p.length; j++)
      expect(Math.hypot(p[i]!.x - p[j]!.x, p[i]!.y - p[j]!.y)).toBeGreaterThanOrEqual(
        discs[i]!.r + discs[j]!.r + gap - 1e-3,
      );
};

describe("system view declutter (playtest: overlapping bodies)", () => {
  it("leaves bodies that already clear each other exactly where they are", () => {
    const discs = [
      { x: 100, y: 0, r: 20 },
      { x: -100, y: 0, r: 20 },
    ];
    expect(declutter(discs, centre)).toEqual([
      { x: 100, y: 0 },
      { x: -100, y: 0 },
    ]);
  });

  it("pushes overlapping bodies apart until they clear, moving each as little as needed", () => {
    const discs = [
      { x: 100, y: 0, r: 20 },
      { x: 110, y: 10, r: 20 },
      { x: 105, y: -8, r: 15 },
      { x: -50, y: 40, r: 15 },
    ];
    const p = declutter(discs, centre, 4);
    clear(discs, p, 4);
    // The lone body is untouched; the crowd stays near where it was.
    expect(p[3]).toEqual({ x: -50, y: 40 });
    for (let i = 0; i < 3; i++)
      expect(Math.hypot(p[i]!.x - discs[i]!.x, p[i]!.y - discs[i]!.y)).toBeLessThan(60);
  });

  it("splits bodies at the very same point radially, the outer orbit outward", () => {
    const discs = [
      { x: 80, y: 0, r: 15 },
      { x: 80, y: 0, r: 15 },
    ];
    const p = declutter(discs, centre, 4);
    clear(discs, p, 4);
    expect(p[1]!.x).toBeGreaterThan(p[0]!.x);
  });

  it("is deterministic", () => {
    const discs = [
      { x: 10, y: 10, r: 18 },
      { x: 20, y: 5, r: 18 },
      { x: 15, y: 25, r: 18 },
    ];
    expect(declutter(discs, centre)).toEqual(declutter(discs, centre));
  });
});
