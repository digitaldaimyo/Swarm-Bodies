import { describe, expect, it } from "vitest";
import { strainInfo } from "../src/index";

describe("strain content", () => {
  it("describes the M4 strains from the sim's numbers (SPEC §7.1)", () => {
    expect(strainInfo("swarmer")).toEqual({
      id: "swarmer",
      name: "Swarmer",
      fantasy: "Fast, thin, everywhere",
      rules: ["Grow reach 4", "Entry cost −1 N", "Max biomass 7"],
    });
    expect(strainInfo("biofilm").rules).toEqual([
      "Grow reach 2",
      "Max biomass 12",
      "Defensive support 2",
      "Reinforce adds +4",
    ]);
    expect(strainInfo("base").rules).toEqual([]);
  });
});
