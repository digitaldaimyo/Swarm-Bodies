/**
 * Scoring weights for the utility bot (SPEC §13.2–13.3). Values are in "nutrient equivalents":
 * roughly, how many N a player would pay for the outcome.
 *
 * These are AI tuning knobs, not game rules, so they live with the bot rather than in
 * packages/sim/src/config.ts (see docs/DECISIONS.md).
 */
export interface BotWeights {
  /** Owning one more cell (dominance). */
  cell: number;
  /** Turns of deposit income a deposit is worth, capped by the turns left. */
  incomeHorizon: number;
  /** Pull of frontier progress toward deposits not yet ours. */
  potential: number;
  /** Per-step decay of a deposit's pull with distance (0–1). */
  potentialDecay: number;
  /** Extra value for each enemy cell captured, on top of `cell`. */
  capture: number;
  /** Per enemy cell disconnected by a capture (severing a vein). */
  sever: number;
  /** Capturing an enemy core. Multiplied by 10 if it is their last one. */
  coreKill: number;
  /** Weight on expected losses avoided by reinforcing. */
  threat: number;
  /** Value multiplier for an empty cell an enemy could also claim this turn. */
  contestRisk: number;
  /** Worth of each unclaimed cell on a body a spore could open up (SPEC §6, §13.2). */
  expansion: number;
  /** Fraction of a future launch's value credited to growing a fruiting body now. */
  fruitFaith: number;
}

export const NORMAL_WEIGHTS: BotWeights = {
  cell: 2,
  incomeHorizon: 10,
  potential: 0.5,
  potentialDecay: 0.6,
  capture: 2,
  sever: 2.5,
  coreKill: 40,
  threat: 1,
  contestRisk: 0.5,
  expansion: 0.6,
  fruitFaith: 0.6,
};

export type Personality = "balanced" | "aggressive" | "greedy" | "expansionist" | "saboteur";

/** Campaign flavours (SPEC §13.3), as adjustments to the Normal weights. */
export const PERSONALITIES: Record<Personality, BotWeights> = {
  balanced: NORMAL_WEIGHTS,
  aggressive: { ...NORMAL_WEIGHTS, capture: 4, coreKill: 80, threat: 0.5 },
  greedy: { ...NORMAL_WEIGHTS, incomeHorizon: 16, potential: 1 },
  expansionist: { ...NORMAL_WEIGHTS, cell: 3, potential: 0.3, expansion: 1.2, fruitFaith: 0.9 },
  saboteur: { ...NORMAL_WEIGHTS, sever: 4, capture: 3 },
};
