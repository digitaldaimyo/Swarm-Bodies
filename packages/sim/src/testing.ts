/**
 * Test fixtures shared by the sim, bot and tool test suites (import from "@swarm/sim/testing").
 * Pure like the rest of the sim, but not part of the game API.
 */
import type { DepositKind, Rules } from "./config";
import { refreshConnectivity } from "./connectivity";
import { createGame } from "./generate";
import { getBoard, type Hex } from "./hex";
import type { GameState, Order } from "./types";

export interface CellSpec {
  q: number;
  r: number;
  owner: number;
  biomass: number;
  core?: boolean;
}

export interface ScenarioSpec {
  cells: CellSpec[];
  rock?: Hex[];
  deposits?: (Hex & { kind: DepositKind })[];
  nutrients?: [number, number];
  rules?: Partial<Rules>;
  bodyType?: GameState["bodies"][number]["type"];
  turn?: number;
}

/**
 * A blank Single Rock body (no rock, no deposits, no colonies) with exactly the given cells.
 * Connectivity flags are recomputed so the state is a valid start-of-turn state.
 */
export function scenario(spec: ScenarioSpec): GameState {
  const base = createGame(
    { mode: "singleRock", playerCount: 2, ...(spec.rules ? { rules: spec.rules } : {}) },
    "scenario",
  );
  const body = base.bodies[0] as GameState["bodies"][number];
  const board = getBoard(body.radius);
  const n = board.cells.length;
  const at = (h: Hex): number => {
    const i = board.indexOf(h.q, h.r);
    if (i < 0) throw new Error(`off board: ${h.q},${h.r}`);
    return i;
  };
  const terrain = new Array(n).fill("regolith") as GameState["bodies"][number]["terrain"];
  const deposits = new Array<DepositKind | null>(n).fill(null);
  const colony = new Array<GameState["bodies"][number]["colony"][number]>(n).fill(null);
  for (const h of spec.rock ?? []) terrain[at(h)] = "rock";
  for (const d of spec.deposits ?? []) deposits[at(d)] = d.kind;
  for (const c of spec.cells) {
    colony[at(c)] = { owner: c.owner, biomass: c.biomass, core: c.core ?? false, connected: false };
  }
  const newBody = { ...body, type: spec.bodyType ?? body.type, terrain, deposits, colony };
  refreshConnectivity(newBody);
  return {
    ...base,
    turn: spec.turn ?? 1,
    bodies: [newBody],
    players: base.players.map((p, i) => ({ ...p, nutrients: spec.nutrients?.[i] ?? 50 })),
  };
}

export function cellAt(state: GameState, q: number, r: number) {
  const body = state.bodies[0] as GameState["bodies"][number];
  return body.colony[getBoard(body.radius).indexOf(q, r)] ?? null;
}

export const grow = (...path: [number, number][]): Order => ({
  type: "grow",
  body: 0,
  path: path.map(([q, r]) => ({ q, r })),
});
export const reinforce = (q: number, r: number): Order => ({
  type: "reinforce",
  body: 0,
  cell: { q, r },
});
export const retract = (q: number, r: number): Order => ({
  type: "retract",
  body: 0,
  cell: { q, r },
});
