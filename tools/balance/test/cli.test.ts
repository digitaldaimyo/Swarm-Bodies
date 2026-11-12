import { describe, expect, it } from "vitest";
import { parseArgs, runBatch } from "../src/cli";
import { checkTargets, formatMatrix, mergeMatrices, runMatrix } from "../src/matrix";

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

  it("plays a strain matrix and checks the §12.4 targets (M6)", () => {
    const m = runMatrix({ games: 12, seed: "mx", map: "system" });
    expect(m.pairs).toHaveLength(6);
    expect(m.pairs.every((p) => p.games === 2)).toBe(true);
    expect(m.errors).toBe(0);
    expect(m.rejectedOrders).toBe(0);
    const { targets, gate } = checkTargets(m);
    expect(targets.map((t) => t.name)).toEqual([
      "strain pairs 40–60%",
      "1v1 length 18–28 turns",
      "turn-limit stalls under 5%",
      "mutation pick win rate ≤ 58%",
    ]);
    expect(typeof gate.ok).toBe("boolean");
    expect(formatMatrix(m)).toContain("targets (SPEC §12.4)");
    // Shards partition the pairs and merge back to the same games.
    const parts = [0, 1, 2].map((index) =>
      runMatrix({ games: 12, seed: "mx", map: "system", shard: { index, of: 3 } }),
    );
    expect(
      mergeMatrices(parts)
        .pairs.map((p) => p.scoreA)
        .sort(),
    ).toEqual(m.pairs.map((p) => p.scoreA).sort());
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
      matrix: false,
      gate: false,
      jobs: 1,
      shard: null,
      rules: null,
    });
    expect(parseArgs(["--map", "system"]).map).toBe("system");
    expect(
      parseArgs([
        "--matrix",
        "--gate",
        "--jobs",
        "4",
        "--shard",
        "1/4",
        "--rules",
        '{"turnLimit":30}',
      ]),
    ).toMatchObject({
      matrix: true,
      gate: true,
      jobs: 4,
      shard: { index: 1, of: 4 },
      rules: { turnLimit: 30 },
    });
    expect(() => parseArgs(["--shard", "4/4"])).toThrow(/--shard/);
    expect(() => parseArgs(["--rules", "[1]"])).toThrow(/--rules/);
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
