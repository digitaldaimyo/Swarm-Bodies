/**
 * Test fixtures shared by the sim, bot and tool test suites (import from "@swarm/sim/testing").
 * Pure like the rest of the sim, but not part of the game API.
 */
import type { DepositKind, MutationId, Rules, StrainId } from "./config";
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
  /** Turns until mature (0 = mature). */
  fruiting?: number;
  /** Consecutive disconnected turns so far. */
  cut?: number;
}

export interface ScenarioSpec {
  cells: CellSpec[];
  rock?: Hex[];
  deposits?: (Hex & { kind: DepositKind })[];
  nutrients?: [number, number];
  rules?: Partial<Rules>;
  bodyType?: GameState["bodies"][number]["type"];
  turn?: number;
  strains?: [StrainId, StrainId];
  mutations?: [MutationId[], MutationId[]];
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
    colony[at(c)] = {
      owner: c.owner,
      biomass: c.biomass,
      core: c.core ?? false,
      connected: false,
      fruiting: c.fruiting ?? null,
      cut: c.cut ?? 0,
    };
  }
  const newBody = { ...body, type: spec.bodyType ?? body.type, terrain, deposits, colony };
  refreshConnectivity(newBody);
  return {
    ...base,
    turn: spec.turn ?? 1,
    bodies: [newBody],
    players: base.players.map((p, i) => ({
      ...p,
      nutrients: spec.nutrients?.[i] ?? 50,
      strain: spec.strains?.[i] ?? "base",
      mutations: spec.mutations?.[i] ?? [],
    })),
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

export interface BodySpec {
  /** Orbit radius (units), period (turns) and phase (degrees). Phase fixes the position at turn 0. */
  orbit: { radius: number; period: number; phase: number };
  size?: "small" | "medium" | "large";
  type?: GameState["bodies"][number]["type"];
  cells?: CellSpec[];
  rock?: Hex[];
  deposits?: (Hex & { kind: DepositKind })[];
}

export interface SystemSpec {
  bodies: BodySpec[];
  players?: number;
  nutrients?: number[];
  turn?: number;
  rules?: Partial<Rules>;
  schedule?: GameState["schedule"];
  strains?: StrainId[];
  mutations?: MutationId[][];
}

/**
 * A hand-built star system: blank bodies on the given orbits with exactly the given cells. The
 * default turn is 0, so each body sits at its orbit phase (positions are easy to reason about).
 */
export function systemScenario(spec: SystemSpec): GameState {
  const players = spec.players ?? 2;
  const base = createGame(
    { mode: "system", playerCount: players, ...(spec.rules ? { rules: spec.rules } : {}) },
    "system-scenario",
  );
  const bodies = spec.bodies.map((b, id) => {
    const radius = base.rules.bodyRadius[b.size ?? "small"];
    const board = getBoard(radius);
    const n = board.cells.length;
    const at = (h: Hex): number => {
      const i = board.indexOf(h.q, h.r);
      if (i < 0) throw new Error(`off board ${id}: ${h.q},${h.r}`);
      return i;
    };
    const terrain = new Array(n).fill("regolith") as GameState["bodies"][number]["terrain"];
    const deposits = new Array<DepositKind | null>(n).fill(null);
    const colony = new Array<GameState["bodies"][number]["colony"][number]>(n).fill(null);
    for (const h of b.rock ?? []) terrain[at(h)] = "rock";
    for (const d of b.deposits ?? []) deposits[at(d)] = d.kind;
    for (const c of b.cells ?? []) {
      colony[at(c)] = {
        owner: c.owner,
        biomass: c.biomass,
        core: c.core ?? false,
        connected: false,
        fruiting: c.fruiting ?? null,
        cut: 0,
      };
    }
    const body = {
      id,
      size: b.size ?? "small",
      type: b.type ?? "carbonaceous",
      radius,
      terrain,
      deposits,
      colony,
      orbit: { ...b.orbit },
      home: null,
      comets: [],
    } as GameState["bodies"][number];
    refreshConnectivity(body);
    return body;
  });
  return {
    ...base,
    turn: spec.turn ?? 0,
    bodies,
    schedule: spec.schedule ?? [],
    players: base.players.map((p, i) => ({
      ...p,
      nutrients: spec.nutrients?.[i] ?? 50,
      home: { body: 0, cell: { q: 0, r: 0 } },
      strain: spec.strains?.[i] ?? "base",
      mutations: spec.mutations?.[i] ?? [],
    })),
  };
}
