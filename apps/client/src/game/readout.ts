import {
  defenseOf,
  getBoard,
  playerRules,
  validateOrder,
  type Body,
  type Colony,
  type GameState,
  type Hex,
  type Order,
  type PlayerId,
} from "@swarm/sim";
import type { Vascular } from "./vascular";

/**
 * Cell readouts (colony life, phase 4). Client presentation only: every number comes from the
 * sim's own rules, so a readout always agrees with what resolution will do.
 */

/**
 * A cell's defense, split: its own biomass, support from connected own neighbours, and any
 * bonus from mutations. `total` is the sim's own figure.
 */
export interface DefenseParts {
  biomass: number;
  support: number;
  bonus: number;
  total: number;
}

export function defenseParts(
  state: GameState,
  body: Body,
  colony: readonly (Colony | null)[],
  cell: number,
): DefenseParts {
  const c = colony[cell] as Colony;
  const total = defenseOf(
    state,
    body,
    colony,
    colony.map((x) => !!x?.connected),
    cell,
  );
  let neighbours = 0;
  for (const n of getBoard(body.radius).neighbours[cell] as readonly number[]) {
    if (colony[n]?.owner === c.owner && colony[n]?.connected) neighbours++;
  }
  const support = neighbours * playerRules(state, c.owner).defenseSupport;
  return { biomass: c.biomass, support, bonus: total - c.biomass - support, total };
}

/** The cells from `cell` to the core that feeds it, `cell` first; empty when it is cut off. */
export function supplyPath(v: Vascular, cell: number): number[] {
  if ((v.depth[cell] as number) < 0) return [];
  const path = [cell];
  for (let p = v.parent[cell] as number; p >= 0; p = v.parent[p] as number) path.push(p);
  return path;
}

/**
 * The viewer's cells on `body` that could fruit now, after the orders already queued: the
 * sim's own validator decides (biomass, connection, cost, the fruiting cap).
 */
export function fruitableCells(
  state: GameState,
  body: Body,
  player: PlayerId,
  pending: readonly Order[],
): number[] {
  const board = getBoard(body.radius);
  const out: number[] = [];
  body.colony.forEach((c, i) => {
    if (!c || c.owner !== player || c.core || !c.connected || c.fruiting !== null) return;
    if (c.biomass < state.rules.fruitMinBiomass) return;
    const order: Order = { type: "fruit", body: body.id, cell: board.cells[i] as Hex };
    if (validateOrder(state, player, order, pending).ok) out.push(i);
  });
  return out;
}

/** The readout text for a held cell: its defense and where it comes from. */
export function defenseText(d: DefenseParts, connected: boolean): string {
  const parts = [`${d.biomass} biomass`, `${d.support} support`];
  if (d.bonus) parts.push(`${d.bonus} mutations`);
  const lines = [`Defense ${d.total}`, parts.join(" + ")];
  if (!connected) lines.push("Cut off: no route to a core");
  return lines.join("\n");
}
