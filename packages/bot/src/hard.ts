import {
  incomeFor,
  resolveTurn,
  type GameState,
  type Order,
  type OrderSet,
  type PlayerId,
} from "@swarm/sim";
import { greedyPlan } from "./choose";
import { pickMutation, withPick } from "./drafts";
import { PERSONALITIES, type BotWeights } from "./weights";

/**
 * Hard (SPEC §13.2): greedy, plus a 1-ply robustness check. A few alternative plans (the Normal
 * plan, personality variants and randomised Normal variants) are each resolved against 8
 * plausible opponent order sets made with the Normal policy, and the plan whose worst outcome is
 * best wins. Ties keep the earlier (more Normal-like) plan, so Hard never does worse than Normal
 * against the sampled replies.
 */
export const HARD_SAMPLES = 8;

const OPPONENT_STYLES: readonly BotWeights[] = [
  PERSONALITIES.balanced,
  PERSONALITIES.aggressive,
  PERSONALITIES.saboteur,
  PERSONALITIES.greedy,
];

export function hardPlan(
  state: GameState,
  me: PlayerId,
  seed: string,
  weights: BotWeights,
): Order[] {
  const plans: Order[][] = [];
  const seen = new Set<string>();
  const add = (p: Order[]) => {
    const k = JSON.stringify(p);
    if (!seen.has(k)) {
      seen.add(k);
      plans.push(p);
    }
  };
  add(greedyPlan(state, me, "normal", seed, weights));
  add(greedyPlan(state, me, "normal", seed, { ...weights, threat: weights.threat * 2 }));
  add(greedyPlan(state, me, "normal", seed, PERSONALITIES.aggressive));
  add(greedyPlan(state, me, "normal", seed, PERSONALITIES.expansionist));
  // Randomised variants only in 1v1: with several opponents every plan costs 8 resolutions
  // of a bigger board, and the time budget is per turn (SPEC §13.1).
  const multi = state.players.filter((p) => p.id !== me && !p.eliminated).length > 1;
  if (!multi)
    for (let v = 0; v < 2; v++) add(greedyPlan(state, me, "easy", `${seed}:hard:${v}`, weights));
  if (plans.length === 1) return plans[0] as Order[];

  // Opponent samples: each opponent replies as Normal would, in one of a few styles, half of
  // them with Easy-style randomness for variety; opponents see the same start-of-turn state.
  // One opponent gets 8 distinct replies. With several, each gets 4 and the 8 samples mix them,
  // which keeps the planner inside its time budget in 4-player games.
  const opponents = state.players.filter((p) => p.id !== me && !p.eliminated).map((p) => p.id);
  const perOpponent = opponents.length > 1 ? HARD_SAMPLES / 2 : HARD_SAMPLES;
  const replies = new Map<PlayerId, OrderSet[]>();
  for (const opp of opponents) {
    const pick = pickMutation(state, opp);
    const view = withPick(state, opp, pick);
    const list: OrderSet[] = [];
    for (let k = 0; k < perOpponent; k++) {
      const style = OPPONENT_STYLES[k % OPPONENT_STYLES.length] as BotWeights;
      const random = k >= perOpponent / 2;
      const plan = greedyPlan(
        view,
        opp,
        random ? "easy" : "normal",
        `${seed}:opp:${opp}:${k}`,
        style,
      );
      list.push(pick ? [{ type: "draft", mutation: pick }, ...plan] : plan);
    }
    replies.set(opp, list);
  }
  const samples: Record<PlayerId, OrderSet>[] = [];
  for (let k = 0; k < HARD_SAMPLES; k++) {
    const sample: Record<PlayerId, OrderSet> = {};
    opponents.forEach((opp, j) => {
      const list = replies.get(opp) as OrderSet[];
      sample[opp] = list[(k + j * (k >> 2)) % list.length] as OrderSet;
    });
    samples.push(sample);
  }

  let best = plans[0] as Order[];
  let bestWorst = -Infinity;
  let bestMean = -Infinity;
  for (const plan of plans) {
    let worst = Infinity;
    let total = 0;
    for (const sample of samples) {
      const v = evaluate(resolveTurn(state, { ...sample, [me]: plan }).state, me);
      worst = Math.min(worst, v);
      total += v;
    }
    const mean = total / samples.length;
    if (worst > bestWorst || (worst === bestWorst && mean > bestMean)) {
      best = plan;
      bestWorst = worst;
      bestMean = mean;
    }
  }
  return best;
}

/**
 * How good a resolved state is for `me`, against the strongest rival. One turn is a short look
 * ahead, so the score values what compounds: income over a few turns, connected biomass (cut-off
 * cells are on their way out), cores, and spores in flight.
 */
export function evaluate(state: GameState, me: PlayerId): number {
  if (state.result) {
    if (state.result.winner === me) return 1e6;
    if (state.result.winner !== null) return -1e6;
  }
  const horizon = Math.max(1, Math.min(6, state.rules.turnLimit - state.turn));
  const score = (id: PlayerId): number => {
    const ps = state.players.find((p) => p.id === id);
    if (!ps || ps.eliminated) return -1e5;
    let cells = 0;
    let biomass = 0;
    let cores = 0;
    for (const b of state.bodies)
      for (const c of b.colony) {
        if (!c || c.owner !== id) continue;
        cells += c.connected ? 1 : 0.4;
        biomass += c.connected ? c.biomass : 0;
        if (c.core) cores++;
      }
    const spores = state.spores.filter((s) => s.owner === id).length;
    return (
      cells * 3 +
      biomass * 0.6 +
      cores * 12 +
      incomeFor(state, id) * horizon * 0.8 +
      ps.nutrients * 0.4 +
      spores * 10
    );
  };
  let rival = -Infinity;
  for (const p of state.players) if (p.id !== me) rival = Math.max(rival, score(p.id));
  return score(me) - (rival === -Infinity ? 0 : rival);
}
