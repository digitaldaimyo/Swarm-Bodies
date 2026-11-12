import type { Difficulty } from "@swarm/bot";
import { createGame, type Order, type OrderSet, type PlayerId, type StrainId } from "@swarm/sim";
import type { BotRunner } from "./bot-client";
import { SessionBase, type MatchSession, type SeatStatus } from "./match-session";

export { matchSummary, type TurnRecord, type TurnStats } from "./match-session";

export const HUMAN: PlayerId = 0;
export const BOT: PlayerId = 1;

export interface SkirmishSettings {
  seed: string;
  difficulty: Difficulty;
  /** Your strain and the bot's (SPEC §7.1). */
  strain: Exclude<StrainId, "base">;
  botStrain: Exclude<StrainId, "base">;
}

/** The saved form of a skirmish: the seed plus every turn's orders (SPEC §9.4: reconstructable). */
export interface SavedSkirmish {
  version: 2;
  settings: SkirmishSettings;
  turns: Record<PlayerId, OrderSet>[];
  draft: Order[];
}

/**
 * One offline skirmish against the bot (SPEC §3, §9.5). The bot plans in its worker as soon as
 * a turn starts; its orders stay sealed until the human submits.
 */
export class SkirmishSession extends SessionBase implements MatchSession {
  readonly kind = "skirmish" as const;
  readonly deadline = null;
  readonly turnSeconds = null;
  private botOrders: Promise<OrderSet> | null = null;
  botReady = false;
  private resolving = false;

  constructor(
    readonly settings: SkirmishSettings,
    private readonly bot: BotRunner,
    startBot = true,
  ) {
    super(
      createGame(
        { mode: "singleRock", playerCount: 2, strains: [settings.strain, settings.botStrain] },
        settings.seed,
      ),
      HUMAN,
    );
    if (startBot) this.startBot();
  }

  /** Rebuilds a saved skirmish by replaying its orders through the sim. */
  static restore(saved: SavedSkirmish, bot: BotRunner): SkirmishSession {
    const s = new SkirmishSession(saved.settings, bot, false);
    for (const orders of saved.turns) s.applyTurn(orders);
    for (const o of saved.draft) s.planner.add(o);
    s.startBot();
    return s;
  }

  get description(): string {
    return `${this.settings.difficulty === "easy" ? "Easy" : "Normal"} bot · seed ${this.settings.seed}`;
  }

  get submitted(): boolean {
    return this.resolving;
  }

  name(seat: PlayerId): string {
    return seat === HUMAN ? "You" : "Bot";
  }

  seats(): SeatStatus[] {
    return this.state.players.map((p) => ({
      seat: p.id,
      name: this.name(p.id),
      strain: p.strain,
      you: p.id === HUMAN,
      ready: p.id === HUMAN ? this.resolving : this.botReady,
      thinking: p.id === BOT && !this.botReady,
      botControlled: false,
      connected: true,
    }));
  }

  canUnsubmit(): boolean {
    return false;
  }

  unsubmit(): void {}

  saveDraft(): void {
    // Skirmish drafts are saved with the game (see storage.ts).
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

  /** Resolves as soon as the bot's sealed orders are ready, then emits the turn. */
  submit(): void {
    if (this.finished || !this.botOrders || this.resolving) return;
    this.resolving = true;
    this.notify();
    void this.botOrders.then((bot) => {
      const record = this.applyTurn({ [HUMAN]: this.planner.orders, [BOT]: bot });
      this.resolving = false;
      this.startBot();
      this.emitTurn(record);
      this.notify();
    });
  }

  /** Resolves one turn and waits for it (tests, and the e2e scripted player). */
  async submitAndWait(): Promise<void> {
    await new Promise<void>((resolve) => {
      const off = this.onTurn(() => {
        off();
        resolve();
      });
      this.submit();
    });
  }

  save(): SavedSkirmish {
    return {
      version: 2,
      settings: this.settings,
      turns: this.history.map((h) => h.orders),
      draft: this.planner.orders,
    };
  }

  override dispose(): void {
    this.bot.dispose();
    super.dispose();
  }
}
