/**
 * Wire protocol (SPEC §9.4): zod schemas and TypeScript types for every WebSocket message and
 * REST payload. The client and server both validate with these, so a malformed or hostile
 * message is rejected at the edge. Game rules are not checked here; the sim does that.
 */
import { z } from "zod";
import type { GameState, Order } from "@swarm/sim";

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
]);
/** The sim enforces the real order limit (12); this only bounds message size. */
export const OrderSetSchema = z.array(OrderSchema).max(32);

export const StrainSchema = z.enum(["swarmer", "biofilm"]);
export type Strain = z.infer<typeof StrainSchema>;

/** SPEC §3 turn timer presets, in seconds. */
export const LIVE_TIMERS = [45, 60, 90] as const;
export const ASYNC_TIMERS = [12 * 3600, 24 * 3600, 48 * 3600] as const;

export const GameSettingsSchema = z
  .object({
    pace: z.enum(["live", "async"]),
    turnSeconds: z.number().int(),
    map: z.literal("singleRock"),
    players: z.literal(2),
  })
  .refine(
    (s) => (s.pace === "live" ? LIVE_TIMERS : ASYNC_TIMERS).includes(s.turnSeconds as never),
    "turnSeconds must be one of the presets for this pace",
  );
export type GameSettings = z.infer<typeof GameSettingsSchema>;

export const DEFAULT_SETTINGS: Record<GameSettings["pace"], GameSettings> = {
  live: { pace: "live", turnSeconds: 60, map: "singleRock", players: 2 },
  async: { pace: "async", turnSeconds: 24 * 3600, map: "singleRock", players: 2 },
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
  strains: z.array(StrainSchema),
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
