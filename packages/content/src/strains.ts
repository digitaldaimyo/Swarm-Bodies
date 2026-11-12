import { BASE_RULES, playerRules, type GameState, type StrainId } from "@swarm/sim";

/**
 * Strain presentation (SPEC §7.1): names, fantasy and the rules text shown in pickers and the
 * codex. The numbers themselves live in the sim's config (they are tunables); the rule lines
 * here are generated from them so text and rules cannot drift apart.
 */
export interface StrainInfo {
  id: StrainId;
  name: string;
  fantasy: string;
  rules: string[];
}

const TEXT: Record<StrainId, { name: string; fantasy: string }> = {
  base: { name: "Wild type", fantasy: "The unmodified colony" },
  swarmer: { name: "Swarmer", fantasy: "Fast, thin, everywhere" },
  biofilm: { name: "Biofilm", fantasy: "Slow, dense, immovable" },
  predator: { name: "Predator", fantasy: "Eats the enemy" },
  sporer: { name: "Sporer", fantasy: "Spreads across the system" },
};

export function strainInfo(id: StrainId): StrainInfo {
  // Build a throwaway one-player view so the text uses exactly the sim's rule resolution.
  const probe = {
    rules: BASE_RULES,
    players: [{ id: 0, strain: id, mutations: [] }],
  } as unknown as GameState;
  const r = playerRules(probe, 0);
  const lines: string[] = [];
  if (r.growReach !== BASE_RULES.growReach) lines.push(`Grow reach ${r.growReach}`);
  if (r.entryCostDelta !== 0)
    lines.push(`Entry cost ${r.entryCostDelta > 0 ? "+" : "−"}${Math.abs(r.entryCostDelta)} N`);
  if (r.maxBiomass !== BASE_RULES.maxBiomass) lines.push(`Max biomass ${r.maxBiomass}`);
  if (r.defenseSupport !== BASE_RULES.defenseSupport)
    lines.push(`Defensive support ${r.defenseSupport}`);
  if (r.reinforceAmount !== BASE_RULES.reinforceAmount)
    lines.push(`Reinforce adds +${r.reinforceAmount}`);
  if (r.assaultBonus !== 0) lines.push(`+${r.assaultBonus} attack on assaults`);
  if (r.captureFeeds) lines.push("Captures pay N equal to the biomass taken");
  const yieldDelta = BASE_RULES.strains[id].depositYieldDelta ?? 0;
  if (yieldDelta !== 0)
    lines.push(
      `Deposit yields ${yieldDelta > 0 ? "+" : "−"}${Math.abs(yieldDelta)} (min ${BASE_RULES.minDepositYield})`,
    );
  if (r.fruitCost !== BASE_RULES.fruitCost) lines.push(`Fruit costs ${r.fruitCost} N`);
  if (r.fruitMatureTurns !== BASE_RULES.fruitMatureTurns)
    lines.push(`Matures in ${r.fruitMatureTurns} turn${r.fruitMatureTurns === 1 ? "" : "s"}`);
  if (r.maxFruiting !== BASE_RULES.maxFruiting) lines.push(`Max ${r.maxFruiting} fruiting bodies`);
  if (r.launchRange !== BASE_RULES.launchRange)
    lines.push(`Launch range +${r.launchRange - BASE_RULES.launchRange}`);
  if (r.landingBiomass !== BASE_RULES.landingBiomass)
    lines.push(`Landing biomass ${r.landingBiomass}`);
  return { id, ...TEXT[id], rules: lines };
}
