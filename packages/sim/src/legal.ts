import { getBoard, type Hex } from "./hex";
import { maxBiomassFor } from "./rules";
import type { CellRef, GameState, PlayerId } from "./types";

/** Fast lookup of which cells each order type can use this turn (SPEC §9.2), for UI and bots. */
export interface LegalOrderIndex {
  player: PlayerId;
  nutrients: number;
  maxOrders: number;
  growReach: number;
  /** Own connected cells: legal Grow starts. */
  growStarts: CellRef[];
  /** Own connected cells below max biomass, affordable this turn. */
  reinforceTargets: CellRef[];
  /** Own non-core cells. */
  retractTargets: CellRef[];
}

export function listLegalOrders(state: GameState, player: PlayerId): LegalOrderIndex {
  const ps = state.players.find((p) => p.id === player);
  const index: LegalOrderIndex = {
    player,
    nutrients: ps?.nutrients ?? 0,
    maxOrders: state.rules.maxOrdersPerSet,
    growReach: state.rules.growReach,
    growStarts: [],
    reinforceTargets: [],
    retractTargets: [],
  };
  if (!ps || ps.eliminated || state.result) return index;
  for (const body of state.bodies) {
    const board = getBoard(body.radius);
    body.colony.forEach((c, i) => {
      if (!c || c.owner !== player) return;
      const h = board.cells[i] as Hex;
      const ref: CellRef = { body: body.id, q: h.q, r: h.r };
      if (c.connected) {
        index.growStarts.push(ref);
        if (c.biomass < maxBiomassFor(state, c) && ps.nutrients >= state.rules.reinforceCost) {
          index.reinforceTargets.push(ref);
        }
      }
      if (!c.core) index.retractTargets.push(ref);
    });
  }
  return index;
}
