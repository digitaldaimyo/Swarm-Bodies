import { getBoard, type Body, type Colony, type PlayerId, type StrainId } from "@swarm/sim";

/**
 * Strain personality (colony life, phase 5): how each strain's colony looks and moves. Every
 * style echoes the strain's rules: Swarmer reaches far with thin, quick veins; Biofilm is
 * thick, slow and hard to shift; Predator is dark and jagged; Sporer sheds drifting specks.
 * Client presentation only.
 */
export interface StrainStyle {
  /** Vessel width factor (webbing follows it halfway). */
  vein: number;
  /** Heartbeat period factor: below 1 beats quicker. Feelers twitch at the same pace. */
  pace: number;
  /** Vessel tone: positive lightens toward white, negative darkens toward black. */
  shade: number;
  /** Vessel kink: the sideways offset of each vessel's midpoint, as a share of its length. */
  jag: number;
  /** Sheds drifting spore specks. */
  specks: boolean;
}

const STYLES: Record<StrainId, StrainStyle> = {
  base: { vein: 1, pace: 1, shade: 0.45, jag: 0, specks: false },
  swarmer: { vein: 0.6, pace: 0.75, shade: 0.5, jag: 0, specks: false },
  biofilm: { vein: 1.55, pace: 1.35, shade: 0.4, jag: 0, specks: false },
  predator: { vein: 1, pace: 0.95, shade: -0.35, jag: 0.14, specks: false },
  sporer: { vein: 0.9, pace: 1.1, shade: 0.5, jag: 0, specks: true },
};

export function strainStyle(strain: StrainId | undefined): StrainStyle {
  return STYLES[strain ?? "base"] ?? STYLES.base;
}

/** A feeler: from a connected cell of the player's toward an empty, open neighbour. */
export interface Feeler {
  from: number;
  to: number;
}

/**
 * The player's growth frontier on a body: every connected cell's empty, passable neighbours
 * (the first step of any grow path), in board order.
 */
export function frontier(
  body: Body,
  colony: readonly (Colony | null)[],
  player: PlayerId,
): Feeler[] {
  const board = getBoard(body.radius);
  const out: Feeler[] = [];
  colony.forEach((c, i) => {
    if (!c || c.owner !== player || !c.connected) return;
    for (const j of board.neighbours[i] as readonly number[]) {
      if (!colony[j] && body.terrain[j] !== "rock") out.push({ from: i, to: j });
    }
  });
  return out;
}

/** At most `cap` items, spread evenly over the list (deterministic). */
export function spread<T>(items: readonly T[], cap: number): T[] {
  if (items.length <= cap) return items.slice();
  const out: T[] = [];
  for (let k = 0; k < cap; k++) out.push(items[Math.floor((k * items.length) / cap)] as T);
  return out;
}
