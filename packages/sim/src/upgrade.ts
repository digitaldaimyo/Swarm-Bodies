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
