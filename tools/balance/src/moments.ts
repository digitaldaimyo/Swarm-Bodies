import { chooseOrders } from "@swarm/bot";
import {
  CAMPAIGN,
  MOMENT_PRIORITY,
  newMomentTracker,
  nextMoment,
  nodeConfig,
  type MomentId,
} from "@swarm/content";
import { createGame, resolveTurn, type OrderSet, type PlayerId } from "@swarm/sim";

export interface MomentReport {
  games: number;
  /** Lines spoken per game: mean and the share of games at each count. */
  meanLines: number;
  histogram: Record<number, number>;
  /** Games in which each moment was spoken / was detected at all. */
  spoken: Record<MomentId, number>;
  meanTurns: number;
}

/**
 * How often Dr. Purr speaks (docs/plans/tutorial.md, step 5): every campaign node, `games` plays
 * each, an Easy-bot stand-in in seat 0 against the node's bots, the tracker run for seat 0 as
 * the client runs it.
 */
export function measureMoments(games: number): MomentReport {
  const spoken = Object.fromEntries(MOMENT_PRIORITY.map((m) => [m, 0])) as Record<MomentId, number>;
  const histogram: Record<number, number> = {};
  let total = 0;
  let lines = 0;
  let turns = 0;
  for (const node of CAMPAIGN)
    for (let g = 0; g < games; g++) {
      const config = nodeConfig(node, node.you ?? "swarmer");
      let state = createGame(config, node.seed);
      let tracker = newMomentTracker();
      let said = 0;
      while (!state.result) {
        const orders: Record<PlayerId, OrderSet> = {};
        for (const p of state.players) {
          if (p.eliminated) continue;
          orders[p.id] =
            p.id === 0
              ? chooseOrders(state, 0, "easy", `moments-you-${node.id}-${g}`)
              : chooseOrders(
                  state,
                  p.id,
                  node.opponent.difficulty,
                  `${node.seed}:bot${p.id}-${g}`,
                  {
                    personality: node.opponent.personality,
                  },
                );
        }
        const out = resolveTurn(state, orders);
        const r = nextMoment(tracker, state, out.events, out.state, 0);
        tracker = r.tracker;
        if (r.moment) {
          said++;
          spoken[r.moment]++;
        }
        state = out.state;
      }
      total++;
      lines += said;
      turns += state.turn;
      histogram[said] = (histogram[said] ?? 0) + 1;
    }
  return { games: total, meanLines: lines / total, histogram, spoken, meanTurns: turns / total };
}

export function formatMoments(r: MomentReport): string {
  const out = [
    `Dr. Purr's moments over ${r.games} campaign games (Easy stand-in, ${r.meanTurns.toFixed(1)} turns mean)`,
    `  lines per game: ${r.meanLines.toFixed(2)} mean`,
    `  histogram: ${Object.entries(r.histogram)
      .map(([k, v]) => `${k}:${((100 * v) / r.games).toFixed(0)}%`)
      .join("  ")}`,
  ];
  for (const m of MOMENT_PRIORITY)
    out.push(
      `  ${m.padEnd(16)} ${((100 * r.spoken[m]) / r.games).toFixed(0).padStart(3)}% of games`,
    );
  return out.join("\n");
}
