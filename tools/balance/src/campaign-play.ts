import { chooseOrders, type Personality as BotPersonality } from "@swarm/bot";
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
  difficulty: "normal" | "hard";
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
        let o = chooseOrders(state, 0, policy.difficulty, `campaign-you-${node.id}`, {
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
          node.opponent.difficulty,
          `${node.seed}:bot${p.id}`,
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
