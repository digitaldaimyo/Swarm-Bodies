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
import {
  HARD_WEIGHTS,
  NORMAL_WEIGHTS,
  NOVICE,
  PERSONALITIES,
  type BotWeights,
  type Personality,
} from "./weights";

/** "novice" is for the early campaign only (DECISIONS #122); skirmish offers easy to hard. */
export type Difficulty = "novice" | "easy" | "normal" | "hard";

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
    options.weights ??
    (options.personality
      ? PERSONALITIES[options.personality]
      : difficulty === "hard"
        ? HARD_WEIGHTS
        : NORMAL_WEIGHTS);
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
  difficulty: "novice" | "easy" | "normal",
  seed: string,
  weights: BotWeights,
): Order[] {
  const rng = rngStream(seed, `bot:${playerId}:${state.turn}`);
  const novice = difficulty === "novice";
  const easy = difficulty === "easy" || novice;
  const ignoreThreats = novice ? rng.int(3) < NOVICE.ignoreThreatsOutOf3 : easy && rng.int(2) === 0;
  const analysis = analyse(state, playerId, weights);
  // When nutrients outrun what 12 orders can spend, the order limit is the binding constraint:
  // rank by value per order instead of value per N (SPEC §5.1 order limit).
  const banked = state.players.find((p) => p.id === playerId)?.nutrients ?? 0;
  const rich = banked >= state.rules.maxOrdersPerSet * RICH_N_PER_ORDER;
  const candidates = generateCandidates(analysis, {
    ignoreThreats,
    sever: !easy,
    ...(novice ? { assaultMargin: NOVICE.assaultMargin } : {}),
  })
    .filter((c) => c.value > 0)
    // Novice starts no fights early on.
    .filter((c) => !(novice && c.kind === "assault" && state.turn < NOVICE.peaceUntilTurn))
    .sort(rich ? byValuePerOrder : byRatio);
  return select(
    state,
    playerId,
    candidates,
    easy ? rng : null,
    novice ? { pickFrom: NOVICE.pickFrom, maxOrders: NOVICE.maxOrders } : undefined,
  );
}

/** N per order above which a bot counts as rich (orders, not nutrients, limit it). */
const RICH_N_PER_ORDER = 6;

function byValuePerOrder(a: Candidate, b: Candidate): number {
  const ra = a.value / Math.max(1, a.orders.length);
  const rb = b.value / Math.max(1, b.orders.length);
  if (ra !== rb) return rb - ra;
  return byRatio(a, b);
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
  limits?: { pickFrom: number; maxOrders: number },
): Order[] {
  const ps = state.players.find((p) => p.id === player);
  let budget = ps?.nutrients ?? 0;
  const maxOrders = Math.min(state.rules.maxOrdersPerSet, limits?.maxOrders ?? Infinity);
  const pickFrom = rng ? (limits?.pickFrom ?? 3) : 1;
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
    for (let i = 0; i < remaining.length && picks.length < pickFrom; i++) {
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
