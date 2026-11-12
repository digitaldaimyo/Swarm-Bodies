import { describe, expect, it } from "vitest";
import { ALL_MUTATIONS, mutationInfo, strainInfo } from "../src/index";

describe("strain content", () => {
  it("describes the strains from the sim's (M6-tuned) numbers (SPEC §7.1)", () => {
    expect(strainInfo("swarmer")).toEqual({
      id: "swarmer",
      name: "Swarmer",
      fantasy: "Fast, thin, everywhere",
      rules: ["Grow reach 4", "Max biomass 7"],
    });
    expect(strainInfo("biofilm").rules).toEqual([
      "Grow reach 2",
      "Max biomass 12",
      "Reinforce adds +4",
      "Fruit costs 14 N",
    ]);
    expect(strainInfo("base").rules).toEqual([]);
  });
});

describe("M6 content", () => {
  it("describes Predator and Sporer from the sim's numbers (SPEC §7.1)", () => {
    expect(strainInfo("predator").rules).toEqual([
      "Grow reach 4",
      "+1 attack on assaults",
      "Captures pay N equal to the biomass taken",
      "Deposit yields −1 (min 1)",
    ]);
    expect(strainInfo("sporer").rules).toEqual([
      "Fruit costs 7 N",
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
    expect(mutationInfo("acid_tendrils").effect).toBe("+1 attack on assaults.");
    expect(mutationInfo("dormancy").effect).toContain("first 5 disconnected turns");
    expect(mutationInfo("regeneration").effect).toBe(
      "Every 3 turns, connected cells below biomass 2 gain +1.",
    );
  });
});
