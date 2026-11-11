import { describe, expect, it } from "vitest";
import { parseArgs, runBatch } from "../src/cli";

describe("tools/balance (SPEC §15 M1)", () => {
  it("plays random-legal games to completion without errors", () => {
    const report = runBatch({ games: 40, seed: "ci" });
    expect(report.errors).toEqual([]);
    expect(Object.values(report.wins).reduce((a, b) => a + b, 0) + report.draws).toBe(40);
    expect(report.rejectedOrders).toBe(0);
  });

  it("parses the documented flags, tolerating pnpm's `--`", () => {
    expect(
      parseArgs(["--", "--games", "5", "--strains", "swarmer,biofilm", "--seed", "x"]),
    ).toEqual({
      games: 5,
      seed: "x",
      strains: ["swarmer", "biofilm"],
      json: false,
    });
    expect(() => parseArgs(["--games", "zero"])).toThrow();
    expect(() => parseArgs(["--bogus"])).toThrow();
  });
});
