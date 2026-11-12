import { describe, expect, it } from "vitest";
import { ALL_MUTATIONS, mutationInfo, strainInfo } from "../src/index";

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

describe("M6 content", () => {
  it("describes Predator and Sporer from the sim's numbers (SPEC §7.1)", () => {
    expect(strainInfo("predator").rules).toEqual([
      "+1 attack on assaults",
      "Captures pay N equal to the biomass taken",
      "Deposit yields −1 (min 1)",
    ]);
    expect(strainInfo("sporer").rules).toEqual([
      "Fruit costs 6 N",
      "Matures in 1 turn",
      "Max 3 fruiting bodies",
      "Launch range +2",
      "Landing biomass 2",
    ]);
  });

  it("has text for all 12 mutations, with effects generated from the numbers (SPEC §7.3)", () => {
    expect(ALL_MUTATIONS).toHaveLength(12);
    for (const m of ALL_MUTATIONS) {
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.effect.length).toBeGreaterThan(0);
      expect(m.note.length).toBeGreaterThan(20);
    }
    expect(mutationInfo("acid_tendrils").effect).toBe("+2 attack on assaults.");
    expect(mutationInfo("dormancy").effect).toContain("first 3 disconnected turns");
  });
});
