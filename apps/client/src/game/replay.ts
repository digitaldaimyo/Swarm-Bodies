import { z } from "zod";
import { OrderSetSchema, ordersBySeat, type ReplayResponse } from "@swarm/protocol";
import type { GameConfig, Order, Rules, StrainId } from "@swarm/sim";
import type { MatchSession, TurnRecord } from "./match-session";
import { appLink } from "../net/origin";

/**
 * Shareable replays (SPEC §12): a game is its seed, config and orders, so a replay is tiny and
 * plays back exactly through the sim. Online games are linked at /replay/:id; any game can be
 * exported to a file and opened again.
 */
export interface ReplayFile {
  format: "swarm-bodies-replay";
  version: 1;
  title: string;
  seed: string;
  config: GameConfig;
  names: string[];
  turns: Record<string, Order[]>[];
}

const ReplayFileSchema = z.object({
  format: z.literal("swarm-bodies-replay"),
  version: z.literal(1),
  title: z.string().max(200),
  seed: z.string().min(1).max(200),
  config: z.object({
    mode: z.enum(["singleRock", "system"]),
    playerCount: z.number().int().min(2).max(4),
    strains: z.array(z.enum(["base", "swarmer", "biofilm", "predator", "sporer"])).max(4),
    rules: z.record(z.string(), z.unknown()).optional(),
  }),
  names: z.array(z.string().max(64)).max(4),
  turns: z.array(z.record(z.string(), OrderSetSchema)).max(200),
});

/** Validates an imported file; null when it is not a replay. */
export function parseReplayFile(json: unknown): ReplayFile | null {
  const r = ReplayFileSchema.safeParse(json);
  return r.success ? (r.data as ReplayFile) : null;
}

/** The replay of a finished (or running) local session. */
export function replayFromSession(s: MatchSession, title: string): ReplayFile {
  const first = s.history[0]?.before ?? s.state;
  return {
    format: "swarm-bodies-replay",
    version: 1,
    title,
    seed: first.seed,
    config: {
      mode: first.mode,
      playerCount: first.players.length,
      strains: first.players.map((p) => p.strain),
      rules: first.rules,
    },
    names: first.players.map((p) => s.name(p.id)),
    turns: s.history.map((h) => {
      const out: Record<string, Order[]> = {};
      for (const k of Object.keys(h.orders).sort()) out[k] = h.orders[Number(k)] as Order[];
      return out;
    }),
  };
}

/** The replay of a finished online game, from GET /api/replays/:id. */
export function replayFromResponse(r: ReplayResponse): ReplayFile {
  return {
    format: "swarm-bodies-replay",
    version: 1,
    title: `${r.ranked ? "Ranked" : "Online"} game`,
    seed: r.seed,
    config: {
      mode: r.map,
      playerCount: r.strains.length,
      strains: r.strains as StrainId[],
      ...(r.rules ? { rules: r.rules as Partial<Rules> } : {}),
    },
    names: r.names ?? r.strains.map((_, i) => `Player ${i + 1}`),
    turns: r.turns as Record<string, Order[]>[],
  };
}

/** Plays the replay through the sim, turn by turn. */
export async function replayHistory(file: ReplayFile): Promise<TurnRecord[]> {
  const { createGame, resolveTurn } = await import("@swarm/sim");
  let state = createGame(file.config, file.seed);
  const out: TurnRecord[] = [];
  for (const t of file.turns) {
    if (state.result) break;
    const orders = ordersBySeat(t);
    const r = resolveTurn(state, orders);
    out.push({ before: state, after: r.state, orders, events: r.events });
    state = r.state;
  }
  return out;
}

/** Saves the replay as a .json file (no server needed). */
export function downloadReplay(file: ReplayFile): void {
  const blob = new Blob([JSON.stringify(file)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `swarm-replay-${file.seed.replace(/[^\w-]+/g, "_").slice(0, 40)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The shareable link of a finished online game. */
export function replayLink(gameId: string): string {
  return appLink(`replay/${gameId}`);
}
