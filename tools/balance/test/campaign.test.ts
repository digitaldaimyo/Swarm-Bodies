import { describe, expect, it } from "vitest";
import {
  CAMPAIGN,
  emptyProgress,
  nodeOpen,
  unlockedMutations,
  unlockedStrains,
} from "@swarm/content";
import { completeNode } from "../src/campaign-play";

describe("SPEC §15 M7: the campaign is completable", () => {
  it(
    "every node can be completed, in order, with the strains and mutations unlocked before it",
    () => {
      const done: string[] = [];
      for (const node of CAMPAIGN) {
        expect(nodeOpen(node, new Set(done)), `${node.id} is reachable`).toBe(true);
        const progress = { ...emptyProgress(), completedNodes: done };
        const way = completeNode(node, unlockedStrains(progress), unlockedMutations(progress));
        expect(way, `${node.id} ${node.name} has a winning line`).not.toBeNull();
        done.push(node.id);
      }
      // Completing the campaign unlocks every strain.
      expect(unlockedStrains({ ...emptyProgress(), completedNodes: done }).sort()).toEqual([
        "biofilm",
        "predator",
        "sporer",
        "swarmer",
      ]);
    },
    20 * 60_000,
  );
});
