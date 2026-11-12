import {
  dominancePermille,
  playerTotals,
  resolveTurn,
  type GameEvent,
  type GameState,
  type Order,
  type OrderSet,
  type PlayerId,
  type StrainId,
} from "@swarm/sim";
import { Planner } from "./planner";

export interface TurnRecord {
  before: GameState;
  after: GameState;
  orders: Record<PlayerId, OrderSet>;
  events: GameEvent[];
}

export interface TurnStats {
  turn: number;
  dominance: number[];
  cells: number[];
  biomass: number[];
}

/** One seat as the HUD shows it: ready marker, bot badge, connection. */
export interface SeatStatus {
  seat: PlayerId;
  name: string;
  strain: StrainId;
  you: boolean;
  /** Orders are in for this turn (or the bot has chosen). */
  ready: boolean;
  /** A bot is choosing right now (skirmish bot thinking). */
  thinking: boolean;
  /** A Normal bot plays this seat after missed turns (SPEC §3). */
  botControlled: boolean;
  connected: boolean;
}

/**
 * What the match screen plays against: an offline skirmish or an online game. Turns arrive
 * through `onTurn`, whoever triggered them (your submit, everyone else's, or a deadline).
 */
export interface MatchSession {
  readonly kind: "skirmish" | "online";
  readonly me: PlayerId;
  readonly state: GameState;
  readonly planner: Planner;
  readonly history: readonly TurnRecord[];
  readonly stats: readonly TurnStats[];
  readonly finished: boolean;
  /** Your orders for this turn are in. */
  readonly submitted: boolean;
  /** ms since the epoch when the turn resolves at the latest, or null if untimed. */
  readonly deadline: number | null;
  readonly turnSeconds: number | null;
  /** One line for the results screen, e.g. "Easy bot · seed amber-1". */
  readonly description: string;
  seats(): SeatStatus[];
  name(seat: PlayerId): string;
  submit(): void;
  unsubmit(): void;
  canUnsubmit(): boolean;
  /** Called whenever the plan changes, so it can be kept as a draft. */
  saveDraft(): void;
  onChange(fn: () => void): () => void;
  onTurn(fn: (record: TurnRecord) => void): () => void;
  dispose(): void;
}

/** Shared bookkeeping for both kinds of session. */
export abstract class SessionBase {
  state: GameState;
  planner: Planner;
  readonly history: TurnRecord[] = [];
  readonly stats: TurnStats[] = [];
  private readonly changeListeners = new Set<() => void>();
  private readonly turnListeners = new Set<(r: TurnRecord) => void>();

  protected constructor(
    state: GameState,
    readonly me: PlayerId,
  ) {
    this.state = state;
    this.planner = new Planner(state, me);
    this.recordStats();
  }

  get finished(): boolean {
    return this.state.result !== null;
  }

  onChange(fn: () => void): () => void {
    this.changeListeners.add(fn);
    return () => this.changeListeners.delete(fn);
  }

  onTurn(fn: (r: TurnRecord) => void): () => void {
    this.turnListeners.add(fn);
    return () => this.turnListeners.delete(fn);
  }

  protected notify(): void {
    for (const fn of this.changeListeners) fn();
  }

  protected emitTurn(r: TurnRecord): void {
    for (const fn of this.turnListeners) fn(r);
  }

  /** Resolves a turn locally with the shared sim and records it. */
  protected applyTurn(
    orders: Record<PlayerId, OrderSet>,
    keepDraft: readonly Order[] = [],
  ): TurnRecord {
    const before = this.state;
    const { state, events } = resolveTurn(before, orders);
    const record = { before, after: state, orders, events };
    this.history.push(record);
    this.setState(state, keepDraft);
    return record;
  }

  /** Replaces the state (a new turn, or a resync from the server) and starts a fresh plan. */
  protected setState(state: GameState, draft: readonly Order[] = []): void {
    this.state = state;
    this.planner = new Planner(state, this.me);
    for (const o of draft) this.planner.add(o);
    this.recordStats();
  }

  protected recordStats(): void {
    const totals = playerTotals(this.state);
    const ids = this.state.players.map((p) => p.id);
    const entry = {
      turn: this.state.turn - 1,
      dominance: ids.map((id) => dominancePermille(this.state, id)),
      cells: ids.map((id) => totals.get(id)?.cells ?? 0),
      biomass: ids.map((id) => totals.get(id)?.biomass ?? 0),
    };
    // A resync can revisit a turn; keep one entry per turn.
    const last = this.stats[this.stats.length - 1];
    if (last && last.turn === entry.turn) this.stats[this.stats.length - 1] = entry;
    else this.stats.push(entry);
  }

  dispose(): void {
    this.changeListeners.clear();
    this.turnListeners.clear();
  }
}

/** Per-player event counts for the results screen. */
export function matchSummary(history: readonly TurnRecord[], player: PlayerId) {
  let captures = 0;
  let lost = 0;
  let stalemates = 0;
  let grown = 0;
  for (const h of history) {
    for (const e of h.events) {
      if (e.type === "CellCaptured" && e.player === player) captures++;
      if (e.type === "CellCaptured" && e.from === player) lost++;
      if (e.type === "CellClaimed" && e.player === player) grown++;
      if (e.type === "CellStalemate" && e.players.includes(player)) stalemates++;
    }
  }
  return { captures, lost, stalemates, grown };
}

/**
 * The game summary (content's summarizeGame) for the viewer, rebuilt from the session's first
 * state: its seed, mode and resolved rules reproduce the game exactly.
 */
export async function summarizeSession(
  session: MatchSession,
  context: import("@swarm/content").SummaryContext,
): Promise<import("@swarm/content").GameSummary> {
  const { summarizeGame } = await import("@swarm/content");
  const first = session.history[0]?.before ?? session.state;
  return summarizeGame(
    {
      mode: first.mode,
      playerCount: first.players.length,
      strains: first.players.map((p) => p.strain),
      rules: first.rules,
    },
    first.seed,
    session.history.map((h) => h.orders),
    session.me,
    context,
  );
}
