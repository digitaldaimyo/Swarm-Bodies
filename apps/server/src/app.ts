import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import rateLimit from "@fastify/rate-limit";
import type { ZodType } from "zod";
import {
  ClientErrorReportSchema,
  CreateGameRequestSchema,
  DailySubmitRequestSchema,
  GoogleSignInRequestSchema,
  NameChangeRequestSchema,
  playerName,
  LadderModeSchema,
  ProgressSchema,
  JoinGameRequestSchema,
  parseClientMessage,
  PushSubscribeRequestSchema,
  QueueRequestSchema,
  StrainChangeRequestSchema,
  type ServerMessage,
} from "@swarm/protocol";
import { z } from "zod";
import { GameEngine, GameError, type Account, type Connection } from "./engine";
import type { Progression } from "./progression";
import type { GoogleVerifier } from "./google";
import type { ErrorLog } from "./errors";

/** Request budgets per client IP (docs/plans/beta.md, step 2). */
export interface Limits {
  /** Every /api request. */
  api: { max: number; windowMs: number };
  /** Creating a guest. */
  guest: { max: number; windowMs: number };
  /** Google sign-in. */
  signIn: { max: number; windowMs: number };
  /** Client error reports. */
  errors: { max: number; windowMs: number };
  /** WebSocket messages per connection per 10 s. */
  wsPer10s: number;
}

export const DEFAULT_LIMITS: Limits = {
  api: { max: 300, windowMs: 60_000 },
  guest: { max: 30, windowMs: 3_600_000 },
  signIn: { max: 30, windowMs: 600_000 },
  errors: { max: 30, windowMs: 600_000 },
  // A busy player sends a few messages a turn; this only stops floods.
  wsPer10s: 100,
};

const MAX_WS_MESSAGE = 64 * 1024;

export interface AppOptions {
  engine: GameEngine;
  progression: Progression;
  logger?: boolean;
  /** The built client (apps/client/dist) to serve at "/", with an SPA fallback. */
  clientDir?: string | undefined;
  /** Other origins allowed to call the API (the GitHub Pages copy of the client). */
  corsOrigins?: readonly string[];
  /** Checks Sign in with Google tokens (beta plan, step 1); tests pass a fake. */
  googleVerify?: GoogleVerifier;
  /** Client error reports (beta plan, step 2). */
  errorLog?: ErrorLog;
  /** Request budgets; `false` turns them off (e2e runs make hundreds of guests). */
  limits?: Limits | false;
  /**
   * Proxy hops to trust for the client's address: 1 behind Render's proxy, so the address is
   * the one Render saw, not one the client wrote into X-Forwarded-For.
   */
  trustProxy?: number | false;
}

/** HTTP and WebSocket front end (SPEC §9.4). All game logic lives in GameEngine. */
export async function buildApp({
  engine,
  progression,
  logger = false,
  clientDir,
  corsOrigins = [],
  googleVerify,
  errorLog,
  limits = DEFAULT_LIMITS,
  trustProxy = false,
}: AppOptions): Promise<FastifyInstance> {
  const hops = trustProxy === false ? 0 : trustProxy;
  // Trust exactly `hops` proxies in front of us (proxy-addr counts them from the server out).
  const app = Fastify({
    logger,
    bodyLimit: 64 * 1024,
    trustProxy: (_address: string, hop: number) => hop < hops,
  });
  if (limits)
    await app.register(rateLimit, {
      max: limits.api.max,
      timeWindow: limits.api.windowMs,
      // Only the API: the client's own files and the WebSocket upgrade are not budgeted here.
      allowList: (req) => !req.url.startsWith("/api/"),
      errorResponseBuilder: (_req, ctx) => ({
        statusCode: ctx.statusCode,
        code: "rateLimited",
        message: `Too many requests. Try again in ${Math.ceil(ctx.ttl / 1000)} s.`,
      }),
    });
  const budget = (l: { max: number; windowMs: number } | undefined) =>
    l ? { config: { rateLimit: { max: l.max, timeWindow: l.windowMs } } } : {};
  await app.register(websocket, { options: { maxPayload: MAX_WS_MESSAGE } });
  // Auth is a bearer token in a header (never a cookie), so allowing listed origins is safe.
  if (corsOrigins.length > 0)
    await app.register(cors, {
      origin: [...corsOrigins],
      methods: ["GET", "POST", "PUT", "DELETE"],
      allowedHeaders: ["authorization", "content-type"],
      maxAge: 86_400,
    });
  if (clientDir) {
    await app.register(fastifyStatic, {
      root: clientDir,
      cacheControl: false,
      // Hashed assets never change; the shell, manifest and service worker must revalidate.
      setHeaders: (res, path) => {
        res.setHeader(
          "cache-control",
          /[\\/]assets[\\/]/.test(path) ? "public, max-age=31536000, immutable" : "no-cache",
        );
      },
    });
    // SPA fallback: app routes such as /replay/:id get the shell; unknown API paths stay 404.
    app.setNotFoundHandler((req, reply) => {
      const url = req.url.split("?")[0] ?? "";
      // A missing hashed asset is a stale page asking for an old build: say so plainly (the
      // client reloads), rather than answering a script request with the HTML shell.
      if (
        req.method === "GET" &&
        !url.startsWith("/api/") &&
        !url.startsWith("/assets/") &&
        url !== "/ws"
      )
        return reply.header("cache-control", "no-cache").sendFile("index.html");
      return reply.status(404).send({ code: "notFound", message: "Not found" });
    });
  }

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof GameError)
      return reply.status(err.status).send({ code: err.code, message: err.message });
    // The rate limiter's own error (errorResponseBuilder above).
    const limited = err as { statusCode?: number; code?: string; message?: string };
    if (limited.statusCode === 429)
      return reply
        .status(429)
        .send({ code: "rateLimited", message: limited.message ?? "Too many requests" });
    if ((err as { validation?: unknown }).validation)
      return reply
        .status(400)
        .send({ code: "badRequest", message: String((err as Error).message) });
    app.log.error(err);
    return reply.status(500).send({ code: "internal", message: "Something went wrong" });
  });

  const parse = <T>(schema: ZodType<T>, body: unknown): T => {
    const r = schema.safeParse(body);
    if (!r.success)
      throw new GameError(
        "badRequest",
        r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      );
    return r.data;
  };
  const bearer = (req: FastifyRequest): string | null => {
    const header = req.headers.authorization ?? "";
    return header.startsWith("Bearer ") ? header.slice(7) : null;
  };
  const auth = async (req: FastifyRequest): Promise<Account> => {
    const account = await engine.authenticate(bearer(req));
    if (!account) throw new GameError("unauthorized", "Sign in as a guest first", 401);
    return account;
  };
  const ok = (reply: FastifyReply, body: unknown) =>
    reply.header("cache-control", "no-store").send(body);

  app.get("/api/health", async () => ({ ok: true }));
  app.post("/api/guest", budget(limits ? limits.guest : undefined), async (_req, reply) =>
    ok(reply, await engine.createGuest()),
  );
  app.post("/api/errors", budget(limits ? limits.errors : undefined), async (req, reply) => {
    const report = parse(ClientErrorReportSchema, req.body);
    await errorLog?.record(report);
    return ok(reply, { ok: true });
  });
  // Accounts (docs/plans/beta.md, step 1).
  app.get("/api/me", async (req, reply) => ok(reply, await engine.me(await auth(req))));
  app.put("/api/me/name", async (req, reply) => {
    const account = await auth(req);
    const name = playerName(parse(NameChangeRequestSchema, req.body));
    await engine.rename(account, name);
    return ok(reply, await engine.me({ ...account, name }));
  });
  app.delete("/api/me", async (req, reply) => {
    await engine.deleteAccount(await auth(req));
    return ok(reply, { ok: true });
  });
  app.post("/api/auth/google", budget(limits ? limits.signIn : undefined), async (req, reply) => {
    if (!googleVerify) throw new GameError("unavailable", "Google sign-in is not set up", 503);
    const { credential } = parse(GoogleSignInRequestSchema, req.body);
    let sub: string;
    try {
      sub = await googleVerify(credential);
    } catch {
      throw new GameError("unauthorized", "Google sign-in could not be verified", 401);
    }
    const callerToken = bearer(req);
    const caller = await engine.authenticate(callerToken);
    const r = await engine.googleSignIn(caller, sub);
    // Another device's guest signing in to an existing account: its progress comes along
    // (union merge, as everywhere); its rating and games stay where they were.
    if (r.switched && caller) {
      const theirs = await progression.syncProgress(caller, null);
      await progression.syncProgress({ id: r.accountId, name: r.name }, theirs);
    }
    return ok(reply, {
      token: r.token ?? callerToken,
      accountId: r.accountId,
      name: r.name,
      google: true,
      switched: r.switched,
    });
  });
  app.post("/api/games", async (req, reply) => {
    const account = await auth(req);
    const body = parse(CreateGameRequestSchema, req.body);
    return ok(reply, await engine.createGame(account, body.settings, body.strain));
  });
  app.post<{ Params: { code: string } }>("/api/games/:code/join", async (req, reply) => {
    const account = await auth(req);
    const body = parse(JoinGameRequestSchema, req.body);
    return ok(reply, await engine.joinGame(account, req.params.code, body.strain));
  });
  app.post<{ Params: { id: string } }>("/api/games/:id/start", async (req, reply) => {
    await engine.startGame(await auth(req), req.params.id);
    return ok(reply, { ok: true });
  });
  app.post<{ Params: { id: string } }>("/api/games/:id/strain", async (req, reply) => {
    const account = await auth(req);
    await engine.setStrain(
      account,
      req.params.id,
      parse(StrainChangeRequestSchema, req.body).strain,
    );
    return ok(reply, { ok: true });
  });
  app.get("/api/games", async (req, reply) =>
    ok(reply, { games: await engine.listGames(await auth(req)) }),
  );
  app.get<{ Params: { id: string } }>("/api/games/:id", async (req, reply) =>
    ok(reply, await engine.getMeta(req.params.id, await auth(req))),
  );
  app.post("/api/queue", async (req, reply) => {
    const account = await auth(req);
    const body = parse(QueueRequestSchema, req.body);
    return ok(
      reply,
      await engine.enqueue(account, body.pace, body.strain, {
        ...(body.ranked !== undefined ? { ranked: body.ranked } : {}),
        ...(body.players !== undefined ? { players: body.players } : {}),
      }),
    );
  });
  app.delete("/api/queue", async (req, reply) => {
    engine.dequeue(await auth(req));
    return ok(reply, { ok: true });
  });
  app.get("/api/push/key", async (_req, reply) => ok(reply, { publicKey: engine.pushPublicKey }));
  app.post("/api/push/subscribe", async (req, reply) => {
    const account = await auth(req);
    const body = parse(PushSubscribeRequestSchema, req.body);
    await engine.subscribePush(account, body.endpoint, body.keys.p256dh, body.keys.auth);
    return ok(reply, { ok: true });
  });
  // M7 progression (SPEC §11): progress sync, Daily Seed, ranked ladder.
  app.get("/api/progress", async (req, reply) =>
    ok(reply, { progress: await progression.syncProgress(await auth(req), null) }),
  );
  app.put("/api/progress", async (req, reply) => {
    const account = await auth(req);
    const body = parse(z.object({ progress: ProgressSchema }), req.body);
    return ok(reply, { progress: await progression.syncProgress(account, body.progress) });
  });
  app.get<{ Querystring: { date?: string } }>("/api/daily", async (req, reply) =>
    ok(reply, await progression.daily(await auth(req), req.query.date)),
  );
  app.post("/api/daily", async (req, reply) => {
    const account = await auth(req);
    const body = parse(DailySubmitRequestSchema, req.body);
    return ok(reply, await progression.submitDaily(account, body.date, body.turns));
  });
  app.get<{ Querystring: { mode?: string; season?: string } }>(
    "/api/ladder",
    async (req, reply) => {
      const account = await auth(req);
      const mode = parse(LadderModeSchema, req.query.mode ?? "duel");
      const season =
        req.query.season === undefined
          ? undefined
          : parse(z.coerce.number().int().min(0).max(10_000), req.query.season);
      return ok(reply, await progression.ladder(account, mode, season));
    },
  );

  app.get<{ Params: { id: string } }>("/api/replays/:id", async (req, reply) => {
    const r = await engine.replay(req.params.id);
    return ok(reply, { gameId: req.params.id, ...r });
  });

  // One WebSocket per client; `hello` must come first (SPEC §9.4).
  app.get("/ws", { websocket: true }, (socket, req) => {
    let conn: Connection | null = null;
    const send = (msg: ServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
    };
    const fail = (err: unknown) => {
      if (err instanceof GameError) send({ type: "error", code: err.code, message: err.message });
      else {
        req.log.error(err);
        send({ type: "error", code: "internal", message: "Something went wrong" });
      }
    };
    // A flood guard per connection: a budget of messages per 10 s, refilled each window.
    let windowStart = Date.now();
    let used = 0;
    socket.on("message", (data) => {
      if (limits) {
        const now = Date.now();
        if (now - windowStart >= 10_000) {
          windowStart = now;
          used = 0;
        }
        if (++used > limits.wsPer10s) {
          send({ type: "error", code: "rateLimited", message: "Too many messages" });
          socket.close(1008, "rate limited");
          return;
        }
      }
      const msg = parseClientMessage(String(data));
      if (!msg) return send({ type: "error", code: "badMessage", message: "Malformed message" });
      void (async () => {
        if (msg.type === "ping") return send({ type: "pong" });
        if (msg.type === "hello") {
          const account = await engine.authenticate(msg.authToken);
          if (!account)
            return send({ type: "error", code: "unauthorized", message: "Unknown token" });
          if (conn) engine.disconnect(conn);
          conn = { accountId: account.id, send };
          (conn as Connection & { account: Account }).account = account;
          return send({ type: "welcome", accountId: account.id, name: account.name });
        }
        if (!conn) return send({ type: "error", code: "unauthorized", message: "Say hello first" });
        const account = (conn as Connection & { account: Account }).account;
        switch (msg.type) {
          case "subscribe":
            return engine.subscribe(conn, msg.gameId);
          case "requestState":
            return engine.requestState(conn, msg.gameId);
          case "submitOrders":
            return engine.submit(account, msg.gameId, msg.turn, msg.orders);
          case "unsubmit":
            return engine.unsubmit(account, msg.gameId, msg.turn);
          case "hashMismatch":
            // SPEC §9.4: the client recovers on its own; the server records it.
            req.log.warn(
              {
                gameId: msg.gameId,
                turn: msg.turn,
                clientHash: msg.clientHash,
                serverHash: msg.serverHash,
                accountId: account.id,
              },
              "client state hash mismatch",
            );
            engine.recordMismatch(msg.gameId, msg.turn);
            return;
        }
      })().catch(fail);
    });
    socket.on("close", () => {
      if (conn) engine.disconnect(conn);
    });
  });

  return app;
}
