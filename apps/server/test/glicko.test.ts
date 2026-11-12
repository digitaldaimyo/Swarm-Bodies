import { describe, expect, it } from "vitest";
import { initialRating, rateGame, updateRating } from "../src/glicko";

describe("Glicko-2 (SPEC §11.2)", () => {
  it("matches Glickman's worked example", () => {
    const r = updateRating({ rating: 1500, deviation: 200, volatility: 0.06 }, [
      { opponent: { rating: 1400, deviation: 30, volatility: 0.06 }, score: 1 },
      { opponent: { rating: 1550, deviation: 100, volatility: 0.06 }, score: 0 },
      { opponent: { rating: 1700, deviation: 300, volatility: 0.06 }, score: 0 },
    ]);
    expect(r.rating).toBeCloseTo(1464.06, 1);
    expect(r.deviation).toBeCloseTo(151.52, 1);
    expect(r.volatility).toBeCloseTo(0.05999, 4);
  });

  it("a 1v1 moves the winner up and the loser down by the same amount from equal ratings", () => {
    const [w, l] = rateGame([
      { rating: initialRating(), place: 0 },
      { rating: initialRating(), place: 1 },
    ]) as [ReturnType<typeof initialRating>, ReturnType<typeof initialRating>];
    expect(w.rating).toBeGreaterThan(1500);
    expect(l.rating).toBeLessThan(1500);
    expect(w.rating - 1500).toBeCloseTo(1500 - l.rating, 6);
    expect(w.deviation).toBeLessThan(350);
  });

  it("FFA is pairwise: first beats everyone, last loses to everyone, ties draw", () => {
    const out = rateGame([
      { rating: initialRating(), place: 0 },
      { rating: initialRating(), place: 1 },
      { rating: initialRating(), place: 1 },
      { rating: initialRating(), place: 3 },
    ]).map((r) => r.rating);
    expect(out[0]).toBeGreaterThan(out[1] as number);
    expect(out[1]).toBeCloseTo(out[2] as number, 6);
    expect(out[2]).toBeGreaterThan(out[3] as number);
  });

  it("an idle period only widens the deviation, up to the initial value", () => {
    const r = updateRating({ rating: 1600, deviation: 50, volatility: 0.06 }, []);
    expect(r.rating).toBe(1600);
    expect(r.deviation).toBeGreaterThan(50);
    expect(updateRating(initialRating(), []).deviation).toBe(350);
  });
});
