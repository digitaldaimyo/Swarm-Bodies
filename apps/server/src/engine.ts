import { createHash, randomBytes, randomInt } from "node:crypto";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { chooseOrders } from "@swarm/bot";
import {
  createGame,
  hashState,
  resolveTurn,
  upgradeState,
  validateOrderSet,
  type GameState,
  type Order,
  type OrderSet,
} from "@swarm/sim";
import type {
  GameMeta,
  GameSettings,
  GameSummary,
  PlayerMeta,
  ServerMessage,
  Strain,
} from "@swarm/protocol";
import { DEFAULT_SETTINGS } from "@swarm/protocol";
import type { Db } from "./db";
import type { PushSender } from "./push";
import {
  accounts,
  gamePlayers,
  games,
  gameSnapshots,
  pushSubscriptions,
  turnOrders,
  turnResults,
} from "./schema";

/** Errors that map to a protocol `error` message or an HTTP status. */
export class GameError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface Clock {
  now(): number;
}

/** Live-game timers. Injectable so tests can fire deadlines without waiting. */
export interface Scheduler {
  set(key: string, at: number, fn: () => void): void;
  clear(key: string): void;
}

export const realScheduler = (): Scheduler => {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return {
    set(key, at, fn) {
      clearTimeout(timers.get(key));
      timers.set(key, setTimeout(fn, Math.max(0, at - Date.now())));
    },
    clear(key) {
      clearTimeout(timers.get(key));
      timers.delete(key);
    },
  };
};

export interface Logger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

/** One open WebSocket. */
export interface Connection {
  accountId: string;
  send(msg: ServerMessage): void;
}

export interface Account {
  id: string;
  name: string;
}

interface Seat {
  seat: number;
  accountId: string;
  name: string;
  strain: Strain;
  botControlled: boolean;
  missedTurns: number;
}

interface LoadedGame {
  id: string;
  code: string;
  settings: GameSettings;
  seed: string;
  status: "lobby" | "active" | "finished";
  hostAccount: string;
  seats: Seat[];
  state: GameState | null;
  /** Sealed orders for the current turn, by seat. */
  submissions: Map<number, Order[]>;
  deadline: number | null;
  reminderSentTurn: number;
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const SNAPSHOT_EVERY = 10;
const MISSES_BEFORE_BOT = 3;
const REMINDER_BEFORE_MS = 3600_000;
const NAME_A = [
  "Amber",
  "Basalt",
  "Cobalt",
  "Dusky",
  "Ember",
  "Frost",
  "Glow",
  "Hazy",
  "Ion",
  "Jade",
  "Kelp",
  "Lumen",
];
const NAME_B = ["Spore", "Mote", "Bloom", "Tendril", "Colony", "Mycel", "Vesicle", "Cilia"];

export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/**
 * The authoritative game service (SPEC §9.4). It owns accounts, lobbies, sealed orders, turn
 * resolution, timers, bot takeover and push. Operations on one game run one at a time
 * in-process; resolution additionally takes a Postgres advisory lock and writes a unique
 * (game, turn) row first, so it is idempotent even across processes.
 */
export class GameEngine {
  private readonly cache = new Map<string, LoadedGame>();
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly subscribers = new Map<string, Set<Connection>>();
  private readonly queue: Record<GameSettings["pace"], { accountId: string; strain: Strain }[]> = {
    live: [],
    async: [],
  };
  private readonly matched = new Map<string, string>();

  constructor(
    private readonly db: Db,
    private readonly deps: { clock: Clock; scheduler: Scheduler; push: PushSender; log: Logger },
  ) {}

  // ----------------------------------------------------------------------------------------
  // Accounts

  async createGuest(): Promise<{ token: string; accountId: string; name: string }> {
    const token = randomBytes(32).toString("base64url");
    const name = `${NAME_A[randomInt(NAME_A.length)]} ${NAME_B[randomInt(NAME_B.length)]} ${randomInt(100, 1000)}`;
    const [row] = await this.db
      .insert(accounts)
      .values({ tokenHash: hashToken(token), name })
      .returning();
    return { token, accountId: (row as typeof accounts.$inferSelect).id, name };
  }

  async authenticate(token: string | undefined | null): Promise<Account | null> {
    if (!token || token.length < 16 || token.length > 128) return null;
    const row = await this.db.query.accounts.findFirst({
      where: eq(accounts.tokenHash, hashToken(token)),
    });
    return row ? { id: row.id, name: row.name } : null;
  }

  // ----------------------------------------------------------------------------------------
  // Lobby

  async createGame(
    account: Account,
    settings: GameSettings,
    strain: Strain,
  ): Promise<{ gameId: string; code: string }> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = Array.from(
        { length: 6 },
        () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
      ).join("");
      try {
        const id = await this.db.transaction(async (tx) => {
          const [g] = await tx
            .insert(games)
            .values({
              code,
              settings,
              seed: randomBytes(12).toString("base64url"),
              hostAccount: account.id,
            })
            .returning();
          const gameId = (g as typeof games.$inferSelect).id;
          await tx.insert(gamePlayers).values({ gameId, seat: 0, accountId: account.id, strain });
          return gameId;
        });
        return { gameId: id, code };
      } catch (err) {
        if (!String(err).includes("games_code_unique")) throw err;
      }
    }
    throw new GameError("codeExhausted", "Could not allocate an invite code", 503);
  }

  async joinGame(account: Account, code: string, strain: Strain): Promise<{ gameId: string }> {
    const row = await this.db.query.games.findFirst({
      where: eq(games.code, code.trim().toUpperCase()),
    });
    if (!row) throw new GameError("notFound", "No game with that code", 404);
    return this.withGame(row.id, async (g) => {
      if (g.seats.some((s) => s.accountId === account.id)) return { gameId: g.id };
      if (g.status !== "lobby")
        throw new GameError("started", "That game has already started", 409);
      if (g.seats.length >= g.settings.players)
        throw new GameError("full", "That game is full", 409);
      const seat = g.seats.length;
      await this.db
        .insert(gamePlayers)
        .values({ gameId: g.id, seat, accountId: account.id, strain });
      g.seats.push({
        seat,
        accountId: account.id,
        name: account.name,
        strain,
        botControlled: false,
        missedTurns: 0,
      });
      this.broadcastLobby(g);
      return { gameId: g.id };
    });
  }

  async setStrain(account: Account, gameId: string, strain: Strain): Promise<void> {
    await this.withGame(gameId, async (g) => {
      const seat = g.seats.find((s) => s.accountId === account.id);
      if (!seat) throw new GameError("notPlayer", "You are not in this game", 403);
      if (g.status !== "lobby")
        throw new GameError("started", "Strains are locked once the game starts", 409);
      seat.strain = strain;
      await this.db
        .update(gamePlayers)
        .set({ strain })
        .where(and(eq(gamePlayers.gameId, g.id), eq(gamePlayers.seat, seat.seat)));
      this.broadcastLobby(g);
    });
  }

  async startGame(account: Account, gameId: string): Promise<void> {
    await this.withGame(gameId, async (g) => {
      if (g.hostAccount !== account.id)
        throw new GameError("notHost", "Only the host can start the game", 403);
      await this.start(g);
    });
  }

  private async start(g: LoadedGame): Promise<void> {
    if (g.status !== "lobby") throw new GameError("started", "That game has already started", 409);
    if (g.seats.length < g.settings.players)
      throw new GameError("notFull", "Waiting for more players", 409);
    const state = createGame(
      {
        mode: g.settings.map,
        playerCount: g.settings.players,
        strains: g.seats.map((s) => s.strain),
      },
      g.seed,
    );
    const deadline = this.deps.clock.now() + g.settings.turnSeconds * 1000;
    await this.db.transaction(async (tx) => {
      await tx
        .update(games)
        .set({
          status: "active",
          turn: state.turn,
          deadline: new Date(deadline),
          updatedAt: new Date(this.deps.clock.now()),
        })
        .where(eq(games.id, g.id));
      await tx.insert(gameSnapshots).values({ gameId: g.id, turn: state.turn, state });
    });
    g.status = "active";
    g.state = state;
    g.deadline = deadline;
    this.schedule(g);
    for (const c of this.subscribers.get(g.id) ?? []) this.sendState(c, g);
    void this.notifyTurn(g);
  }

  async listGames(account: Account): Promise<GameSummary[]> {
    const rows = await this.db
      .select({ gameId: gamePlayers.gameId })
      .from(gamePlayers)
      .innerJoin(games, eq(games.id, gamePlayers.gameId))
      .where(
        and(eq(gamePlayers.accountId, account.id), inArray(games.status, ["lobby", "active"])),
      );
    const out: GameSummary[] = [];
    for (const { gameId } of rows) {
      const g = await this.load(gameId);
      const me = g.seats.find((s) => s.accountId === account.id);
      out.push({
        gameId: g.id,
        code: g.code,
        status: g.status,
        pace: g.settings.pace,
        turn: g.state?.turn ?? 0,
        opponents: g.seats.filter((s) => s.accountId !== account.id).map((s) => s.name),
        yourTurn:
          g.status === "active" &&
          !!me &&
          !g.submissions.has(me.seat) &&
          !this.isEliminated(g, me.seat),
        deadline: g.deadline ? new Date(g.deadline).toISOString() : null,
      });
    }
    return out.sort((a, b) => Number(b.yourTurn) - Number(a.yourTurn));
  }

  async getMeta(gameId: string, viewer: Account): Promise<GameMeta> {
    const g = await this.load(gameId);
    return this.meta(g, viewer.id);
  }

  /** Seed and resolved orders of a finished game (SPEC §12.3 shareable replays). */
  async replay(gameId: string): Promise<{
    seed: string;
    map: GameSettings["map"];
    strains: Strain[];
    turns: Record<string, Order[]>[];
    result: GameState["result"];
  }> {
    const g = await this.load(gameId);
    if (g.status !== "finished")
      throw new GameError("notFinished", "Replays are available once the game ends", 409);
    const rows = await this.db
      .select()
      .from(turnResults)
      .where(eq(turnResults.gameId, gameId))
      .orderBy(turnResults.turn);
    return {
      seed: g.seed,
      map: g.settings.map,
      strains: g.seats.map((s) => s.strain),
      turns: rows.map((r) => r.orders),
      result: g.state?.result ?? null,
    };
  }

  // ----------------------------------------------------------------------------------------
  // Quick match (in-process; a restart empties the queue)

  async enqueue(
    account: Account,
    pace: GameSettings["pace"],
    strain: Strain,
  ): Promise<{ status: "queued" | "matched"; gameId: string | null }> {
    const done = this.matched.get(account.id);
    if (done) {
      this.matched.delete(account.id);
      return { status: "matched", gameId: done };
    }
    const q = this.queue[pace];
    const other = q.find((e) => e.accountId !== account.id);
    if (!other) {
      if (!q.some((e) => e.accountId === account.id)) q.push({ accountId: account.id, strain });
      return { status: "queued", gameId: null };
    }
    q.splice(q.indexOf(other), 1);
    const host = await this.db.query.accounts.findFirst({
      where: eq(accounts.id, other.accountId),
    });
    if (!host) return this.enqueue(account, pace, strain);
    // Quick match plays the real game: a 2-player system (SPEC §4; Single Rock is a test map).
    const settings: GameSettings = { ...DEFAULT_SETTINGS[pace] };
    const { gameId, code } = await this.createGame(
      { id: host.id, name: host.name },
      settings,
      other.strain,
    );
    await this.joinGame(account, code, strain);
    await this.withGame(gameId, (g) => this.start(g));
    this.matched.set(other.accountId, gameId);
    return { status: "matched", gameId };
  }

  dequeue(account: Account): void {
    for (const pace of ["live", "async"] as const) {
      this.queue[pace] = this.queue[pace].filter((e) => e.accountId !== account.id);
    }
    this.matched.delete(account.id);
  }

  // ----------------------------------------------------------------------------------------
  // Play

  async submit(account: Account, gameId: string, turn: number, orders: OrderSet): Promise<void> {
    await this.withGame(gameId, async (g) => {
      const seat = this.requireTurn(g, account, turn);
      // The server re-validates with the shared sim (SPEC §14: rejects illegal orders).
      const check = validateOrderSet(g.state as GameState, seat.seat, orders);
      if (!check.ok)
        throw new GameError("illegalOrder", `Order ${check.index + 1}: ${check.message}`);
      await this.db
        .insert(turnOrders)
        .values({ gameId: g.id, turn, seat: seat.seat, orders })
        .onConflictDoUpdate({
          target: [turnOrders.gameId, turnOrders.turn, turnOrders.seat],
          set: { orders, submittedAt: new Date(this.deps.clock.now()) },
        });
      g.submissions.set(seat.seat, orders);
      if (seat.botControlled || seat.missedTurns > 0) {
        // The player is back: the bot steps aside (SPEC §3).
        const wasBot = seat.botControlled;
        seat.botControlled = false;
        seat.missedTurns = 0;
        await this.db
          .update(gamePlayers)
          .set({ botControlled: false, missedTurns: 0 })
          .where(and(eq(gamePlayers.gameId, g.id), eq(gamePlayers.seat, seat.seat)));
        if (wasBot) this.broadcastStatus(g, seat.seat);
      }
      this.broadcast(g.id, {
        type: "playerSubmitted",
        gameId: g.id,
        seat: seat.seat,
        turn,
        submitted: true,
      });
      if (this.everyoneReady(g)) await this.resolveLocked(g, turn);
    });
  }

  async unsubmit(account: Account, gameId: string, turn: number): Promise<void> {
    await this.withGame(gameId, async (g) => {
      const seat = this.requireTurn(g, account, turn);
      await this.db
        .delete(turnOrders)
        .where(
          and(
            eq(turnOrders.gameId, g.id),
            eq(turnOrders.turn, turn),
            eq(turnOrders.seat, seat.seat),
          ),
        );
      g.submissions.delete(seat.seat);
      this.broadcast(g.id, {
        type: "playerSubmitted",
        gameId: g.id,
        seat: seat.seat,
        turn,
        submitted: false,
      });
    });
  }

  private requireTurn(g: LoadedGame, account: Account, turn: number): Seat {
    const seat = g.seats.find((s) => s.accountId === account.id);
    if (!seat) throw new GameError("notPlayer", "You are not in this game", 403);
    if (g.status !== "active" || !g.state)
      throw new GameError("notActive", "The game is not running", 409);
    if (turn !== g.state.turn)
      throw new GameError("wrongTurn", `Turn ${turn} is not open (current: ${g.state.turn})`, 409);
    if (this.isEliminated(g, seat.seat))
      throw new GameError("eliminated", "You have been eliminated", 409);
    return seat;
  }

  private isEliminated(g: LoadedGame, seat: number): boolean {
    return !!g.state?.players.find((p) => p.id === seat)?.eliminated;
  }

  /** Every living seat has orders in: humans have submitted, bot-controlled seats count as ready. */
  private everyoneReady(g: LoadedGame): boolean {
    return g.seats.every(
      (s) => this.isEliminated(g, s.seat) || s.botControlled || g.submissions.has(s.seat),
    );
  }

  /** Resolves `turn` if it is still open. Safe to call repeatedly and from several triggers. */
  async resolve(gameId: string, turn: number): Promise<void> {
    await this.withGame(gameId, (g) => this.resolveLocked(g, turn));
  }

  private async resolveLocked(g: LoadedGame, turn: number): Promise<void> {
    if (g.status !== "active" || !g.state || g.state.turn !== turn) return;
    const before = g.state;
    const orders: Record<number, OrderSet> = {};
    const seatUpdates: { seat: number; missedTurns: number; botControlled: boolean }[] = [];
    for (const s of g.seats) {
      if (this.isEliminated(g, s.seat)) continue;
      const submitted = g.submissions.get(s.seat);
      if (submitted) {
        orders[s.seat] = submitted;
      } else if (s.botControlled) {
        orders[s.seat] = chooseOrders(before, s.seat, "normal", `${g.seed}:takeover:${s.seat}`);
      } else {
        // A missed turn is an empty order set (SPEC §3).
        orders[s.seat] = [];
        const missedTurns = s.missedTurns + 1;
        const botControlled = g.settings.pace === "live" && missedTurns >= MISSES_BEFORE_BOT;
        seatUpdates.push({ seat: s.seat, missedTurns, botControlled });
      }
    }
    const { state: after } = resolveTurn(before, orders);
    const stateHash = hashState(after);
    const now = this.deps.clock.now();
    const finished = after.result !== null;
    const deadline = finished ? null : now + g.settings.turnSeconds * 1000;
    const ordersJson: Record<string, Order[]> = {};
    for (const k of Object.keys(orders).sort()) ordersJson[k] = orders[Number(k)] as Order[];

    const wrote = await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${g.id}))`);
      const inserted = await tx
        .insert(turnResults)
        .values({ gameId: g.id, turn, orders: ordersJson, stateHash })
        .onConflictDoNothing()
        .returning({ turn: turnResults.turn });
      if (inserted.length === 0) return false; // Someone else already resolved this turn.
      await tx
        .update(games)
        .set({
          turn: after.turn,
          deadline: deadline === null ? null : new Date(deadline),
          status: finished ? "finished" : "active",
          result: after.result,
          updatedAt: new Date(now),
        })
        .where(eq(games.id, g.id));
      for (const u of seatUpdates) {
        await tx
          .update(gamePlayers)
          .set({ missedTurns: u.missedTurns, botControlled: u.botControlled })
          .where(and(eq(gamePlayers.gameId, g.id), eq(gamePlayers.seat, u.seat)));
      }
      if (after.turn % SNAPSHOT_EVERY === 1 || finished) {
        await tx
          .insert(gameSnapshots)
          .values({ gameId: g.id, turn: after.turn, state: after })
          .onConflictDoNothing();
      }
      return true;
    });
    if (!wrote) {
      this.cache.delete(g.id);
      return;
    }

    for (const u of seatUpdates) {
      const s = g.seats.find((x) => x.seat === u.seat) as Seat;
      const tookOver = u.botControlled && !s.botControlled;
      s.missedTurns = u.missedTurns;
      s.botControlled = u.botControlled;
      if (tookOver) this.broadcastStatus(g, s.seat);
    }
    g.state = after;
    g.submissions.clear();
    g.deadline = deadline;
    if (finished) g.status = "finished";

    this.broadcast(g.id, {
      type: "turnResolved",
      gameId: g.id,
      turn,
      ordersByPlayer: ordersJson,
      stateHash,
      nextDeadline: deadline === null ? null : new Date(deadline).toISOString(),
    });
    if (after.result)
      this.broadcast(g.id, { type: "gameOver", gameId: g.id, result: after.result });
    this.schedule(g);
    if (!finished) void this.notifyTurn(g);
  }

  // ----------------------------------------------------------------------------------------
  // Deadlines

  private schedule(g: LoadedGame): void {
    const key = `deadline:${g.id}`;
    this.deps.scheduler.clear(key);
    if (g.status !== "active" || g.deadline === null || !g.state) return;
    // Live games use in-process timers; async ones are swept from Postgres every 30 s.
    if (g.settings.pace === "live") {
      const turn = g.state.turn;
      this.deps.scheduler.set(
        key,
        g.deadline,
        () =>
          void this.resolve(g.id, turn).catch((err) =>
            this.deps.log.error({ err, gameId: g.id }, "deadline resolve failed"),
          ),
      );
    }
  }

  /**
   * Resolves every active game whose deadline has passed and sends the "1 h left" reminders.
   * Run every 30 s, and once at startup so games that expired while the server was down move on.
   */
  async sweep(): Promise<number> {
    const now = this.deps.clock.now();
    const due = await this.db
      .select({ id: games.id, turn: games.turn })
      .from(games)
      .where(and(eq(games.status, "active"), lte(games.deadline, new Date(now))));
    for (const d of due) {
      await this.resolve(d.id, d.turn).catch((err) =>
        this.deps.log.error({ err, gameId: d.id }, "sweep resolve failed"),
      );
    }
    const remind = await this.db
      .select({ id: games.id, turn: games.turn, reminderSentTurn: games.reminderSentTurn })
      .from(games)
      .where(
        and(eq(games.status, "active"), lte(games.deadline, new Date(now + REMINDER_BEFORE_MS))),
      );
    for (const r of remind) {
      if (r.reminderSentTurn >= r.turn) continue;
      const g = await this.load(r.id);
      if (g.settings.pace !== "async") continue;
      await this.db.update(games).set({ reminderSentTurn: r.turn }).where(eq(games.id, r.id));
      g.reminderSentTurn = r.turn;
      await this.notifyTurn(g, true);
    }
    return due.length;
  }

  /** At startup: re-arm live timers for running games. */
  async restore(): Promise<void> {
    const active = await this.db
      .select({ id: games.id })
      .from(games)
      .where(eq(games.status, "active"));
    // One unreadable game must not keep the server down: log it and carry on.
    for (const { id } of active) {
      try {
        this.schedule(await this.load(id));
      } catch (err) {
        this.deps.log.error({ gameId: id, err }, "could not restore game");
      }
    }
  }

  // ----------------------------------------------------------------------------------------
  // Web Push (async games only)

  private async notifyTurn(g: LoadedGame, reminder = false): Promise<void> {
    if (g.settings.pace !== "async" || g.status !== "active" || !g.state) return;
    const waiting = g.seats.filter(
      (s) => !s.botControlled && !g.submissions.has(s.seat) && !this.isEliminated(g, s.seat),
    );
    if (waiting.length === 0) return;
    const subs = await this.db
      .select()
      .from(pushSubscriptions)
      .where(
        inArray(
          pushSubscriptions.accountId,
          waiting.map((s) => s.accountId),
        ),
      );
    for (const sub of subs) {
      const result = await this.deps.push.send(sub, {
        title: reminder ? "1 hour left" : "Your turn",
        body: reminder
          ? `Turn ${g.state.turn} resolves within the hour.`
          : `Turn ${g.state.turn} is ready to plan.`,
        gameId: g.id,
      });
      if (result === "gone")
        await this.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
    }
  }

  async subscribePush(
    account: Account,
    endpoint: string,
    p256dh: string,
    auth: string,
  ): Promise<void> {
    await this.db
      .insert(pushSubscriptions)
      .values({ accountId: account.id, endpoint, p256dh, auth })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { accountId: account.id, p256dh, auth },
      });
  }

  get pushPublicKey(): string | null {
    return this.deps.push.publicKey;
  }

  /** Hash mismatches reported by clients, for tests and monitoring. */
  readonly mismatches: { gameId: string; turn: number }[] = [];

  recordMismatch(gameId: string, turn: number): void {
    this.mismatches.push({ gameId, turn });
    if (this.mismatches.length > 1000) this.mismatches.shift();
  }

  // ----------------------------------------------------------------------------------------
  // Connections

  async subscribe(conn: Connection, gameId: string): Promise<void> {
    const g = await this.load(gameId);
    const seat = g.seats.find((s) => s.accountId === conn.accountId);
    if (!seat) throw new GameError("notPlayer", "You are not in this game", 403);
    let set = this.subscribers.get(g.id);
    if (!set) this.subscribers.set(g.id, (set = new Set()));
    const wasConnected = this.isConnected(g.id, conn.accountId);
    set.add(conn);
    if (!wasConnected) this.broadcastStatus(g, seat.seat);
    this.sendState(conn, g);
  }

  async requestState(conn: Connection, gameId: string): Promise<void> {
    const g = await this.load(gameId);
    if (!g.seats.some((s) => s.accountId === conn.accountId))
      throw new GameError("notPlayer", "You are not in this game", 403);
    this.sendState(conn, g);
  }

  disconnect(conn: Connection): void {
    for (const [gameId, set] of this.subscribers) {
      if (!set.delete(conn)) continue;
      const g = this.cache.get(gameId);
      const seat = g?.seats.find((s) => s.accountId === conn.accountId);
      if (g && seat && !this.isConnected(gameId, conn.accountId))
        this.broadcastStatus(g, seat.seat);
    }
  }

  private isConnected(gameId: string, accountId: string): boolean {
    for (const c of this.subscribers.get(gameId) ?? []) if (c.accountId === accountId) return true;
    return false;
  }

  private sendState(conn: Connection, g: LoadedGame): void {
    const meta = this.meta(g, conn.accountId);
    conn.send(
      g.status === "lobby" ? { type: "lobby", meta } : { type: "gameState", meta, state: g.state },
    );
  }

  private broadcast(gameId: string, msg: ServerMessage): void {
    for (const c of this.subscribers.get(gameId) ?? []) c.send(msg);
  }

  private broadcastLobby(g: LoadedGame): void {
    for (const c of this.subscribers.get(g.id) ?? [])
      c.send({ type: "lobby", meta: this.meta(g, c.accountId) });
  }

  private broadcastStatus(g: LoadedGame, seat: number): void {
    const s = g.seats.find((x) => x.seat === seat);
    if (!s) return;
    this.broadcast(g.id, {
      type: "playerStatus",
      gameId: g.id,
      seat,
      connected: this.isConnected(g.id, s.accountId),
      botControlled: s.botControlled,
    });
  }

  private meta(g: LoadedGame, viewerAccount: string): GameMeta {
    const players: PlayerMeta[] = g.seats.map((s) => ({
      seat: s.seat,
      name: s.name,
      strain: s.strain,
      connected: this.isConnected(g.id, s.accountId),
      botControlled: s.botControlled,
      submitted: g.submissions.has(s.seat),
      you: s.accountId === viewerAccount,
    }));
    return {
      gameId: g.id,
      code: g.code,
      status: g.status,
      settings: g.settings,
      players,
      hostSeat: g.seats.find((s) => s.accountId === g.hostAccount)?.seat ?? 0,
      turn: g.state?.turn ?? 0,
      deadline: g.deadline === null ? null : new Date(g.deadline).toISOString(),
    };
  }

  // ----------------------------------------------------------------------------------------
  // Loading and per-game serialisation

  /** Runs `fn` with exclusive access to one game in this process. */
  private async withGame<T>(gameId: string, fn: (g: LoadedGame) => Promise<T>): Promise<T> {
    const prev = this.locks.get(gameId) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(async () => fn(await this.load(gameId)));
    const tail = run.catch(() => undefined);
    this.locks.set(gameId, tail);
    try {
      return await run;
    } finally {
      if (this.locks.get(gameId) === tail) this.locks.delete(gameId);
    }
  }

  /**
   * Loads a game, rebuilding its state from the latest snapshot plus the resolved orders since
   * (SPEC §9.4). Each replayed turn's hash is checked against the stored one.
   */
  private async load(gameId: string): Promise<LoadedGame> {
    const cached = this.cache.get(gameId);
    if (cached) return cached;
    if (!/^[0-9a-f-]{36}$/i.test(gameId)) throw new GameError("notFound", "No such game", 404);
    const row = await this.db.query.games.findFirst({ where: eq(games.id, gameId) });
    if (!row) throw new GameError("notFound", "No such game", 404);
    const seatRows = await this.db
      .select({
        seat: gamePlayers.seat,
        accountId: gamePlayers.accountId,
        strain: gamePlayers.strain,
        botControlled: gamePlayers.botControlled,
        missedTurns: gamePlayers.missedTurns,
        name: accounts.name,
      })
      .from(gamePlayers)
      .innerJoin(accounts, eq(accounts.id, gamePlayers.accountId))
      .where(eq(gamePlayers.gameId, gameId))
      .orderBy(gamePlayers.seat);

    let state: GameState | null = null;
    if (row.status !== "lobby") {
      const snap = await this.db.query.gameSnapshots.findFirst({
        where: and(eq(gameSnapshots.gameId, gameId), lte(gameSnapshots.turn, row.turn)),
        orderBy: (t, { desc }) => [desc(t.turn)],
      });
      if (!snap) throw new GameError("corrupt", `Game ${gameId} has no snapshot`, 500);
      // Snapshots written before M5 lack the system fields (DECISIONS).
      state = upgradeState(snap.state);
      const results = await this.db
        .select()
        .from(turnResults)
        .where(and(eq(turnResults.gameId, gameId), sql`${turnResults.turn} >= ${snap.turn}`))
        .orderBy(turnResults.turn);
      for (const r of results) {
        const orders: Record<number, Order[]> = {};
        for (const k of Object.keys(r.orders)) orders[Number(k)] = r.orders[k] as Order[];
        state = resolveTurn(state, orders).state;
        if (hashState(state) !== r.stateHash) {
          this.deps.log.error(
            { gameId, turn: r.turn },
            "replayed state hash differs from the stored one",
          );
        }
      }
    }
    const submissions = new Map<number, Order[]>();
    if (state && row.status === "active") {
      const subs = await this.db
        .select()
        .from(turnOrders)
        .where(and(eq(turnOrders.gameId, gameId), eq(turnOrders.turn, state.turn)));
      for (const s of subs) submissions.set(s.seat, s.orders);
    }
    const g: LoadedGame = {
      id: row.id,
      code: row.code,
      settings: row.settings,
      seed: row.seed,
      status: row.status,
      hostAccount: row.hostAccount,
      seats: seatRows.map((s) => ({ ...s })),
      state,
      submissions,
      deadline: row.deadline ? row.deadline.getTime() : null,
      reminderSentTurn: row.reminderSentTurn,
    };
    this.cache.set(gameId, g);
    return g;
  }

  /** Drops in-memory state, e.g. to prove a game reloads from Postgres alone. */
  forget(gameId?: string): void {
    if (gameId) this.cache.delete(gameId);
    else this.cache.clear();
  }

  stop(): void {
    for (const id of this.cache.keys()) this.deps.scheduler.clear(`deadline:${id}`);
  }
}
