import { getBoard, type Hex } from "./hex";
import type { StrainId } from "./config";
import { idiv } from "./math";
import type { Body, Colony, GameState, PlayerId } from "./types";

/** Shared rule helpers used by validation, resolution, the bot and the UI. */

/** The numbers that differ per player because of their strain (SPEC §7.1). */
export interface PlayerRules {
  strain: StrainId;
  growReach: number;
  entryCostDelta: number;
  maxBiomass: number;
  coreMaxBiomass: number;
  defenseSupport: number;
  reinforceAmount: number;
}

export function strainOf(state: GameState, player: PlayerId): StrainId {
  return state.players.find((p) => p.id === player)?.strain ?? "base";
}

export function playerRules(state: GameState, player: PlayerId): PlayerRules {
  const { rules } = state;
  const strain = strainOf(state, player);
  const m = rules.strains[strain] ?? {};
  const maxBiomass = m.maxBiomass ?? rules.maxBiomass;
  return {
    strain,
    growReach: m.growReach ?? rules.growReach,
    entryCostDelta: m.entryCostDelta ?? 0,
    maxBiomass,
    // Cores keep their margin over normal cells (12 vs 9 in the base rules).
    coreMaxBiomass: rules.coreMaxBiomass + (maxBiomass - rules.maxBiomass),
    defenseSupport: m.defenseSupport ?? rules.defenseSupport,
    reinforceAmount: m.reinforceAmount ?? rules.reinforceAmount,
  };
}

/** Max biomass of a colony cell, by its owner's strain (SPEC §5.5). */
export function maxBiomassFor(state: GameState, colony: Pick<Colony, "core" | "owner">): number {
  const r = playerRules(state, colony.owner);
  return colony.core ? r.coreMaxBiomass : r.maxBiomass;
}

/** Entry cost of one new cell for `player` (SPEC §5.2). */
export function entryCost(
  state: GameState,
  body: Body,
  cellIndex: number,
  player: PlayerId,
): number {
  const { rules } = state;
  let cost = rules.baseEntryCost + playerRules(state, player).entryCostDelta;
  if (body.deposits[cellIndex] === "mineral") cost += rules.mineralEntryExtra;
  if (body.type === "metallic") cost += rules.metallicEntryExtra;
  return cost < rules.minEntryCost ? rules.minEntryCost : cost;
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
