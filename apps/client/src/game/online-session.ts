import { hashState, type GameState, type Order, type PlayerId } from "@swarm/sim";
import { ordersBySeat, type GameMeta, type ServerMessage } from "@swarm/protocol";
import { api } from "../net/api";
import type { GameSocket } from "../net/socket";
import { clearDrafts, loadDraft, saveDraft } from "./drafts";
import { SessionBase, type MatchSession, type SeatStatus, type TurnRecord } from "./match-session";

/**
 * An online game (SPEC §9.4). The server is authoritative and only ever receives orders. Each
 * `turnResolved` is replayed locally with the shared sim, which also yields the events to
 * animate; if the resulting hash differs from the server's, the client reports it, asks for
 * the full state and replaces its own.
 */
export class OnlineSession extends SessionBase implements MatchSession {
  readonly kind = "online" as const;
  meta: GameMeta;
  lastError: string | null = null;
  /** Hash mismatches detected and recovered this session (shown in the e2e hook). */
  resyncs = 0;
  private resyncing = false;
  private optimisticSubmit = false;
  private readonly off: () => void;

  constructor(
    private readonly socket: GameSocket,
    meta: GameMeta,
    state: GameState,
  ) {
    const me = meta.players.find((p) => p.you)?.seat ?? 0;
    super(state, me);
    this.meta = meta;
    this.off = socket.onMessage((m) => this.handle(m));
    void this.restoreDraft();
  }

  /** Subscribes and waits for the first full state. Resolves with null while in the lobby. */
  static open(socket: GameSocket, gameId: string): Promise<OnlineSession | { lobby: GameMeta }> {
    return new Promise((resolve, reject) => {
      const off = socket.onMessage((m) => {
        if (m.type === "gameState" && m.meta.gameId === gameId && m.state) {
          off();
          resolve(new OnlineSession(socket, m.meta, m.state));
        } else if (m.type === "lobby" && m.meta.gameId === gameId) {
          off();
          resolve({ lobby: m.meta });
        } else if (m.type === "error" && (m.code === "notPlayer" || m.code === "notFound")) {
          off();
          reject(new Error(m.message));
        }
      });
      socket.subscribe(gameId);
    });
  }

  get gameId(): string {
    return this.meta.gameId;
  }

  get description(): string {
    const s = this.meta.settings;
    const pace = s.pace === "live" ? `live ${s.turnSeconds} s` : `async ${s.turnSeconds / 3600} h`;
    return `Online · ${pace} · code ${this.meta.code}`;
  }

  get deadline(): number | null {
    return this.meta.deadline ? Date.parse(this.meta.deadline) : null;
  }

  get turnSeconds(): number {
    return this.meta.settings.turnSeconds;
  }

  get submitted(): boolean {
    return this.optimisticSubmit || !!this.meta.players.find((p) => p.seat === this.me)?.submitted;
  }

  name(seat: PlayerId): string {
    const p = this.meta.players.find((x) => x.seat === seat);
    return p?.you ? "You" : (p?.name ?? `Player ${seat + 1}`);
  }

  seats(): SeatStatus[] {
    return this.meta.players.map((p) => ({
      seat: p.seat,
      name: p.you ? "You" : p.name,
      strain: this.state.players.find((x) => x.id === p.seat)?.strain ?? p.strain,
      you: p.you,
      ready: p.submitted || p.botControlled,
      thinking: false,
      botControlled: p.botControlled,
      connected: p.connected,
    }));
  }

  submit(): void {
    if (this.finished || this.submitted) return;
    this.optimisticSubmit = true;
    this.lastError = null;
    this.socket.send({
      type: "submitOrders",
      gameId: this.gameId,
      turn: this.state.turn,
      orders: this.planner.orders,
    });
    this.notify();
  }

  canUnsubmit(): boolean {
    return this.submitted && !this.finished;
  }

  unsubmit(): void {
    if (!this.canUnsubmit()) return;
    this.optimisticSubmit = false;
    this.socket.send({ type: "unsubmit", gameId: this.gameId, turn: this.state.turn });
    this.notify();
  }

  saveDraft(): void {
    void saveDraft(this.gameId, this.state.turn, this.planner.orders);
  }

  private async restoreDraft(): Promise<void> {
    const turn = this.state.turn;
    const draft = await loadDraft(this.gameId, turn);
    if (draft.length === 0 || this.state.turn !== turn || this.planner.orders.length > 0) return;
    for (const o of draft) this.planner.add(o);
    this.notify();
  }

  private seat(seat: number) {
    return this.meta.players.find((p) => p.seat === seat);
  }

  private handle(m: ServerMessage): void {
    if ("gameId" in m && m.gameId !== this.gameId) return;
    switch (m.type) {
      case "gameState": {
        if (m.meta.gameId !== this.gameId || !m.state) return;
        this.meta = m.meta;
        if (this.resyncing || hashState(m.state) !== hashState(this.state)) {
          // Recovery (or a reconnect that missed turns): adopt the server's state.
          const draft = m.state.turn === this.state.turn ? this.planner.orders : [];
          this.setState(m.state, draft);
          if (this.resyncing) this.resyncs++;
          this.resyncing = false;
          void this.restoreDraft();
        }
        this.optimisticSubmit = false;
        this.notify();
        return;
      }
      case "playerSubmitted": {
        const p = this.seat(m.seat);
        if (p && m.turn === this.state.turn) p.submitted = m.submitted;
        if (p?.you) this.optimisticSubmit = false;
        this.notify();
        return;
      }
      case "playerStatus": {
        const p = this.seat(m.seat);
        if (p) {
          p.connected = m.connected;
          p.botControlled = m.botControlled;
        }
        this.notify();
        return;
      }
      case "turnResolved":
        this.onResolved(m);
        return;
      case "gameOver":
        this.meta = { ...this.meta, status: "finished", deadline: null };
        this.notify();
        return;
      case "error":
        this.lastError = m.message;
        this.optimisticSubmit = false;
        this.notify();
        return;
      default:
        return;
    }
  }

  private onResolved(m: Extract<ServerMessage, { type: "turnResolved" }>): void {
    if (this.resyncing || m.turn < this.state.turn) return;
    if (m.turn > this.state.turn) {
      // We missed a turn (e.g. a dropped socket): fetch the truth.
      this.requestResync();
      return;
    }
    const record: TurnRecord = this.applyTurn(ordersBySeat(m.ordersByPlayer));
    const local = hashState(record.after);
    for (const p of this.meta.players) p.submitted = false;
    this.optimisticSubmit = false;
    this.meta = {
      ...this.meta,
      turn: record.after.turn,
      deadline: m.nextDeadline,
      status: record.after.result ? "finished" : "active",
    };
    if (local !== m.stateHash) {
      // SPEC §9.4: report, request the full state, replace ours. No replay for this turn.
      this.socket.send({
        type: "hashMismatch",
        gameId: this.gameId,
        turn: m.turn,
        clientHash: local,
        serverHash: m.stateHash,
      });
      this.history.pop();
      this.setState(record.before);
      this.requestResync();
      this.notify();
      return;
    }
    void clearDrafts(this.gameId, record.after.turn);
    this.emitTurn(record);
    this.notify();
  }

  private requestResync(): void {
    this.resyncing = true;
    this.socket.send({ type: "requestState", gameId: this.gameId });
  }

  /**
   * After the game ends, rebuilds the full history from the replay endpoint (seed + orders), so
   * "watch replay" and the dominance graph cover the whole game even if we joined late.
   */
  async loadFullHistory(): Promise<void> {
    if (!this.finished) return;
    const replay = await api.replay(this.gameId);
    const { createGame, resolveTurn } = await import("@swarm/sim");
    let state = createGame(
      { mode: replay.map, playerCount: replay.strains.length, strains: replay.strains },
      replay.seed,
    );
    this.history.length = 0;
    this.stats.length = 0;
    this.state = state;
    this.recordStats();
    for (const t of replay.turns) {
      const orders = ordersBySeat(t as Record<string, Order[]>);
      const r = resolveTurn(state, orders);
      this.history.push({ before: state, after: r.state, orders, events: r.events });
      state = r.state;
      this.state = state;
      this.recordStats();
    }
    this.notify();
  }

  /** Test hook: silently corrupt local state so the next turn's hash cannot match. */
  corruptForTest(): void {
    const me = this.state.players.find((p) => p.id === this.me);
    if (me) me.nutrients += 7;
  }

  override dispose(): void {
    this.off();
    this.socket.unsubscribe(this.gameId);
    super.dispose();
  }
}
