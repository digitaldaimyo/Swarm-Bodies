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

export interface PlayedGame {
  seed: string;
  result: GameResult;
  turns: OrderSet[][];
  final: GameState;
  /** Dominance per turn per player, per-mille. */
  dominance: number[][];
  rejected: number;
}

export function playGame(config: GameConfig, seed: string, policy: Policy): PlayedGame {
  let state = createGame(config, seed);
  const turns: OrderSet[][] = [];
  const dominance: number[][] = [];
  let rejected = 0;
  // The turn limit guarantees termination; the guard catches a broken victory check.
  for (let guard = 0; !state.result; guard++) {
    if (guard > state.rules.turnLimit + 1)
      throw new Error(`Game ${seed} did not end by the turn limit`);
    const orders: OrderSet[] = state.players.map((p) => (p.eliminated ? [] : policy(state, p.id)));
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
