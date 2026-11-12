import { PLAYABLE_STRAINS, type GameConfig } from "@swarm/sim";
import type { GameSummary } from "./summary";

/**
 * The Daily Seed (SPEC §3): one system per day for everyone, against the Normal bot. The date
 * is the UTC day; strains rotate by day so every player faces the same matchup and leaderboard
 * scores compare.
 */
export interface DailySetup {
  date: string;
  seed: string;
  config: GameConfig;
  /** The bot's seed for chooseOrders: fixed per day, so the server can replay it. */
  botSeed: string;
}

const DAY_MS = 86_400_000;

export function dailyDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isDailyDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) && dailyDate(ms) === date;
}

export function dailySetup(date: string): DailySetup {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
  const n = PLAYABLE_STRAINS.length;
  const you = PLAYABLE_STRAINS[((day % n) + n) % n] as (typeof PLAYABLE_STRAINS)[number];
  const bot = PLAYABLE_STRAINS[(((day + 1) % n) + n) % n] as (typeof PLAYABLE_STRAINS)[number];
  return {
    date,
    seed: `daily-${date}`,
    config: { mode: "system", playerCount: 2, strains: [you, bot] },
    botSeed: `daily-bot-${date}`,
  };
}

/**
 * Daily score: a win is worth 1000 plus 20 per turn under the limit; everyone also scores half
 * their final dominance in per-mille (so 0–500), which ranks losses and close wins.
 */
export function dailyScore(s: GameSummary, turnLimit: number): number {
  const base = s.outcome === "win" ? 1000 + Math.max(0, turnLimit - s.turns) * 20 : 0;
  return base + Math.floor(s.finalDominance / 2);
}
