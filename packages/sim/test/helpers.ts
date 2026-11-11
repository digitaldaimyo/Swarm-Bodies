import {
  createGame,
  getBoard,
  refreshConnectivityForTests,
  type DepositKind,
  type GameState,
  type Hex,
  type Order,
  type Rules,
} from "./sim";

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
  const body = base.bodies[0]!;
  const board = getBoard(body.radius);
  const n = board.cells.length;
  const terrain = new Array(n).fill("regolith") as GameState["bodies"][number]["terrain"];
  const deposits = new Array<DepositKind | null>(n).fill(null);
  const colony = new Array<GameState["bodies"][number]["colony"][number]>(n).fill(null);
  for (const h of spec.rock ?? []) terrain[at(board, h)] = "rock";
  for (const d of spec.deposits ?? []) deposits[at(board, d)] = d.kind;
  for (const c of spec.cells) {
    colony[at(board, c)] = {
      owner: c.owner,
      biomass: c.biomass,
      core: c.core ?? false,
      connected: false,
    };
  }
  const state: GameState = {
    ...base,
    turn: spec.turn ?? 1,
    bodies: [{ ...body, type: spec.bodyType ?? body.type, terrain, deposits, colony }],
    players: base.players.map((p, i) => ({ ...p, nutrients: spec.nutrients?.[i] ?? 50 })),
  };
  refreshConnectivityForTests(state.bodies[0]!);
  return state;
}

function at(board: ReturnType<typeof getBoard>, h: Hex): number {
  const i = board.indexOf(h.q, h.r);
  if (i < 0) throw new Error(`off board: ${h.q},${h.r}`);
  return i;
}

export function cellAt(state: GameState, q: number, r: number) {
  const body = state.bodies[0]!;
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

/** Recursively freezes a value so tests can prove functions never mutate their input. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
