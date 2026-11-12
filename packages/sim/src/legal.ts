import { getBoard, type Hex } from "./hex";
import { inLaunchRange } from "./orbit";
import { maxBiomassFor, playerRules } from "./rules";
import { fruitingCount } from "./validate";
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
  /** Own connected non-core cells that could fruit now (SPEC §5.1). */
  fruitTargets: CellRef[];
  /** Own mature fruiting bodies, each with the bodies in launch range this turn. */
  launchers: { from: CellRef; targets: number[] }[];
}

export function listLegalOrders(state: GameState, player: PlayerId): LegalOrderIndex {
  const ps = state.players.find((p) => p.id === player);
  const index: LegalOrderIndex = {
    player,
    nutrients: ps?.nutrients ?? 0,
    maxOrders: state.rules.maxOrdersPerSet,
    growReach: playerRules(state, player).growReach,
    growStarts: [],
    reinforceTargets: [],
    retractTargets: [],
    fruitTargets: [],
    launchers: [],
  };
  if (!ps || ps.eliminated || state.result) return index;
  const canFruit =
    state.bodies.filter((b) => b.orbit !== null).length > 1 &&
    fruitingCount(state, player) < playerRules(state, player).maxFruiting &&
    ps.nutrients >= playerRules(state, player).fruitCost;
  for (const body of state.bodies) {
    const board = getBoard(body.radius);
    body.colony.forEach((c, i) => {
      if (!c || c.owner !== player) return;
      const h = board.cells[i] as Hex;
      const ref: CellRef = { body: body.id, q: h.q, r: h.r };
      if (c.connected) {
        index.growStarts.push(ref);
        if (
          c.biomass < maxBiomassFor(state, c, body) &&
          ps.nutrients >= state.rules.reinforceCost
        ) {
          index.reinforceTargets.push(ref);
        }
      }
      if (!c.core) index.retractTargets.push(ref);
      if (
        canFruit &&
        c.connected &&
        !c.core &&
        c.fruiting === null &&
        c.biomass >= state.rules.fruitMinBiomass
      ) {
        index.fruitTargets.push(ref);
      }
      if (c.fruiting === 0) {
        const targets = state.bodies
          .filter((b) => inLaunchRange(state, body, b, state.turn, player))
          .map((b) => b.id);
        index.launchers.push({ from: ref, targets });
      }
    });
  }
  return index;
}
