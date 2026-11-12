import type { SavedSkirmish } from "../game/session";

const KEY = "swarm.skirmish.v1";

/** The skirmish in progress, so closing the app never loses a game (SPEC §9.4 spirit). */
export function loadSkirmish(): SavedSkirmish | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedSkirmish;
    return saved.version === 2 ? saved : null;
  } catch {
    return null;
  }
}

export function saveSkirmish(s: SavedSkirmish | null): void {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable: the game simply is not resumable.
  }
}
