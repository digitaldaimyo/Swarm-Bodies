import { getBoard, type Hex } from "./hex";
import { idiv } from "./math";
import type { Body, Colony, GameState, PlayerId } from "./types";

/** Shared rule helpers used by validation, resolution and the UI. */

export function maxBiomassFor(state: GameState, colony: Pick<Colony, "core">): number {
  return colony.core ? state.rules.coreMaxBiomass : state.rules.maxBiomass;
}

/** Entry cost of one new cell (SPEC §5.2). */
export function entryCost(state: GameState, body: Body, cellIndex: number): number {
  const { rules } = state;
  let cost = rules.baseEntryCost;
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
