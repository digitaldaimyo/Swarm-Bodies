import type { Rules } from "@swarm/sim";

/**
 * Map modifiers (SPEC §11.1 campaign, §11.2 ranked sectors): data only, applied as rule
 * overrides when a game is created. Online and Daily games use none unless a sector says so.
 */
export interface Modifier {
  id: string;
  name: string;
  description: string;
  rules: Partial<Rules>;
}

export const MODIFIERS = {
  flare_storm: {
    id: "flare_storm",
    name: "Flare Storm",
    description: "Solar flares every 4 turns.",
    rules: { flareEveryMin: 4, flareEveryMax: 4 },
  },
  rich_comets: {
    id: "rich_comets",
    name: "Rich Comets",
    description: "Comets every 5–7 turns, yielding 8 N.",
    rules: { cometEveryMin: 5, cometEveryMax: 7, cometYield: 8 },
  },
  metallic_only: {
    id: "metallic_only",
    name: "Metallic Only",
    description: "Every neutral body is Metallic: costly to enter, dense to hold.",
    rules: { neutralBodyTypes: ["metallic"] },
  },
} as const satisfies Record<string, Modifier>;

export type ModifierId = keyof typeof MODIFIERS;

/**
 * Ranked season sectors (SPEC §11.2): one per 6-week season, in rotation. Each changes the map
 * for everyone in ranked play that season.
 */
export const SECTORS: readonly Modifier[] = [
  {
    id: "open_belt",
    name: "The Open Belt",
    description: "Standard systems.",
    rules: {},
  },
  {
    id: "irradiated_reach",
    name: "Irradiated Reach",
    description: "Half of the neutral bodies are Irradiated.",
    rules: { neutralBodyTypes: ["irradiated", "irradiated", "carbonaceous", "icy"] },
  },
  {
    id: "comet_tail",
    name: "Comet Tail",
    description: "Frequent comets.",
    rules: { cometEveryMin: 6, cometEveryMax: 8 },
  },
  {
    id: "wide_systems",
    name: "Wide Systems",
    description: "One more neutral body in every system.",
    rules: { systemExtraBodies: 2 },
  },
];

/** Season length (SPEC §11.2) and the epoch season 0 starts at (UTC, a Monday). */
export const SEASON_DAYS = 42;
export const SEASON_EPOCH_UTC = Date.UTC(2026, 0, 5);
const DAY_MS = 86_400_000;

export function seasonAt(ms: number): { season: number; startsMs: number; endsMs: number } {
  const season = Math.max(0, Math.floor((ms - SEASON_EPOCH_UTC) / (SEASON_DAYS * DAY_MS)));
  const startsMs = SEASON_EPOCH_UTC + season * SEASON_DAYS * DAY_MS;
  return { season, startsMs, endsMs: startsMs + SEASON_DAYS * DAY_MS };
}

export function sectorFor(season: number): Modifier {
  return SECTORS[season % SECTORS.length] as Modifier;
}
