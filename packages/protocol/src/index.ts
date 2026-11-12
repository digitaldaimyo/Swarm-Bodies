/**
 * Wire protocol (SPEC §9.4): zod schemas and TypeScript types for every WebSocket message and
 * REST payload. The client and server both validate with these, so a malformed or hostile
 * message is rejected at the edge. Game rules are not checked here; the sim does that.
 */
import { z } from "zod";
import { MUTATION_IDS, type GameState, type MutationId, type Order } from "@swarm/sim";

export const PROTOCOL_VERSION = 1;

// ------------------------------------------------------------------------------------------
// Game data

export const HexSchema = z.object({
  q: z.number().int().min(-64).max(64),
  r: z.number().int().min(-64).max(64),
});

export const OrderSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("grow"),
    body: z.number().int().min(0).max(16),
    path: z.array(HexSchema).min(1).max(16),
  }),
  z.object({
    type: z.literal("reinforce"),
    body: z.number().int().min(0).max(16),
    cell: HexSchema,
  }),
  z.object({ type: z.literal("retract"), body: z.number().int().min(0).max(16), cell: HexSchema }),
  z.object({ type: z.literal("fruit"), body: z.number().int().min(0).max(16), cell: HexSchema }),
  z.object({
    type: z.literal("launch"),
    body: z.number().int().min(0).max(16),
    cell: HexSchema,
    targetBody: z.number().int().min(0).max(16),
    targetCell: HexSchema,
  }),
  z.object({
    type: z.literal("draft"),
    mutation: z.enum(MUTATION_IDS as [MutationId, ...MutationId[]]),
  }),
]);
/** The sim enforces the real order limit (12); this only bounds message size. */
export const OrderSetSchema = z.array(OrderSchema).max(32);

export const StrainSchema = z.enum(["swarmer", "biofilm", "predator", "sporer"]);
export type Strain = z.infer<typeof StrainSchema>;

/** SPEC §3 turn timer presets, in seconds. */
export const LIVE_TIMERS = [45, 60, 90] as const;
export const ASYNC_TIMERS = [12 * 3600, 24 * 3600, 48 * 3600] as const;

export const GameSettingsSchema = z
  .object({
    pace: z.enum(["live", "async"]),
    turnSeconds: z.number().int(),
    map: z.enum(["singleRock", "system"]),
    players: z.number().int().min(2).max(4),
  })
  .refine((s) => s.map === "system" || s.players === 2, "Single Rock is a 2-player test map")
  .refine(
    (s) => (s.pace === "live" ? LIVE_TIMERS : ASYNC_TIMERS).includes(s.turnSeconds as never),
    "turnSeconds must be one of the presets for this pace",
  );
export type GameSettings = z.infer<typeof GameSettingsSchema>;

export const DEFAULT_SETTINGS: Record<GameSettings["pace"], GameSettings> = {
  live: { pace: "live", turnSeconds: 60, map: "system", players: 2 },
  async: { pace: "async", turnSeconds: 24 * 3600, map: "system", players: 2 },
};

export const PlayerMetaSchema = z.object({
  seat: z.number().int(),
  name: z.string(),
  strain: StrainSchema,
  connected: z.boolean(),
  /** A Normal bot is playing for this seat after 3 missed live turns (SPEC §3). */
  botControlled: z.boolean(),
  submitted: z.boolean(),
  you: z.boolean(),
});
export type PlayerMeta = z.infer<typeof PlayerMetaSchema>;

export const GameStatusSchema = z.enum(["lobby", "active", "finished"]);

export const GameMetaSchema = z.object({
  gameId: z.string(),
  code: z.string(),
  status: GameStatusSchema,
  settings: GameSettingsSchema,
  players: z.array(PlayerMetaSchema),
  hostSeat: z.number().int(),
  turn: z.number().int(),
  /** ISO time the current turn resolves at the latest, or null when not running. */
  deadline: z.string().nullable(),
  /** M7: a ranked ladder game, and the season sector's name when it changes the map. */
  ranked: z.boolean().optional(),
  sector: z.string().nullable().optional(),
});
export type GameMeta = z.infer<typeof GameMetaSchema>;

export const GameResultSchema = z.object({
  winner: z.number().int().nullable(),
  reason: z.enum(["lastStanding", "dominance", "turnLimit", "draw"]),
  turn: z.number().int(),
});

/** A serialized GameState is checked by the sim (deserialize), not re-described here. */
const GameStateJson = z.custom<GameState>(
  (v) => typeof v === "object" && v !== null && (v as { version?: unknown }).version === 1,
);

// ------------------------------------------------------------------------------------------
// WebSocket: client → server

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    authToken: z.string().min(16).max(128),
    clientVersion: z.string().max(32),
  }),
  z.object({ type: z.literal("subscribe"), gameId: z.string().max(64) }),
  z.object({
    type: z.literal("submitOrders"),
    gameId: z.string().max(64),
    turn: z.number().int().min(1),
    orders: OrderSetSchema,
    draftPick: z.string().max(64).optional(),
  }),
  z.object({
    type: z.literal("unsubmit"),
    gameId: z.string().max(64),
    turn: z.number().int().min(1),
  }),
  /** Ask for a fresh `gameState`, e.g. after a hash mismatch (SPEC §9.4). */
  z.object({ type: z.literal("requestState"), gameId: z.string().max(64) }),
  /** Reported to the server log after a mismatch (SPEC §9.4). */
  z.object({
    type: z.literal("hashMismatch"),
    gameId: z.string().max(64),
    turn: z.number().int(),
    clientHash: z.string().max(64),
    serverHash: z.string().max(64),
  }),
  z.object({ type: z.literal("ping") }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

// ------------------------------------------------------------------------------------------
// WebSocket: server → client

export const ServerMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("welcome"), accountId: z.string(), name: z.string() }),
  z.object({ type: z.literal("lobby"), meta: GameMetaSchema }),
  z.object({ type: z.literal("gameState"), meta: GameMetaSchema, state: GameStateJson.nullable() }),
  z.object({
    type: z.literal("playerSubmitted"),
    gameId: z.string(),
    seat: z.number().int(),
    turn: z.number().int(),
    submitted: z.boolean(),
  }),
  z.object({
    type: z.literal("playerStatus"),
    gameId: z.string(),
    seat: z.number().int(),
    connected: z.boolean(),
    botControlled: z.boolean(),
  }),
  z.object({
    type: z.literal("turnResolved"),
    gameId: z.string(),
    turn: z.number().int(),
    /** Keyed by seat. */
    ordersByPlayer: z.record(z.string(), OrderSetSchema),
    stateHash: z.string(),
    nextDeadline: z.string().nullable(),
  }),
  z.object({ type: z.literal("gameOver"), gameId: z.string(), result: GameResultSchema }),
  z.object({ type: z.literal("error"), code: z.string(), message: z.string() }),
  z.object({ type: z.literal("pong") }),
]);
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

// ------------------------------------------------------------------------------------------
// REST (/api)

export const GuestResponseSchema = z.object({
  token: z.string(),
  accountId: z.string(),
  name: z.string(),
});
export const CreateGameRequestSchema = z.object({
  settings: GameSettingsSchema,
  strain: StrainSchema,
});
export const CreateGameResponseSchema = z.object({ gameId: z.string(), code: z.string() });
export const JoinGameRequestSchema = z.object({ strain: StrainSchema });
export const JoinGameResponseSchema = z.object({ gameId: z.string() });
export const StrainChangeRequestSchema = z.object({ strain: StrainSchema });
export const GameSummarySchema = z.object({
  gameId: z.string(),
  code: z.string(),
  status: GameStatusSchema,
  pace: z.enum(["live", "async"]),
  turn: z.number().int(),
  opponents: z.array(z.string()),
  /** The game is running and you have not submitted this turn. */
  yourTurn: z.boolean(),
  deadline: z.string().nullable(),
});
export type GameSummary = z.infer<typeof GameSummarySchema>;
export const GameListResponseSchema = z.object({ games: z.array(GameSummarySchema) });
export const QueueRequestSchema = z.object({
  pace: z.enum(["live", "async"]),
  strain: StrainSchema,
  /** M7: a ranked ladder game (SPEC §11.2). */
  ranked: z.boolean().optional(),
  /** M7: 2 for a duel, 3 or 4 for a free-for-all. */
  players: z.number().int().min(2).max(4).optional(),
});
export const QueueResponseSchema = z.object({
  status: z.enum(["queued", "matched"]),
  gameId: z.string().nullable(),
});
export const PushSubscribeRequestSchema = z.object({
  endpoint: z.string().url().max(1024),
  keys: z.object({ p256dh: z.string().max(256), auth: z.string().max(256) }),
});
export const PushKeyResponseSchema = z.object({ publicKey: z.string().nullable() });
export const ReplayResponseSchema = z.object({
  gameId: z.string(),
  seed: z.string(),
  map: z.enum(["singleRock", "system"]),
  strains: z.array(StrainSchema),
  /** M7: rule overrides the game was created with (a ranked sector), if any. */
  rules: z.record(z.string(), z.unknown()).nullable().optional(),
  names: z.array(z.string()).optional(),
  ranked: z.boolean().optional(),
  turns: z.array(z.record(z.string(), OrderSetSchema)),
  result: GameResultSchema.nullable(),
});
export type ReplayResponse = z.infer<typeof ReplayResponseSchema>;
export const ErrorResponseSchema = z.object({ code: z.string(), message: z.string() });
export const OkResponseSchema = z.object({ ok: z.literal(true) });

/** Orders arrive keyed by seat as strings (JSON); the sim wants numeric player ids. */
export function ordersBySeat(record: Record<string, Order[]>): Record<number, Order[]> {
  const out: Record<number, Order[]> = {};
  for (const k of Object.keys(record).sort()) out[Number(k)] = record[k] as Order[];
  return out;
}

/** Parses one raw WebSocket frame, returning null for anything that does not validate. */
export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const r = ClientMessageSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const r = ServerMessageSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------------
// M7: progress sync, Daily Seed, ranked ladder (SPEC §11)

const Id = z.string().min(1).max(32);

/** Player progress (content's Progress): every list only grows, so the server merges by union. */
export const ProgressSchema = z.object({
  version: z.literal(1),
  completedNodes: z.array(Id).max(64),
  drafted: z.array(z.enum(MUTATION_IDS as [MutationId, ...MutationId[]])).max(32),
  achievements: z.array(Id).max(128),
  rewards: z.array(Id).max(64),
  selected: z.object({ palette: Id, vein: Id, trail: Id }),
});
export type ProgressJson = z.infer<typeof ProgressSchema>;
export const ProgressResponseSchema = z.object({ progress: ProgressSchema });

/** Daily Seed (SPEC §3): your orders for every turn, replayed by the server against its bot. */
export const DailySubmitRequestSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  turns: z.array(OrderSetSchema).min(1).max(200),
});
export const DailyEntrySchema = z.object({
  rank: z.number().int(),
  name: z.string(),
  score: z.number().int(),
  outcome: z.enum(["win", "loss", "draw"]),
  turns: z.number().int(),
  you: z.boolean(),
});
export type DailyEntry = z.infer<typeof DailyEntrySchema>;
export const DailyResponseSchema = z.object({
  date: z.string(),
  entries: z.array(DailyEntrySchema),
  me: DailyEntrySchema.nullable(),
  /** Consecutive days with a submission, ending today or yesterday. */
  streak: z.number().int(),
  players: z.number().int(),
});
export type DailyResponse = z.infer<typeof DailyResponseSchema>;
export const DailySubmitResponseSchema = z.object({
  score: z.number().int(),
  /** False when an earlier run today scored higher (the best one is kept). */
  best: z.boolean(),
  rank: z.number().int(),
  streak: z.number().int(),
});
export type DailySubmitResponse = z.infer<typeof DailySubmitResponseSchema>;

/** Ranked ladder (SPEC §11.2): 1v1 duels and 3–4 player free-for-alls, per season. */
export const LadderModeSchema = z.enum(["duel", "ffa"]);
export type LadderMode = z.infer<typeof LadderModeSchema>;
export const LadderEntrySchema = z.object({
  rank: z.number().int(),
  name: z.string(),
  rating: z.number().int(),
  deviation: z.number().int(),
  games: z.number().int(),
  wins: z.number().int(),
  you: z.boolean(),
});
export type LadderEntry = z.infer<typeof LadderEntrySchema>;
export const LadderResponseSchema = z.object({
  mode: LadderModeSchema,
  season: z.number().int(),
  sector: z.object({ id: z.string(), name: z.string(), description: z.string() }),
  endsAt: z.string(),
  entries: z.array(LadderEntrySchema),
  /** Your standing, ranked or provisional (rank 0 until placed). */
  me: LadderEntrySchema.nullable(),
});
export type LadderResponse = z.infer<typeof LadderResponseSchema>;
