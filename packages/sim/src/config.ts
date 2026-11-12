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
/** Strains (SPEC §7.1). "base" is the unmodified ruleset, used by tests and golden replays. */
export type StrainId = "base" | "swarmer" | "biofilm" | "predator" | "sporer";
export const STRAIN_IDS: readonly StrainId[] = ["base", "swarmer", "biofilm", "predator", "sporer"];
/** Strains a player can pick. */
export const PLAYABLE_STRAINS: readonly Exclude<StrainId, "base">[] = [
  "swarmer",
  "biofilm",
  "predator",
  "sporer",
];

/** The launch mutation pool (SPEC §7.3), in canonical (sorted) order. */
export type MutationId =
  | "acid_tendrils"
  | "chemotaxis"
  | "cryophile"
  | "deep_reserves"
  | "dormancy"
  | "hardened_spores"
  | "lithotroph"
  | "quorum"
  | "rad_shield"
  | "rapid_fruiting"
  | "regeneration"
  | "thick_veins";
export const MUTATION_IDS: readonly MutationId[] = [
  "acid_tendrils",
  "chemotaxis",
  "cryophile",
  "deep_reserves",
  "dormancy",
  "hardened_spores",
  "lithotroph",
  "quorum",
  "rad_shield",
  "rapid_fruiting",
  "regeneration",
  "thick_veins",
];

/** A strain's changes to the base rules. Absent fields keep the base value. */
export interface StrainModifiers {
  growReach?: number;
  /** Added to every cell's entry cost (the minimum still applies). */
  entryCostDelta?: number;
  /** Max biomass of normal cells. Cores keep the same margin above it as in the base rules. */
  maxBiomass?: number;
  defenseSupport?: number;
  reinforceAmount?: number;
  /** Added to the launch range (Sporer: +2). */
  launchRangeBonus?: number;
  /** Added to attack on assaults, i.e. entering an enemy cell (Predator: +1). */
  assaultBonus?: number;
  /** Gain N equal to the defender's lost biomass on every capture (Predator). */
  captureFeeds?: boolean;
  /** Added to every deposit yield; yields stay at least `minDepositYield` (Predator: −1). */
  depositYieldDelta?: number;
  /** SPEC §7.1 Sporer. */
  fruitCost?: number;
  fruitMatureTurns?: number;
  maxFruiting?: number;
  landingBiomass?: number;
}

/** SPEC §7.3: every mutation's numbers. Effects are in `mutations.ts`. */
export interface MutationNumbers {
  acidAttack: number;
  /** Disconnected turns a Dormant cell survives without starving. */
  dormancyTurns: number;
  thickVeinsDefense: number;
  chemotaxisCostDelta: number;
  chemotaxisReach: number;
  cryophileIceBonus: number;
  lithotrophMineralBonus: number;
  hardenedLandingBonus: number;
  rapidFruitingTurns: number;
  /** Quorum: a cell with at least this many adjacent own cells gets the bonuses. */
  quorumNeighbours: number;
  quorumAttack: number;
  quorumDefense: number;
  /** Regeneration: every `regenerationEvery` turns, connected cells below this biomass gain
   * `regenerationAmount`. */
  regenerationEvery: number;
  regenerationBelow: number;
  regenerationAmount: number;
  deepReservesPerCore: number;
  deepReservesInterestPermille: number;
  deepReservesInterestCap: number;
}

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

  /** SPEC §7.1 */
  strains: Record<StrainId, StrainModifiers>;

  /** SPEC §4.1: bodies = playerCount + extra, clamped. */
  systemExtraBodies: number;
  systemMinBodies: number;
  systemMaxBodies: number;
  /** Bodies beyond the homes that a system always has (0: every body is a home, tutorials). */
  systemMinNeutrals: number;
  /** Types neutral bodies are drawn from, uniformly (campaign and sector modifiers). */
  neutralBodyTypes: BodyType[];
  /** SPEC §4.5 orbits, in distance units and turns. */
  orbitRadiusMin: number;
  orbitRadiusMax: number;
  orbitPeriodMin: number;
  orbitPeriodMax: number;
  launchRange: number;
  sporeSpeed: number;
  /** System generation draws up to this many orbit layouts looking for reachable homes. */
  orbitAttempts: number;
  /** Every home must have a window to a neutral body by this turn ... */
  homeFirstWindowMax: number;
  /** ... and on at least this many of the first `windowHorizon` turns. */
  homeWindowTurnsMin: number;
  windowHorizon: number;
  /** SPEC §6 */
  landingBiomass: number;
  /** SPEC §5.1 Fruit */
  fruitCost: number;
  fruitMinBiomass: number;
  fruitMatureTurns: number;
  maxFruiting: number;
  /** SPEC §4.3 body types */
  metallicMaxBiomassBonus: number;
  irradiatedDepositBonusPermille: number;
  /** SPEC §8 events: an inclusive range of turns between occurrences. */
  flareEveryMin: number;
  flareEveryMax: number;
  flareLoss: number;
  /** Flares never take a non-core cell below this biomass (0: cells hit at 0 are removed). */
  flareMinBiomass: number;
  cometEveryMin: number;
  cometEveryMax: number;
  cometYield: number;
  cometDuration: number;
  cometWarning: number;
  /** SPEC §6: deposit yields never drop below this (Predator). */
  minDepositYield: number;
  /** SPEC §7.2 drafts: total-biomass thresholds, options per offer, and the pool offered. */
  draftThresholds: number[];
  draftOptions: number;
  mutationPool: MutationId[];
  mutations: MutationNumbers;
}

export const BASE_RULES: Rules = {
  turnLimit: 40,
  // M6 balance (SPEC §12.4, DECISIONS): 60% was rarely reached once two colonies split a system.
  dominanceWinPermille: 500,
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
  startNutrients: 20,

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

  strains: {
    base: {},
    // Numbers from M6 balance runs, see DECISIONS (SPEC §7.1 lists the launch values).
    // Fast, thin, everywhere.
    swarmer: { growReach: 4, maxBiomass: 7 },
    // Slow, dense, immovable.
    biofilm: { growReach: 2, maxBiomass: 12, defenseSupport: 1, reinforceAmount: 4, fruitCost: 14 },
    // Eats the enemy.
    predator: { assaultBonus: 1, captureFeeds: true, depositYieldDelta: -1, growReach: 4 },
    // Spreads across the system.
    sporer: {
      fruitCost: 7,
      fruitMatureTurns: 1,
      maxFruiting: 3,
      launchRangeBonus: 2,
      landingBiomass: 2,
    },
  },

  // One neutral body per player fewer than the spec's +2: two players then share the contested
  // neutral instead of each taking their own (DECISIONS).
  systemExtraBodies: 1,
  systemMinBodies: 3,
  systemMinNeutrals: 1,
  neutralBodyTypes: ["carbonaceous", "icy", "metallic", "irradiated"],
  systemMaxBodies: 7,
  orbitRadiusMin: 3,
  orbitRadiusMax: 12,
  orbitPeriodMin: 8,
  orbitPeriodMax: 24,
  launchRange: 6,
  sporeSpeed: 3,
  orbitAttempts: 32,
  homeFirstWindowMax: 4,
  homeWindowTurnsMin: 8,
  windowHorizon: 20,
  landingBiomass: 3,
  fruitCost: 10,
  fruitMinBiomass: 5,
  fruitMatureTurns: 2,
  maxFruiting: 2,
  metallicMaxBiomassBonus: 2,
  irradiatedDepositBonusPermille: 500,
  flareEveryMin: 7,
  flareEveryMax: 10,
  flareLoss: 1,
  flareMinBiomass: 1,
  cometEveryMin: 10,
  cometEveryMax: 14,
  cometYield: 5,
  cometDuration: 6,
  cometWarning: 2,
  minDepositYield: 1,
  draftThresholds: [40, 90, 160],
  draftOptions: 3,
  mutationPool: [...MUTATION_IDS],
  mutations: {
    acidAttack: 1,
    dormancyTurns: 5,
    thickVeinsDefense: 2,
    chemotaxisCostDelta: -1,
    chemotaxisReach: 1,
    cryophileIceBonus: 2,
    lithotrophMineralBonus: 2,
    hardenedLandingBonus: 2,
    rapidFruitingTurns: 1,
    quorumNeighbours: 3,
    quorumAttack: 1,
    quorumDefense: 1,
    regenerationEvery: 3,
    regenerationBelow: 2,
    regenerationAmount: 1,
    deepReservesPerCore: 1,
    deepReservesInterestPermille: 100,
    deepReservesInterestCap: 3,
  },
};

/** Shallow-merges overrides onto BASE_RULES (nested records are replaced, not merged). */
export function resolveRules(overrides: Partial<Rules> = {}): Rules {
  return { ...BASE_RULES, ...overrides };
}
