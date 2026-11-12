import { describe, expect, it } from "vitest";
import { parseArgs, runBatch } from "../src/cli";

describe("tools/balance", () => {
  it("plays random-legal games to completion without errors (M1)", () => {
    const report = runBatch({ games: 40, seed: "ci", players: ["random", "random"] });
    expect(report.errors).toEqual([]);
    expect(report.sides[0].wins + report.sides[1].wins + report.draws).toBe(40);
    expect(report.rejectedOrders).toBe(0);
  });

  it("Normal beats random-legal play in at least 95% of 200 games (M2 acceptance)", () => {
    const report = runBatch({ games: 200, seed: "m2", players: ["normal", "random"] });
    expect(report.errors).toEqual([]);
    expect(report.rejectedOrders).toBe(0);
    expect(report.sides[0].wins).toBeGreaterThanOrEqual(190);
  });

  it("plays strain matchups (M4)", () => {
    const report = runBatch({
      games: 20,
      seed: "strains",
      players: ["normal", "normal"],
      strains: ["swarmer", "biofilm"],
    });
    expect(report.errors).toEqual([]);
    expect(report.rejectedOrders).toBe(0);
    expect(report.sides.map((s) => s.strain)).toEqual(["swarmer", "biofilm"]);
  });

  it("plays system games where Normal launches spores (M5)", () => {
    const report = runBatch({
      games: 10,
      seed: "sys",
      players: ["normal", "random"],
      map: "system",
    });
    expect(report.errors).toEqual([]);
    expect(report.rejectedOrders).toBe(0);
    expect(report.launches).toBeGreaterThan(10);
    expect(report.sides[0].wins).toBeGreaterThanOrEqual(9);
  });

  it("parses the documented flags, tolerating pnpm's `--`", () => {
    expect(
      parseArgs(["--", "--games", "5", "--strains", "swarmer,biofilm", "--seed", "x"]),
    ).toEqual({
      games: 5,
      seed: "x",
      players: ["normal", "normal"],
      strains: ["swarmer", "biofilm"],
      map: "singleRock",
      json: false,
    });
    expect(parseArgs(["--map", "system"]).map).toBe("system");
    expect(() => parseArgs(["--map", "moon"])).toThrow(/--map/);
    expect(() => parseArgs(["--strains", "swarmer"])).toThrow();
    expect(() => parseArgs(["--strains", "swarmer,phage"])).toThrow();
    expect(parseArgs(["--players", "easy,random"]).players).toEqual(["easy", "random"]);
    expect(() => parseArgs(["--players", "normal"])).toThrow();
    expect(() => parseArgs(["--players", "normal,genius"])).toThrow();
    expect(() => parseArgs(["--games", "zero"])).toThrow();
    expect(() => parseArgs(["--bogus"])).toThrow();
  });
});
