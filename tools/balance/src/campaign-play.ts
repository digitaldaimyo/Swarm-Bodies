import { chooseOrders, type Difficulty, type Personality as BotPersonality } from "@swarm/bot";
import {
  CAMPAIGN,
  emptyProgress,
  nodeCompleted,
  unlockedMutations,
  unlockedStrains,
  nodeConfig,
  summarizeGame,
  type CampaignNode,
  type GameSummary,
} from "@swarm/content";
import {
  createGame,
  resolveTurn,
  type MutationId,
  type OrderSet,
  type PlayerId,
  type StrainId,
} from "@swarm/sim";

/** A scripted campaign player: the Hard bot, optionally in a personality, honouring the twist. */
export interface CampaignPolicy {
  name: string;
  difficulty: "easy" | "normal" | "hard";
  personality?: BotPersonality;
}

export const CAMPAIGN_POLICIES: readonly CampaignPolicy[] = [
  { name: "hard", difficulty: "hard" },
  { name: "hard-aggressive", difficulty: "hard", personality: "aggressive" },
  { name: "hard-expansionist", difficulty: "hard", personality: "expansionist" },
  { name: "hard-greedy", difficulty: "hard", personality: "greedy" },
];

/** Plays one node to the end with `policy` in seat 0 and the node's bots in the other seats. */
export function playNode(
  node: CampaignNode,
  policy: CampaignPolicy,
  strain: StrainId = "swarmer",
  mutationPool?: readonly MutationId[],
  /** Reseeds both sides' choices (the map stays the node's), for win-rate batches. */
  variant = "",
  /** Plays the node's bots at this difficulty instead of the node's own. */
  opponentDifficulty: Difficulty = node.opponent.difficulty,
): GameSummary {
  const config = nodeConfig(node, strain, mutationPool);
  let state = createGame(config, node.seed);
  const turns: Record<PlayerId, OrderSet>[] = [];
  let launched = 0;
  while (!state.result) {
    const orders: Record<PlayerId, OrderSet> = {};
    for (const p of state.players) {
      if (p.eliminated) continue;
      if (p.id === 0) {
        let o = chooseOrders(state, 0, policy.difficulty, `campaign-you-${node.id}${variant}`, {
          ...(policy.personality ? { personality: policy.personality } : {}),
        });
        // Honour launch limits: the player simply stops launching.
        const cap = node.twist === "no_launch" ? 0 : node.twist === "few_launches" ? 2 : Infinity;
        if (launched >= cap) o = o.filter((x) => x.type !== "launch");
        launched += o.filter((x) => x.type === "launch").length;
        orders[0] = o;
      } else {
        orders[p.id] = chooseOrders(
          state,
          p.id,
          opponentDifficulty,
          `${node.seed}:bot${p.id}${variant}`,
          {
            personality: node.opponent.personality,
          },
        );
      }
    }
    turns.push(orders);
    state = resolveTurn(state, orders).state;
  }
  return summarizeGame(config, node.seed, turns, 0, { mode: "campaign", campaignNode: node.id });
}

/**
 * Finds a way through a node using only the strains unlocked before it (SPEC §11.1): the first
 * strain and policy whose game completes the node (a win, plus the twist). The draft pool is
 * the one unlocked so far, as the client would offer it.
 */
export function completeNode(
  node: CampaignNode,
  strains: readonly StrainId[],
  mutationPool?: readonly MutationId[],
): { strain: StrainId; policy: string; summary: GameSummary } | null {
  for (const strain of node.you ? [node.you] : strains)
    for (const policy of CAMPAIGN_POLICIES) {
      const summary = playNode(node, policy, strain, mutationPool);
      if (nodeCompleted(node, summary)) return { strain, policy: policy.name, summary };
    }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const done: string[] = [];
  for (const node of CAMPAIGN) {
    const progress = { ...emptyProgress(), completedNodes: done };
    const r = completeNode(node, unlockedStrains(progress), unlockedMutations(progress));
    console.log(
      `${node.id} ${node.name.padEnd(14)} ${r ? `✓ ${r.strain}/${r.policy} (${r.summary.reason}, turn ${r.summary.turns})` : "✗ not completed"}`,
    );
    done.push(node.id);
  }
}

/** A beginner stand-in for measuring how gentle a node is: the Easy bot (DECISIONS #122). */
export const BEGINNER: CampaignPolicy = { name: "beginner", difficulty: "easy" };

/**
 * How often the beginner stand-in wins `node` against its bots at `opponent` difficulty, over
 * `games` reseeded plays on the node's own map (and its own strain for the player, if fixed).
 */
export function beginnerWinRate(
  node: CampaignNode,
  opponent: Difficulty,
  games: number,
): { wins: number; games: number; meanTurns: number } {
  let wins = 0;
  let turns = 0;
  for (let g = 0; g < games; g++) {
    const s = playNode(node, BEGINNER, node.you ?? "swarmer", undefined, `:v${g}`, opponent);
    if (s.outcome === "win") wins++;
    turns += s.turns;
  }
  return { wins, games, meanTurns: turns / games };
}
