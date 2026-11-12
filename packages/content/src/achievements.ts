import type { GameSummary } from "./summary";

/**
 * Achievements (SPEC §11.3): data with predicates over game summaries. Rewards are cosmetic
 * only (see cosmetics.ts), never gameplay.
 */
export interface Achievement {
  id: string;
  name: string;
  description: string;
  earned(s: GameSummary): boolean;
}

const won = (s: GameSummary) => s.outcome === "win";

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: "first_win", name: "First Bloom", description: "Win a game.", earned: won },
  {
    id: "no_launch_win",
    name: "Homebody",
    description: "Win without launching a spore.",
    earned: (s) => won(s) && s.launches === 0,
  },
  {
    id: "single_asteroid",
    name: "One Rock Is Enough",
    description: "Win a star-system game holding a single asteroid all game.",
    earned: (s) => won(s) && s.map === "system" && s.bodiesTouched === 1,
  },
  {
    id: "spore_core",
    name: "Death From Above",
    description: "Capture an enemy core with a spore.",
    earned: (s) => s.sporeCoreCaptures > 0,
  },
  {
    id: "stalemates_5",
    name: "Immovable Objects",
    description: "Win with 5 or more stalemates.",
    earned: (s) => won(s) && s.stalemates >= 5,
  },
  {
    id: "daily_streak_7",
    name: "Creature of Habit",
    description: "Play the Daily Seed 7 days in a row.",
    earned: (s) => (s.context.dailyStreak ?? 0) >= 7,
  },
  {
    id: "daily_first",
    name: "Morning Culture",
    description: "Submit a Daily Seed score.",
    earned: (s) => s.context.mode === "daily",
  },
  {
    id: "fast_win",
    name: "Blitz",
    description: "Win by turn 15.",
    earned: (s) => won(s) && s.turns <= 15,
  },
  {
    id: "last_standing",
    name: "Last Colony Standing",
    description: "Win by eliminating every rival.",
    earned: (s) => won(s) && s.reason === "lastStanding",
  },
  {
    id: "dominance_win",
    name: "Overgrowth",
    description: "Win by dominance.",
    earned: (s) => won(s) && s.reason === "dominance",
  },
  {
    id: "turn_limit_win",
    name: "Photo Finish",
    description: "Win on the turn limit.",
    earned: (s) => won(s) && s.reason === "turnLimit",
  },
  {
    id: "comeback",
    name: "Spore of Hope",
    description: "Win after falling to 5 or fewer cells.",
    earned: (s) => won(s) && s.lowestCellsAfterTurn3 > 0 && s.lowestCellsAfterTurn3 <= 5,
  },
  {
    id: "three_bodies",
    name: "Archipelago",
    description: "Hold cells on 3 bodies at once.",
    earned: (s) => s.maxBodiesHeld >= 3,
  },
  {
    id: "five_bodies",
    name: "Panspermia",
    description: "Hold cells on 5 bodies at once.",
    earned: (s) => s.maxBodiesHeld >= 5,
  },
  {
    id: "launches_10",
    name: "Spore Storm",
    description: "Launch 10 spores in one game.",
    earned: (s) => s.launches >= 10,
  },
  {
    id: "cores_3",
    name: "Heartbreaker",
    description: "Destroy 3 enemy cores in one game.",
    earned: (s) => s.coresDestroyed >= 3,
  },
  {
    id: "untouched",
    name: "Pristine",
    description: "Win without losing a core.",
    earned: (s) => won(s) && s.coresLost === 0,
  },
  {
    id: "captures_25",
    name: "Hostile Takeover",
    description: "Capture 25 cells in one game.",
    earned: (s) => s.captures >= 25,
  },
  {
    id: "predator_feast",
    name: "Feeding Frenzy",
    description: "Gain 30 N from captures as Predator in one game.",
    earned: (s) => s.strain === "predator" && s.nutrientsFromCaptures >= 30,
  },
  {
    id: "swarmer_win",
    name: "Everywhere At Once",
    description: "Win as Swarmer.",
    earned: (s) => won(s) && s.strain === "swarmer",
  },
  {
    id: "biofilm_win",
    name: "Slow and Steady",
    description: "Win as Biofilm.",
    earned: (s) => won(s) && s.strain === "biofilm",
  },
  {
    id: "predator_win",
    name: "Apex",
    description: "Win as Predator.",
    earned: (s) => won(s) && s.strain === "predator",
  },
  {
    id: "sporer_win",
    name: "Seed the Stars",
    description: "Win as Sporer.",
    earned: (s) => won(s) && s.strain === "sporer",
  },
  {
    id: "three_mutations",
    name: "Fully Adapted",
    description: "Draft 3 mutations in one game.",
    earned: (s) => s.mutations.length >= 3,
  },
  {
    id: "no_retract",
    name: "No Step Back",
    description: "Win without retracting a cell.",
    earned: (s) => won(s) && s.retracts === 0 && s.ordersIssued > 0,
  },
  {
    id: "frugal",
    name: "Hoarder",
    description: "Bank 150 N at once.",
    earned: (s) => s.maxNutrients >= 150,
  },
  {
    id: "flare_proof",
    name: "Sunblock",
    description: "Win a star-system game without a single flare hit.",
    earned: (s) => won(s) && s.map === "system" && s.flareHits === 0 && s.turns >= 12,
  },
  {
    id: "comet_rider",
    name: "Comet Rider",
    description: "Feed from a comet deposit for 4 turns in one game.",
    earned: (s) => s.cometIncomeTurns >= 4,
  },
  {
    id: "beat_hard",
    name: "Outgrown",
    description: "Beat the Hard bot.",
    earned: (s) => won(s) && s.context.difficulty === "hard",
  },
  {
    id: "ffa_win",
    name: "King of the Hill",
    description: "Win a game with 4 players.",
    earned: (s) => won(s) && s.players >= 4,
  },
  {
    id: "online_win",
    name: "Contagious",
    description: "Win an online game.",
    earned: (s) => won(s) && (s.context.mode === "online" || s.context.mode === "ranked"),
  },
  {
    id: "ranked_win",
    name: "Ranked Culture",
    description: "Win a ranked game.",
    earned: (s) => won(s) && s.context.mode === "ranked",
  },
];

export function earnedAchievements(s: GameSummary): string[] {
  return ACHIEVEMENTS.filter((a) => a.earned(s)).map((a) => a.id);
}

export function achievementInfo(id: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}
