import {
  attackOn,
  defenseOf,
  getBoard,
  maxBiomassFor,
  playerRules,
  type Body,
  type Board,
  type Colony,
  type GameState,
  type PlayerId,
} from "@swarm/sim";
import type { BotWeights } from "./weights";

/**
 * Per-body facts the candidate generator scores against. Everything here is computed from the
 * start-of-turn board, the same board the sim validates orders against.
 */
export interface BodyAnalysis {
  body: Body;
  board: Board;
  /** Value of the deposit on each cell, to whoever holds it (yield × income horizon). */
  depositValue: number[];
  /** Pull toward deposits we do not own yet, decayed by distance. */
  potential: number[];
  /** For each own cell: how many other own cells would be disconnected if it fell. */
  myCut: number[];
  /** For each enemy cell: how many of its owner's cells would be disconnected if it fell. */
  enemyCut: number[];
  /** Defense of each own cell as the sim computes it. */
  defense: number[];
  /** Strongest step-1 attack an enemy could make on each cell right now (0 if none). */
  threat: number[];
  /** The same, if the enemy also reinforced the feeder first. */
  threatReinforced: number[];
}

export interface Analysis {
  state: GameState;
  me: PlayerId;
  weights: BotWeights;
  horizon: number;
  bodies: BodyAnalysis[];
  /** Number of cores per player. */
  cores: Map<PlayerId, number>;
}

/**
 * Analyses are cached per state object, player and the two weights they depend on (income
 * horizon and potential decay): Hard plans several times against the same state.
 */
const cache = new WeakMap<GameState, Map<string, Analysis>>();

export function analyse(state: GameState, me: PlayerId, weights: BotWeights): Analysis {
  const key = `${me}|${weights.incomeHorizon}|${weights.potentialDecay}`;
  let byKey = cache.get(state);
  if (!byKey) {
    byKey = new Map();
    cache.set(state, byKey);
  }
  const hit = byKey.get(key);
  if (hit) return hit.weights === weights ? hit : { ...hit, weights };
  const fresh = analyseUncached(state, me, weights);
  byKey.set(key, fresh);
  return fresh;
}

function analyseUncached(state: GameState, me: PlayerId, weights: BotWeights): Analysis {
  const horizon = Math.max(
    1,
    Math.min(weights.incomeHorizon, state.rules.turnLimit - state.turn + 1),
  );
  const cores = new Map<PlayerId, number>();
  for (const p of state.players) cores.set(p.id, 0);
  for (const b of state.bodies)
    for (const c of b.colony) if (c?.core) cores.set(c.owner, (cores.get(c.owner) ?? 0) + 1);
  return {
    state,
    me,
    weights,
    horizon,
    cores,
    bodies: state.bodies.map((body) => analyseBody(state, me, weights, horizon, body)),
  };
}

function analyseBody(
  state: GameState,
  me: PlayerId,
  w: BotWeights,
  horizon: number,
  body: Body,
): BodyAnalysis {
  const board = getBoard(body.radius);
  const n = board.cells.length;
  const { colony } = body;
  const { rules } = state;

  // What each cell would pay this player: their own yields (strain, mutations), comets while
  // they last.
  const yields = playerRules(state, me).depositYield;
  const depositValue = body.deposits.map((d, i) => {
    let v = d ? yields[d] * horizon : 0;
    for (const c of body.comets)
      if (c.cell === i) v += c.yield * Math.max(0, Math.min(horizon, c.until - state.turn));
    return v;
  });

  // Potential: max over deposits not ours of value × decay^distance (distance through non-rock).
  const decay: number[] = [1];
  for (let d = 1; d <= 2 * body.radius + 2; d++)
    decay.push((decay[d - 1] as number) * w.potentialDecay);
  // Deposits of equal worth share one multi-source BFS: the max over them only needs the
  // nearest one, so this equals one BFS per deposit at a fraction of the cost.
  const potential = new Array<number>(n).fill(0);
  const byWorth = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const v = depositValue[i] as number;
    if (v === 0 || body.terrain[i] === "rock") continue;
    const owner = colony[i]?.owner;
    if (owner === me) continue;
    const worth = owner === undefined ? v : v / 2;
    byWorth.set(worth, [...(byWorth.get(worth) ?? []), i]);
  }
  for (const [worth, sources] of [...byWorth].sort((a, b) => b[0] - a[0])) {
    const dist = bfsDistances(board, body, sources);
    for (let j = 0; j < n; j++) {
      const d = dist[j] as number;
      if (d < 0) continue;
      const p = worth * (decay[d] ?? 0);
      if (p > (potential[j] as number)) potential[j] = p;
    }
  }

  const owners = new Set<PlayerId>();
  for (const c of colony) if (c) owners.add(c.owner);
  const myCut = new Array<number>(n).fill(0);
  const enemyCut = new Array<number>(n).fill(0);
  for (const owner of [...owners].sort((a, b) => a - b)) {
    const target = owner === me ? myCut : enemyCut;
    const cells: number[] = [];
    for (let i = 0; i < n; i++)
      if (colony[i]?.owner === owner && colony[i]?.connected) cells.push(i);
    for (const i of cells) {
      if ((colony[i] as Colony).core) continue;
      target[i] = cells.length - 1 - reachableFromCores(board, colony, owner, i);
    }
  }

  const defense = new Array<number>(n).fill(0);
  const flags = colony.map((c) => !!c?.connected);
  const threat = new Array<number>(n).fill(0);
  const threatReinforced = new Array<number>(n).fill(0);
  const nutrients = new Map(state.players.map((p) => [p.id, p.nutrients]));
  for (let i = 0; i < n; i++) {
    const c = colony[i];
    if (!c || c.owner !== me) continue;
    defense[i] = defenseOf(state, body, colony, flags, i);
    for (const nb of board.neighbours[i] as readonly number[]) {
      const e = colony[nb];
      if (!e || e.owner === me || !e.connected) continue;
      // Exactly the sim's pressure, assault bonus and mutations included.
      const attack = attackOn(state, body, colony, e.owner, nb, i);
      const canReinforce =
        (nutrients.get(e.owner) ?? 0) >= rules.reinforceCost + rules.minEntryCost;
      const boost = canReinforce
        ? Math.min(
            playerRules(state, e.owner).reinforceAmount,
            maxBiomassFor(state, e, body) - e.biomass,
          )
        : 0;
      if (attack > (threat[i] as number)) threat[i] = attack;
      if (attack + boost > (threatReinforced[i] as number)) threatReinforced[i] = attack + boost;
    }
  }

  return {
    body,
    board,
    depositValue,
    potential,
    myCut,
    enemyCut,
    defense,
    threat,
    threatReinforced,
  };
}

function bfsDistances(board: Board, body: Body, from: readonly number[]): number[] {
  const dist = new Array<number>(board.cells.length).fill(-1);
  for (const f of from) dist[f] = 0;
  const queue = [...from];
  for (let h = 0; h < queue.length; h++) {
    const i = queue[h] as number;
    for (const nb of board.neighbours[i] as readonly number[]) {
      if (dist[nb] !== -1 || body.terrain[nb] === "rock") continue;
      dist[nb] = (dist[i] as number) + 1;
      queue.push(nb);
    }
  }
  return dist;
}

/** Number of `owner`'s cells reachable from their cores if cell `removed` is gone (excluding it). */
function reachableFromCores(
  board: Board,
  colony: readonly (Colony | null)[],
  owner: PlayerId,
  removed: number,
): number {
  const seen = new Uint8Array(colony.length);
  const queue: number[] = [];
  for (let i = 0; i < colony.length; i++) {
    const c = colony[i];
    if (c && c.core && c.owner === owner && i !== removed) {
      seen[i] = 1;
      queue.push(i);
    }
  }
  for (let h = 0; h < queue.length; h++) {
    for (const nb of board.neighbours[queue[h] as number] as readonly number[]) {
      if (seen[nb] || nb === removed || colony[nb]?.owner !== owner) continue;
      seen[nb] = 1;
      queue.push(nb);
    }
  }
  return queue.length;
}
