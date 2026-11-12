import { MUTATION_IDS, type MutationId, type StrainId } from "@swarm/sim";
import { CAMPAIGN } from "./campaign";
import { COSMETICS } from "./cosmetics";

/**
 * Player progress (SPEC §11): saved locally and synced to the account when online. Every field
 * only grows, so merging two copies is a union: no copy can roll another back.
 */
export interface Progress {
  version: 1;
  completedNodes: string[];
  /** Mutations drafted at least once (fills the codex entry, SPEC §11.3). */
  drafted: MutationId[];
  achievements: string[];
  /** Cosmetics earned outside achievements (season rewards). */
  rewards: string[];
  /** Selected cosmetics by kind. */
  selected: { palette: string; vein: string; trail: string };
}

export function emptyProgress(): Progress {
  return {
    version: 1,
    completedNodes: [],
    drafted: [],
    achievements: [],
    rewards: [],
    selected: { palette: "default", vein: "default", trail: "default" },
  };
}

const union = <T>(a: readonly T[], b: readonly T[]): T[] => [...new Set([...a, ...b])].sort();

export function mergeProgress(a: Progress, b: Progress): Progress {
  return {
    version: 1,
    completedNodes: union(a.completedNodes, b.completedNodes),
    drafted: union(a.drafted, b.drafted),
    achievements: union(a.achievements, b.achievements),
    rewards: union(a.rewards, b.rewards),
    selected: a.selected,
  };
}

/** Strains everyone starts with; the campaign unlocks the rest (SPEC §11.1). */
export const STARTER_STRAINS: readonly StrainId[] = ["swarmer", "biofilm"];

/** Mutations the campaign unlocks; the other 8 are available from the start. */
export const CAMPAIGN_MUTATIONS: readonly MutationId[] = CAMPAIGN.flatMap(
  (n) => n.unlocks.mutations ?? [],
);

export function unlockedStrains(p: Progress): StrainId[] {
  const out = new Set<StrainId>(STARTER_STRAINS);
  for (const n of CAMPAIGN)
    if (p.completedNodes.includes(n.id)) for (const s of n.unlocks.strains ?? []) out.add(s);
  return [...out];
}

/** Where a locked strain unlocks, for the picker. */
export function strainUnlockNode(strain: StrainId): number | null {
  return CAMPAIGN.find((n) => n.unlocks.strains?.includes(strain))?.index ?? null;
}

/** The draft pool for offline play: the starter pool plus campaign unlocks (sorted). */
export function unlockedMutations(p: Progress): MutationId[] {
  const locked = new Set(CAMPAIGN_MUTATIONS);
  for (const n of CAMPAIGN)
    if (p.completedNodes.includes(n.id))
      for (const m of n.unlocks.mutations ?? []) locked.delete(m);
  return MUTATION_IDS.filter((m) => !locked.has(m));
}

/** Cosmetics this progress has earned (defaults, achievement rewards, season rewards). */
export function earnedCosmetics(p: Progress): string[] {
  return COSMETICS.filter(
    (c) =>
      c.source.kind === "default" ||
      (c.source.kind === "achievement" && p.achievements.includes(c.source.id)) ||
      p.rewards.includes(c.id),
  ).map((c) => c.id);
}
