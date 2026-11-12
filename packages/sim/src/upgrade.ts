import { BASE_RULES, type Rules } from "./config";
import type { Body, Colony, GameState, PlayerState } from "./types";

/**
 * Brings a stored state from an earlier version up to the current shape (M5 added orbits,
 * comets, fruiting, spores and the event schedule; M6 added mutations, drafts and `cut`). Missing fields get the values a Single Rock
 * game created today would have, so an upgraded state equals a fresh one turn for turn and
 * keeps resolving identically. Present fields are left untouched.
 */
export function upgradeState(stored: GameState): GameState {
  const s = stored as Partial<GameState> & GameState;
  return {
    ...s,
    rules: upgradeRules(s.rules),
    bodies: s.bodies.map((raw) => {
      const b = raw as Partial<Body> & Body;
      return {
        ...b,
        orbit: b.orbit ?? null,
        home: b.home ?? null,
        comets: b.comets ?? [],
        colony: b.colony.map((c) =>
          c
            ? {
                ...c,
                fruiting: (c as Partial<Colony>).fruiting ?? null,
                cut: (c as Partial<Colony>).cut ?? 0,
              }
            : null,
        ),
      };
    }),
    players: s.players.map((raw) => {
      const p = raw as Partial<PlayerState> & PlayerState;
      return {
        ...p,
        mutations: p.mutations ?? [],
        draft: p.draft ?? null,
        draftsOffered: p.draftsOffered ?? 0,
      };
    }),
    spores: s.spores ?? [],
    nextSporeId: s.nextSporeId ?? 1,
    schedule: s.schedule ?? [],
  };
}

/**
 * Rules stored before M6 lack the newer fields. Missing ones take today's defaults, except where
 * that would change how an old game plays on: it gets no drafts, and flares behave as before.
 */
function upgradeRules(stored: Rules): Rules {
  const r = stored as Partial<Rules>;
  return {
    ...BASE_RULES,
    ...(r.draftThresholds === undefined ? { draftThresholds: [] } : {}),
    ...(r.flareMinBiomass === undefined ? { flareMinBiomass: 0 } : {}),
    ...stored,
    strains: { ...BASE_RULES.strains, ...(r.strains ?? {}) },
    mutations: { ...BASE_RULES.mutations, ...(r.mutations ?? {}) },
  };
}
