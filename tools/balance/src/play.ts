import { chooseOrders } from "@swarm/bot";
import {
  createGame,
  dominancePermille,
  randomOrderSet,
  resolveTurn,
  type GameConfig,
  type GameResult,
  type GameState,
  type OrderSet,
  type PlayerId,
} from "@swarm/sim";

export type Policy = (state: GameState, player: PlayerId) => OrderSet;

/** M1's only policy: random legal orders. Bots arrive in M2. */
export const randomPolicy =
  (playSeed: string): Policy =>
  (state, player) =>
    randomOrderSet(state, player, playSeed);

export const POLICY_NAMES = ["random", "easy", "normal", "hard"] as const;
export type PolicyName = (typeof POLICY_NAMES)[number];

export function isPolicyName(name: string): name is PolicyName {
  return (POLICY_NAMES as readonly string[]).includes(name);
}

/** Builds a policy by name. Every policy is deterministic given the game seed. */
export function policyByName(name: PolicyName, seed: string): Policy {
  return name === "random"
    ? randomPolicy(seed)
    : (state, player) => chooseOrders(state, player, name, seed);
}

export interface PlayedGame {
  seed: string;
  result: GameResult;
  turns: OrderSet[][];
  final: GameState;
  /** Dominance per turn per player, per-mille. */
  dominance: number[][];
  rejected: number;
}

/**
 * Plays one game to the end. `policy` is either one policy for every seat or one per seat.
 * `onTurn` sees how long each seat's policy took, for time-budget reports.
 */
export function playGame(
  config: GameConfig,
  seed: string,
  policy: Policy | readonly Policy[],
  onTurn?: (seat: number, ms: number) => void,
  clock: () => number = () => performance.now(),
): PlayedGame {
  const seatPolicy = (seat: number): Policy =>
    Array.isArray(policy) ? (policy[seat] as Policy) : (policy as Policy);
  let state = createGame(config, seed);
  const turns: OrderSet[][] = [];
  const dominance: number[][] = [];
  let rejected = 0;
  // The turn limit guarantees termination; the guard catches a broken victory check.
  for (let guard = 0; !state.result; guard++) {
    if (guard > state.rules.turnLimit + 1)
      throw new Error(`Game ${seed} did not end by the turn limit`);
    const orders: OrderSet[] = state.players.map((p, seat) => {
      if (p.eliminated) return [];
      const t0 = clock();
      const set = seatPolicy(seat)(state, p.id);
      onTurn?.(seat, clock() - t0);
      return set;
    });
    const byPlayer: Record<PlayerId, OrderSet> = {};
    state.players.forEach((p, i) => (byPlayer[p.id] = orders[i] as OrderSet));
    const out = resolveTurn(state, byPlayer);
    rejected += out.events.filter((e) => e.type === "OrderRejected").length;
    turns.push(orders);
    state = out.state;
    dominance.push(state.players.map((p) => dominancePermille(state, p.id)));
  }
  return { seed, result: state.result as GameResult, turns, final: state, dominance, rejected };
}
