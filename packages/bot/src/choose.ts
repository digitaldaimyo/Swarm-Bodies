import {
  filterOrderSet,
  rngStream,
  validateOrder,
  validateOrderSet,
  type GameState,
  type Order,
  type OrderSet,
  type PlayerId,
  type Rng,
} from "@swarm/sim";
import { analyse } from "./analysis";
import { generateCandidates, type Candidate } from "./candidates";
import { pickMutation, withPick } from "./drafts";
import { hardPlan } from "./hard";
import { NORMAL_WEIGHTS, PERSONALITIES, type BotWeights, type Personality } from "./weights";

export type Difficulty = "easy" | "normal" | "hard";

export interface BotOptions {
  /** Campaign flavour (SPEC §13.3). Defaults to balanced. */
  personality?: Personality;
  /** Full weight override, for tuning experiments. Takes precedence over `personality`. */
  weights?: BotWeights;
}

/**
 * chooseOrders (SPEC §13.1): deterministic given its inputs. The returned set always passes
 * `validateOrderSet`, the same check human orders go through.
 */
export function chooseOrders(
  state: GameState,
  playerId: PlayerId,
  difficulty: Difficulty,
  seed: string,
  options: BotOptions = {},
): OrderSet {
  const me = state.players.find((p) => p.id === playerId);
  if (!me || me.eliminated || state.result) return [];
  const weights =
    options.weights ?? PERSONALITIES[options.personality ?? "balanced"] ?? NORMAL_WEIGHTS;
  // A pending draft is picked first; the rest of the plan is made with the mutation in effect.
  const pick = pickMutation(state, playerId);
  const planState = withPick(state, playerId, pick);
  const plan =
    difficulty === "hard"
      ? hardPlan(planState, playerId, seed, weights)
      : greedyPlan(planState, playerId, difficulty, seed, weights);
  const orders: Order[] = pick ? [{ type: "draft", mutation: pick }, ...plan] : plan;
  // Repair: never hand back a set the sim would reject.
  return validateOrderSet(state, playerId, orders).ok
    ? orders
    : filterOrderSet(state, playerId, orders).accepted.map((x) => x.order);
}

/**
 * The utility planner (SPEC §13.2): Normal is greedy; Easy picks among the top three per slot,
 * ignores threats half the time and never severs. `variant` reseeds the Easy randomness, which
 * Hard uses to sample plausible alternatives.
 */
export function greedyPlan(
  state: GameState,
  playerId: PlayerId,
  difficulty: "easy" | "normal",
  seed: string,
  weights: BotWeights,
): Order[] {
  const rng = rngStream(seed, `bot:${playerId}:${state.turn}`);
  const easy = difficulty === "easy";
  const ignoreThreats = easy && rng.int(2) === 0;
  const analysis = analyse(state, playerId, weights);
  const candidates = generateCandidates(analysis, { ignoreThreats, sever: !easy })
    .filter((c) => c.value > 0)
    .sort(byRatio);
  return select(state, playerId, candidates, easy ? rng : null);
}

function byRatio(a: Candidate, b: Candidate): number {
  const ra = a.value / Math.max(1, a.cost);
  const rb = b.value / Math.max(1, b.cost);
  if (ra !== rb) return rb - ra;
  if (a.value !== b.value) return b.value - a.value;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * Greedy selection under the nutrient budget and order limit. Cheap bookkeeping rules out most
 * conflicts; the sim's own validator settles the rest. With an rng (Easy), each slot is filled
 * by a random pick among the top three candidates that still fit.
 */
function select(
  state: GameState,
  player: PlayerId,
  sorted: readonly Candidate[],
  rng: Rng | null,
): Order[] {
  const ps = state.players.find((p) => p.id === player);
  let budget = ps?.nutrients ?? 0;
  const maxOrders = state.rules.maxOrdersPerSet;
  const starts = new Set<string>();
  const claims = new Set<string>();
  const reinforced = new Set<string>();
  const orders: Order[] = [];
  const remaining = sorted.slice();

  const fits = (c: Candidate): boolean => {
    if (c.cost > budget || orders.length + c.orders.length > maxOrders) return false;
    if (c.start !== null && starts.has(c.start)) return false;
    if (c.reinforces !== null && reinforced.has(c.reinforces)) return false;
    if (c.claims.some((k) => claims.has(k))) return false;
    const pending = orders.slice();
    for (const o of c.orders) {
      if (!validateOrder(state, player, o, pending).ok) return false;
      pending.push(o);
    }
    return true;
  };

  for (;;) {
    const picks: number[] = [];
    for (let i = 0; i < remaining.length && picks.length < (rng ? 3 : 1); i++) {
      if (fits(remaining[i] as Candidate)) picks.push(i);
    }
    if (picks.length === 0) break;
    const index = rng ? (picks[rng.int(picks.length)] as number) : (picks[0] as number);
    const chosen = remaining[index] as Candidate;
    remaining.splice(index, 1);
    orders.push(...chosen.orders);
    budget -= chosen.cost;
    if (chosen.start !== null) starts.add(chosen.start);
    if (chosen.reinforces !== null) reinforced.add(chosen.reinforces);
    for (const k of chosen.claims) claims.add(k);
  }
  return orders;
}
