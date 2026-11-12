import { getBoard, type Hex } from "./hex";
import type { DepositKind, MutationId, Rules, StrainId } from "./config";
import { idiv } from "./math";
import { hookSum, mutationsOf } from "./mutations";
import type { Body, Colony, GameState, PlayerId } from "./types";

/** Shared rule helpers used by validation, resolution, the bot and the UI. */

/** The numbers that differ per player because of their strain and mutations (SPEC §7). */
export interface PlayerRules {
  strain: StrainId;
  mutations: readonly MutationId[];
  growReach: number;
  entryCostDelta: number;
  mineralEntryExtra: number;
  maxBiomass: number;
  coreMaxBiomass: number;
  defenseSupport: number;
  reinforceAmount: number;
  launchRange: number;
  /** Added to attack when entering an enemy cell. */
  assaultBonus: number;
  /** Gain N equal to the defender's lost biomass on a capture. */
  captureFeeds: boolean;
  depositYield: Record<DepositKind, number>;
  incomePerCore: number;
  /** Bank interest on income (Deep Reserves): per-mille of banked N, capped. */
  interestPermille: number;
  interestCap: number;
  fruitCost: number;
  fruitMatureTurns: number;
  maxFruiting: number;
  landingBiomass: number;
  flareImmune: boolean;
  irradiationImmune: boolean;
  /** Disconnected turns a cell survives without starving (Dormancy). */
  dormancyTurns: number;
  regeneration: { below: number; amount: number } | null;
}

export function strainOf(state: GameState, player: PlayerId): StrainId {
  return state.players.find((p) => p.id === player)?.strain ?? "base";
}

/**
 * Resolved rules are cached per player by their mutations array: the sim only ever replaces
 * that array (never mutates it), and a player's strain never changes. The rules object and
 * strain are checked too, so a cached value is only reused for exactly the same inputs. Results
 * are frozen, so a caller can never change a shared copy. (M8 performance pass: the bot asks
 * for these thousands of times per turn.)
 */
const rulesCache = new WeakMap<
  readonly MutationId[],
  { rules: Rules; strain: StrainId; value: PlayerRules }
>();

export function playerRules(state: GameState, player: PlayerId): PlayerRules {
  const ps = state.players.find((p) => p.id === player);
  const cached = ps ? rulesCache.get(ps.mutations) : undefined;
  if (cached && cached.rules === state.rules && cached.strain === ps?.strain) return cached.value;
  const value = Object.freeze(computePlayerRules(state, player));
  if (ps) rulesCache.set(ps.mutations, { rules: state.rules, strain: ps.strain, value });
  return value;
}

function computePlayerRules(state: GameState, player: PlayerId): PlayerRules {
  const { rules } = state;
  const strain = strainOf(state, player);
  const m = rules.strains[strain] ?? {};
  const maxBiomass = m.maxBiomass ?? rules.maxBiomass;
  const yieldDelta = m.depositYieldDelta ?? 0;
  const yieldOf = (k: DepositKind) =>
    Math.max(rules.minDepositYield, rules.depositYield[k] + yieldDelta);
  const r: PlayerRules = {
    strain,
    mutations: state.players.find((p) => p.id === player)?.mutations ?? [],
    growReach: m.growReach ?? rules.growReach,
    entryCostDelta: m.entryCostDelta ?? 0,
    mineralEntryExtra: rules.mineralEntryExtra,
    maxBiomass,
    // Cores keep their margin over normal cells (12 vs 9 in the base rules).
    coreMaxBiomass: rules.coreMaxBiomass + (maxBiomass - rules.maxBiomass),
    defenseSupport: m.defenseSupport ?? rules.defenseSupport,
    reinforceAmount: m.reinforceAmount ?? rules.reinforceAmount,
    launchRange: rules.launchRange + (m.launchRangeBonus ?? 0),
    assaultBonus: m.assaultBonus ?? 0,
    captureFeeds: m.captureFeeds ?? false,
    depositYield: { ice: yieldOf("ice"), organic: yieldOf("organic"), mineral: yieldOf("mineral") },
    incomePerCore: rules.incomePerCore,
    interestPermille: 0,
    interestCap: 0,
    fruitCost: m.fruitCost ?? rules.fruitCost,
    fruitMatureTurns: m.fruitMatureTurns ?? rules.fruitMatureTurns,
    maxFruiting: m.maxFruiting ?? rules.maxFruiting,
    landingBiomass: m.landingBiomass ?? rules.landingBiomass,
    flareImmune: false,
    irradiationImmune: false,
    dormancyTurns: 0,
    regeneration: null,
  };
  // Mutations apply after the strain, in mutation-ID order (SPEC §7.3).
  for (const def of mutationsOf(state, player)) def.adjust?.(r, rules.mutations);
  return r;
}

/**
 * Max biomass of a colony cell: the owner's strain (SPEC §5.5, §7.1) plus the body's type
 * (Metallic: +2, SPEC §4.3).
 */
export function maxBiomassFor(
  state: GameState,
  colony: Pick<Colony, "core" | "owner">,
  body: Pick<Body, "type">,
): number {
  const r = playerRules(state, colony.owner);
  const bonus = body.type === "metallic" ? state.rules.metallicMaxBiomassBonus : 0;
  return (colony.core ? r.coreMaxBiomass : r.maxBiomass) + bonus;
}

/** Entry cost of one new cell for `player` (SPEC §5.2). */
export function entryCost(
  state: GameState,
  body: Body,
  cellIndex: number,
  player: PlayerId,
): number {
  const { rules } = state;
  const r = playerRules(state, player);
  let cost = rules.baseEntryCost + r.entryCostDelta;
  if (body.deposits[cellIndex] === "mineral") cost += r.mineralEntryExtra;
  if (body.type === "metallic") cost += rules.metallicEntryExtra;
  cost += hookSum(
    state,
    { state, body, colony: body.colony, player, cell: cellIndex },
    "entryCost",
  );
  return cost < rules.minEntryCost ? rules.minEntryCost : cost;
}

/** Grow reach for a path that ends on `lastCell` (Chemotaxis: +1 onto a deposit, SPEC §7.3). */
export function reachFor(state: GameState, body: Body, lastCell: number, player: PlayerId): number {
  return (
    playerRules(state, player).growReach +
    hookSum(state, { state, body, colony: body.colony, player, cell: lastCell }, "reach")
  );
}

/**
 * Attack pressure of `player` entering `target` from `feeder` (SPEC §5.4): the feeder's biomass,
 * +1 per other own cell adjacent to the target, the assault bonus when the target is enemy-held,
 * and mutation hooks. `colony` is the board the contest is judged on.
 */
export function attackOn(
  state: GameState,
  body: Body,
  colony: readonly (Colony | null)[],
  player: PlayerId,
  feeder: number,
  target: number,
): number {
  let attack = (colony[feeder] as Colony).biomass;
  for (const n of getBoard(body.radius).neighbours[target] as readonly number[]) {
    if (n !== feeder && colony[n]?.owner === player) attack++;
  }
  const defender = colony[target];
  if (defender && defender.owner !== player) attack += playerRules(state, player).assaultBonus;
  return attack + hookSum(state, { state, body, colony, player, cell: feeder }, "attack");
}

/**
 * Defense of the cell's owner (SPEC §5.4): its biomass, plus support per other connected own
 * cell adjacent to it, plus mutation hooks. `connected` gives the connectivity of `colony`.
 */
export function defenseOf(
  state: GameState,
  body: Body,
  colony: readonly (Colony | null)[],
  connected: readonly boolean[],
  cell: number,
): number {
  const c = colony[cell] as Colony;
  const support = playerRules(state, c.owner).defenseSupport;
  let defense = c.biomass;
  for (const n of getBoard(body.radius).neighbours[cell] as readonly number[]) {
    if (colony[n]?.owner === c.owner && connected[n]) defense += support;
  }
  return defense + hookSum(state, { state, body, colony, player: c.owner, cell }, "defense");
}

/** What a connected cell pays its owner each turn: deposit yield (per the owner) plus comets. */
export function cellYield(state: GameState, body: Body, cell: number, owner: PlayerId): number {
  const d = body.deposits[cell];
  let n = d ? playerRules(state, owner).depositYield[d] : 0;
  for (const comet of body.comets) if (comet.cell === cell) n += comet.yield;
  return n;
}

/**
 * Phase 10 income (SPEC §5.3): per connected core and connected deposit, plus bank interest
 * (Deep Reserves) on what the player holds now.
 */
export function incomeFor(state: GameState, player: PlayerId): number {
  const r = playerRules(state, player);
  let n = 0;
  for (const body of state.bodies) {
    for (let i = 0; i < body.colony.length; i++) {
      const c = body.colony[i];
      if (!c || c.owner !== player || !c.connected) continue;
      if (c.core) n += r.incomePerCore;
      n += cellYield(state, body, i, player);
    }
  }
  if (r.interestPermille > 0) {
    const banked = state.players.find((p) => p.id === player)?.nutrients ?? 0;
    n += Math.min(r.interestCap, idiv(Math.max(0, banked) * r.interestPermille, 1000));
  }
  return n;
}

export function cellIndexOf(body: Body, h: Hex): number {
  return getBoard(body.radius).indexOf(h.q, h.r);
}

export function ownedBy(body: Body, cellIndex: number, player: PlayerId): Colony | null {
  const c = body.colony[cellIndex];
  return c && c.owner === player ? c : null;
}

/** Non-rock cells across the system: the dominance denominator (SPEC §2). */
export function playableCellCount(state: GameState): number {
  let n = 0;
  for (const b of state.bodies) for (const t of b.terrain) if (t !== "rock") n++;
  return n;
}

export interface PlayerTotals {
  cells: number;
  biomass: number;
  cores: number;
}

export function playerTotals(state: GameState): Map<PlayerId, PlayerTotals> {
  const totals = new Map<PlayerId, PlayerTotals>();
  for (const p of state.players) totals.set(p.id, { cells: 0, biomass: 0, cores: 0 });
  for (const b of state.bodies) {
    for (const c of b.colony) {
      if (!c) continue;
      const t = totals.get(c.owner);
      if (!t) continue;
      t.cells++;
      t.biomass += c.biomass;
      if (c.core) t.cores++;
    }
  }
  return totals;
}

/** Dominance in per-mille, floored (display helper; win checks use exact cross-multiplication). */
export function dominancePermille(state: GameState, player: PlayerId): number {
  const total = playableCellCount(state);
  const cells = playerTotals(state).get(player)?.cells ?? 0;
  return total === 0 ? 0 : idiv(cells * 1000, total);
}
