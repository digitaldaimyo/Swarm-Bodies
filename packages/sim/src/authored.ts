import { resolveRules, type BodyType, type DepositKind, type Rules, type StrainId } from "./config";
import { refreshConnectivity } from "./connectivity";
import { createGame } from "./generate";
import { getBoard, type Hex } from "./hex";
import type { Body, Colony, GameState, PlayerId, Terrain } from "./types";

/** One colony cell on an authored board. */
export interface AuthoredCell extends Hex {
  owner: PlayerId;
  biomass: number;
  core?: boolean;
}

/**
 * A hand-placed board (Training-grounds lessons, docs/plans/tutorial.md): one body of the given
 * radius with exactly these rocks, deposits and colony cells, for two players.
 */
export interface AuthoredMap {
  radius: number;
  rock?: Hex[];
  deposits?: (Hex & { kind: DepositKind })[];
  cells: AuthoredCell[];
  /** Starting nutrients by seat. */
  nutrients: [number, number];
  bodyType?: BodyType;
  strains?: [StrainId, StrainId];
  rules?: Partial<Rules>;
}

/**
 * Builds a valid start-of-turn state from an authored map: a Single Rock game (no orbits, no
 * scheduled events) whose body is exactly the map. Deterministic: same map, same state.
 * Throws on a cell off the board, a colony cell on rock, or a seat without a core.
 */
export function authoredGame(map: AuthoredMap, seed = "authored"): GameState {
  const rules = resolveRules(map.rules);
  const base = createGame(
    { mode: "singleRock", playerCount: 2, ...(map.rules ? { rules: map.rules } : {}) },
    seed,
  );
  const board = getBoard(map.radius);
  const n = board.cells.length;
  const at = (h: Hex): number => {
    const i = board.indexOf(h.q, h.r);
    if (i < 0) throw new Error(`authored map: ${h.q},${h.r} is off a radius-${map.radius} board`);
    return i;
  };
  const terrain = new Array<Terrain>(n).fill("regolith");
  const deposits = new Array<DepositKind | null>(n).fill(null);
  const colony = new Array<Colony | null>(n).fill(null);
  for (const h of map.rock ?? []) terrain[at(h)] = "rock";
  for (const d of map.deposits ?? []) deposits[at(d)] = d.kind;
  const homes = new Map<PlayerId, Hex>();
  for (const c of map.cells) {
    const i = at(c);
    if (terrain[i] === "rock")
      throw new Error(`authored map: colony cell ${c.q},${c.r} is on rock`);
    colony[i] = {
      owner: c.owner,
      biomass: c.biomass,
      core: c.core ?? false,
      connected: false,
      fruiting: null,
      cut: 0,
    };
    if (c.core && !homes.has(c.owner)) homes.set(c.owner, { q: c.q, r: c.r });
  }
  const body: Body = {
    ...(base.bodies[0] as Body),
    size: "small",
    type: map.bodyType ?? "carbonaceous",
    radius: map.radius,
    terrain,
    deposits,
    colony,
    comets: [],
  };
  refreshConnectivity(body);
  return {
    ...base,
    rules,
    bodies: [body],
    schedule: [],
    players: base.players.map((p, i) => {
      const home = homes.get(p.id);
      if (!home) throw new Error(`authored map: seat ${p.id} has no core`);
      return {
        ...p,
        nutrients: map.nutrients[i] ?? 0,
        strain: map.strains?.[i] ?? "base",
        home: { body: 0, cell: home },
      };
    }),
  };
}
