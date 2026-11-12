import {
  applyDraftPick,
  MUTATION_IDS,
  type GameState,
  type MutationId,
  type PlayerId,
  type StrainId,
} from "@swarm/sim";

/**
 * Draft picks (SPEC §13.2): a fixed affinity per strain, nudged by the map: spore mutations are
 * worthless without other bodies, deposit mutations follow the deposits the bot already holds.
 */
type Affinity = Record<MutationId, number>;
const flat = (v: number): Affinity =>
  Object.fromEntries(MUTATION_IDS.map((m) => [m, v])) as Affinity;

export const AFFINITY: Record<StrainId, Affinity> = {
  base: flat(5),
  swarmer: {
    ...flat(4),
    chemotaxis: 8,
    dormancy: 7,
    regeneration: 6,
    acid_tendrils: 5,
    deep_reserves: 5,
    rapid_fruiting: 5,
  },
  biofilm: {
    ...flat(4),
    thick_veins: 8,
    quorum: 8,
    deep_reserves: 7,
    regeneration: 6,
    cryophile: 5,
    lithotroph: 5,
    rad_shield: 5,
  },
  predator: {
    ...flat(4),
    acid_tendrils: 9,
    quorum: 6,
    regeneration: 5,
    dormancy: 5,
    chemotaxis: 5,
    hardened_spores: 5,
  },
  sporer: {
    ...flat(4),
    hardened_spores: 9,
    rapid_fruiting: 8,
    rad_shield: 6,
    dormancy: 6,
    deep_reserves: 6,
    thick_veins: 5,
    regeneration: 5,
    chemotaxis: 5,
  },
};

export function pickMutation(state: GameState, player: PlayerId): MutationId | null {
  const ps = state.players.find((p) => p.id === player);
  if (!ps?.draft) return null;
  const affinity = AFFINITY[ps.strain] ?? AFFINITY.base;
  const system = state.bodies.filter((b) => b.orbit).length > 1;
  const held = { ice: 0, mineral: 0, organic: 0 };
  let irradiated = false;
  for (const b of state.bodies) {
    if (b.type === "irradiated") irradiated = true;
    b.colony.forEach((c, i) => {
      const d = b.deposits[i];
      if (c?.owner === player && d) held[d]++;
    });
  }
  const score = (m: MutationId): number => {
    let v = affinity[m];
    if (!system && (m === "hardened_spores" || m === "rapid_fruiting")) v = 0;
    if (m === "rad_shield" && system) v += irradiated ? 2 : 1;
    if (m === "cryophile") v += Math.min(4, held.ice);
    if (m === "lithotroph") v += Math.min(4, held.mineral);
    return v;
  };
  let best: MutationId | null = null;
  for (const m of ps.draft.options) if (best === null || score(m) > score(best)) best = m;
  return best;
}

/** The state the rest of the plan should be made against, with the pick applied. */
export function withPick(state: GameState, player: PlayerId, pick: MutationId | null): GameState {
  return pick ? applyDraftPick(state, player, pick) : state;
}
