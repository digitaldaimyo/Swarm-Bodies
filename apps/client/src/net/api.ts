import type { ZodType } from "zod";
import type { OrderSet } from "@swarm/sim";
import { apiUrl } from "./origin";
import {
  CreateGameResponseSchema,
  ErrorResponseSchema,
  GameListResponseSchema,
  GameMetaSchema,
  GuestResponseSchema,
  JoinGameResponseSchema,
  ProgressResponseSchema,
  DailyResponseSchema,
  DailySubmitResponseSchema,
  LadderResponseSchema,
  OkResponseSchema,
  PushKeyResponseSchema,
  QueueResponseSchema,
  ReplayResponseSchema,
  type GameMeta,
  type GameSettings,
  type GameSummary,
  type ProgressJson,
  type DailyResponse,
  type DailySubmitResponse,
  type LadderMode,
  type LadderResponse,
  type ReplayResponse,
  type Strain,
} from "@swarm/protocol";

/** REST client for /api (SPEC §9.4). Responses are validated with the shared schemas. */

const TOKEN_KEY = "swarm.guest.v1";

export interface Guest {
  token: string;
  accountId: string;
  name: string;
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function loadGuest(): Guest | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as Guest) : null;
  } catch {
    return null;
  }
}

function storeGuest(g: Guest): void {
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(g));
  } catch {
    // Without storage the guest lasts for this tab only.
  }
}

let guest: Guest | null = null;

async function request<T>(
  method: string,
  path: string,
  schema: ZodType<T>,
  body?: unknown,
  auth = true,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (auth) headers["authorization"] = `Bearer ${(await ensureGuest()).token}`;
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError("offline", "Can't reach the server. Check your connection.", 0);
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = ErrorResponseSchema.safeParse(json);
    if (res.status === 401 && auth) {
      // The server forgot us (fresh database): get a new guest once and retry.
      guest = null;
      try {
        localStorage.removeItem(TOKEN_KEY);
      } catch {
        // ignore
      }
    }
    throw new ApiError(
      err.success ? err.data.code : "http",
      err.success ? err.data.message : `Server error ${res.status}`,
      res.status,
    );
  }
  return schema.parse(json);
}

let creating: Promise<Guest> | null = null;

/** Whether this device already has an account (progress sync never creates one). */
export function hasGuest(): boolean {
  guest ??= loadGuest();
  return guest !== null;
}

/**
 * The guest account for this device, created on first use. Concurrent callers (the socket and
 * the first REST call) share one request, so a device never ends up as two guests.
 */
export async function ensureGuest(): Promise<Guest> {
  guest ??= loadGuest();
  if (guest) return guest;
  creating ??= request("POST", "/guest", GuestResponseSchema, undefined, false)
    .then((g) => {
      guest = g;
      storeGuest(g);
      return g;
    })
    .finally(() => {
      creating = null;
    });
  return creating;
}

export const api = {
  createGame: (settings: GameSettings, strain: Strain) =>
    request("POST", "/games", CreateGameResponseSchema, { settings, strain }),
  joinGame: (code: string, strain: Strain) =>
    request(
      "POST",
      `/games/${encodeURIComponent(code.trim().toUpperCase())}/join`,
      JoinGameResponseSchema,
      { strain },
    ),
  startGame: (gameId: string) => request("POST", `/games/${gameId}/start`, OkResponseSchema),
  setStrain: (gameId: string, strain: Strain) =>
    request("POST", `/games/${gameId}/strain`, OkResponseSchema, { strain }),
  listGames: async (): Promise<GameSummary[]> =>
    (await request("GET", "/games", GameListResponseSchema)).games,
  getGame: (gameId: string): Promise<GameMeta> =>
    request("GET", `/games/${gameId}`, GameMetaSchema),
  queue: (pace: GameSettings["pace"], strain: Strain, ranked?: { players: number }) =>
    request("POST", "/queue", QueueResponseSchema, {
      pace,
      strain,
      ...(ranked ? { ranked: true, players: ranked.players } : {}),
    }),
  leaveQueue: () => request("DELETE", "/queue", OkResponseSchema),
  pushKey: () => request("GET", "/push/key", PushKeyResponseSchema, undefined, false),
  pushSubscribe: (sub: PushSubscriptionJSON) =>
    request("POST", "/push/subscribe", OkResponseSchema, sub),
  daily: (): Promise<DailyResponse> => request("GET", "/daily", DailyResponseSchema),
  submitDaily: (date: string, turns: OrderSet[]): Promise<DailySubmitResponse> =>
    request("POST", "/daily", DailySubmitResponseSchema, { date, turns }),
  ladder: (mode: LadderMode): Promise<LadderResponse> =>
    request("GET", `/ladder?mode=${mode}`, LadderResponseSchema),
  putProgress: async (progress: ProgressJson): Promise<ProgressJson> =>
    (await request("PUT", "/progress", ProgressResponseSchema, { progress })).progress,
  replay: (gameId: string): Promise<ReplayResponse> =>
    request("GET", `/replays/${gameId}`, ReplayResponseSchema),
};
