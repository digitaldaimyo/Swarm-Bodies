import type { Difficulty } from "@swarm/bot";
import {
  createGame,
  dominancePermille,
  playerTotals,
  resolveTurn,
  type GameEvent,
  type GameState,
  type Order,
  type OrderSet,
  type PlayerId,
} from "@swarm/sim";
import type { BotRunner } from "./bot-client";
import { Planner } from "./planner";

export const HUMAN: PlayerId = 0;
export const BOT: PlayerId = 1;

export interface SkirmishSettings {
  seed: string;
  difficulty: Difficulty;
}

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

/** The saved form of a skirmish: the seed plus every turn's orders (SPEC §9.4: reconstructable). */
export interface SavedSkirmish {
  version: 1;
  settings: SkirmishSettings;
  turns: Record<PlayerId, OrderSet>[];
  draft: Order[];
}

/**
 * One offline skirmish against the bot (SPEC §3, §9.5). The bot plans in its worker as soon as
 * a turn starts; its orders stay sealed until the human submits.
 */
export class SkirmishSession {
  state: GameState;
  planner: Planner;
  readonly history: TurnRecord[] = [];
  readonly stats: TurnStats[] = [];
  private botOrders: Promise<OrderSet> | null = null;
  botReady = false;
  private listeners = new Set<() => void>();

  constructor(
    readonly settings: SkirmishSettings,
    private readonly bot: BotRunner,
  ) {
    this.state = createGame({ mode: "singleRock", playerCount: 2 }, settings.seed);
    this.planner = new Planner(this.state, HUMAN);
    this.recordStats();
    this.startBot();
  }

  /** Rebuilds a saved skirmish by replaying its orders through the sim. */
  static restore(saved: SavedSkirmish, bot: BotRunner): SkirmishSession {
    const s = new SkirmishSession(saved.settings, bot);
    for (const orders of saved.turns) s.apply(orders);
    for (const o of saved.draft) s.planner.add(o);
    s.startBot();
    return s;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify(): void {
    for (const fn of this.listeners) fn();
  }

  get finished(): boolean {
    return this.state.result !== null;
  }

  private startBot(): void {
    if (this.finished) return;
    this.botReady = false;
    const turn = this.state.turn;
    const promise = this.bot.choose(
      this.state,
      BOT,
      this.settings.difficulty,
      `${this.settings.seed}:bot`,
    );
    this.botOrders = promise;
    void promise.then(() => {
      if (this.botOrders === promise && this.state.turn === turn) {
        this.botReady = true;
        this.notify();
      }
    });
  }

  /** Submits the human's planned orders, resolves the turn, and returns the record for replay. */
  async submit(): Promise<TurnRecord> {
    if (this.finished || !this.botOrders) throw new Error("No turn to submit");
    const bot = await this.botOrders;
    const record = this.apply({ [HUMAN]: this.planner.orders, [BOT]: bot });
    this.startBot();
    this.notify();
    return record;
  }

  private apply(orders: Record<PlayerId, OrderSet>): TurnRecord {
    const before = this.state;
    const { state, events } = resolveTurn(before, orders);
    const record = { before, after: state, orders, events };
    this.history.push(record);
    this.state = state;
    this.planner = new Planner(state, HUMAN);
    this.recordStats();
    return record;
  }

  private recordStats(): void {
    const totals = playerTotals(this.state);
    const ids = this.state.players.map((p) => p.id);
    this.stats.push({
      turn: this.state.turn - 1,
      dominance: ids.map((id) => dominancePermille(this.state, id)),
      cells: ids.map((id) => totals.get(id)?.cells ?? 0),
      biomass: ids.map((id) => totals.get(id)?.biomass ?? 0),
    });
  }

  save(): SavedSkirmish {
    return {
      version: 1,
      settings: this.settings,
      turns: this.history.map((h) => h.orders),
      draft: this.planner.orders,
    };
  }

  dispose(): void {
    this.bot.dispose();
    this.listeners.clear();
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
