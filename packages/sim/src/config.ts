/**
 * Every tunable number in the game lives here (CLAUDE.md: "Never tune numbers inline").
 * Percentages are stored as per-mille integers so game math stays integer-only (SPEC §9.2).
 *
 * A resolved copy of `Rules` is stored in every GameState, so a state always carries the
 * exact numbers it was created with. Balance tooling can override any field per game.
 */

export type DepositKind = "ice" | "organic" | "mineral";
export type BodyType = "carbonaceous" | "icy" | "metallic" | "irradiated";
export type BodySize = "small" | "medium" | "large";

export interface Rules {
  /** SPEC §3 */
  turnLimit: number;
  dominanceWinPermille: number;
  dominanceWinConsecutiveTurns: number;

  /** SPEC §4.2 */
  bodyRadius: Record<BodySize, number>;
  rockPermille: number;
  rockClusterMin: number;
  rockClusterMax: number;
  depositPermille: number;
  depositYield: Record<DepositKind, number>;
  /** Weights for random deposit kinds per body type (SPEC §4.3). */
  depositMix: Record<BodyType, Record<DepositKind, number>>;
  /** Home bodies guarantee one Organic and one Ice within this distance of the start core. */
  homeGuaranteedDepositRange: number;

  /** SPEC §4.4 */
  startCoreBiomass: number;
  startAdjacentCells: number;
  startAdjacentBiomass: number;
  startNutrients: number;

  /** SPEC §5.1 */
  maxOrdersPerSet: number;
  growReach: number;
  reinforceCost: number;
  reinforceAmount: number;
  retractRefund: number;

  /** SPEC §5.2 */
  baseEntryCost: number;
  mineralEntryExtra: number;
  metallicEntryExtra: number;
  minEntryCost: number;

  /** SPEC §5.4 */
  defenseSupport: number;
  newCellBiomass: number;

  /** SPEC §5.5 */
  maxBiomass: number;
  coreMaxBiomass: number;

  /** SPEC §5.3 phase 9 and 10 */
  starvationLoss: number;
  incomePerCore: number;
}

export const BASE_RULES: Rules = {
  turnLimit: 40,
  dominanceWinPermille: 600,
  dominanceWinConsecutiveTurns: 2,

  bodyRadius: { small: 5, medium: 7, large: 9 },
  rockPermille: 80,
  rockClusterMin: 2,
  rockClusterMax: 4,
  depositPermille: 60,
  depositYield: { ice: 2, organic: 3, mineral: 1 },
  depositMix: {
    carbonaceous: { organic: 6, ice: 2, mineral: 2 },
    icy: { organic: 2, ice: 6, mineral: 2 },
    metallic: { organic: 2, ice: 2, mineral: 6 },
    irradiated: { organic: 4, ice: 3, mineral: 3 },
  },
  homeGuaranteedDepositRange: 3,

  startCoreBiomass: 5,
  startAdjacentCells: 2,
  startAdjacentBiomass: 2,
  startNutrients: 10,

  maxOrdersPerSet: 12,
  growReach: 3,
  reinforceCost: 3,
  reinforceAmount: 3,
  retractRefund: 1,

  baseEntryCost: 2,
  mineralEntryExtra: 1,
  metallicEntryExtra: 1,
  minEntryCost: 1,

  defenseSupport: 1,
  newCellBiomass: 1,

  maxBiomass: 9,
  coreMaxBiomass: 12,

  starvationLoss: 1,
  incomePerCore: 2,
};

/** Shallow-merges overrides onto BASE_RULES (nested records are replaced, not merged). */
export function resolveRules(overrides: Partial<Rules> = {}): Rules {
  return { ...BASE_RULES, ...overrides };
}
