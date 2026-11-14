import { useEffect, useState } from "preact/hooks";

/** Player settings (SPEC §10.1 screen 9). Stored per device; every access is guarded. */
export interface Settings {
  master: number;
  sfx: number;
  ambience: number;
  haptics: boolean;
  reduceMotion: boolean;
  replaySpeed: 1 | 2;
  /** Colourblind pattern overlays on colonies (SPEC §10.4, §10.8). */
  patterns: boolean;
  /** UI text scale, 1 to 1.5 (SPEC §10.8). */
  textScale: number;
  /** Colony detail (colony life): "calm" drops the moving extras (nutrient motes). */
  colonyDetail: "full" | "calm";
}

export const TEXT_SCALES = [1, 1.25, 1.5] as const;

const KEY = "swarm.settings.v1";

function defaults(): Settings {
  const reduce =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  return {
    master: 0.8,
    sfx: 0.8,
    ambience: 0.5,
    haptics: true,
    reduceMotion: reduce,
    replaySpeed: 1,
    patterns: false,
    textScale: 1,
    colonyDetail: "full",
  };
}

let current: Settings = load();
const listeners = new Set<(s: Settings) => void>();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults(), ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    // Storage blocked (private mode): fall back to defaults.
  }
  return defaults();
}

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Not persisted; still applies for this session.
  }
  for (const fn of listeners) fn(current);
}

export function useSettings(): Settings {
  const [s, set] = useState(current);
  useEffect(() => {
    listeners.add(set);
    return () => void listeners.delete(set);
  }, []);
  return s;
}

/** Short tick when a path cell is added, a stronger tap on submit (SPEC §10.3). */
export function haptic(kind: "tick" | "submit"): void {
  if (!current.haptics || typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try {
    navigator.vibrate(kind === "tick" ? 8 : [18, 40, 28]);
  } catch {
    // Some browsers throw without a user gesture.
  }
}
