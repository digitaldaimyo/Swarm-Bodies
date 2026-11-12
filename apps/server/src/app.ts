import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import websocket from "@fastify/websocket";
import type { ZodType } from "zod";
import {
  CreateGameRequestSchema,
  DailySubmitRequestSchema,
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

const MAX_WS_MESSAGE = 64 * 1024;

export interface AppOptions {
  engine: GameEngine;
  progression: Progression;
  logger?: boolean;
}

/** HTTP and WebSocket front end (SPEC §9.4). All game logic lives in GameEngine. */
export async function buildApp({
  engine,
  progression,
  logger = false,
}: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger, bodyLimit: 64 * 1024 });
  await app.register(websocket, { options: { maxPayload: MAX_WS_MESSAGE } });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof GameError)
      return reply.status(err.status).send({ code: err.code, message: err.message });
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
  const auth = async (req: FastifyRequest): Promise<Account> => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    const account = await engine.authenticate(token);
    if (!account) throw new GameError("unauthorized", "Sign in as a guest first", 401);
    return account;
  };
  const ok = (reply: FastifyReply, body: unknown) =>
    reply.header("cache-control", "no-store").send(body);

  app.get("/api/health", async () => ({ ok: true }));
  app.post("/api/guest", async (_req, reply) => ok(reply, await engine.createGuest()));
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
    socket.on("message", (data) => {
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
