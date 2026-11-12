import { and, count, desc, eq, gt, sql } from "drizzle-orm";
import { chooseOrders } from "@swarm/bot";
import {
  COSMETICS,
  dailyDate,
  dailyScore,
  dailySetup,
  emptyProgress,
  isDailyDate,
  mergeProgress,
  SEASON_DAYS,
  SEASON_EPOCH_UTC,
  seasonAt,
  sectorFor,
  summarizeGame,
  type Progress,
} from "@swarm/content";
import {
  createGame,
  dominancePermille,
  RATING,
  resolveTurn,
  validateOrderSet,
  type GameState,
  type Order,
  type OrderSet,
  type PlayerId,
} from "@swarm/sim";
import type {
  DailyEntry,
  DailyResponse,
  DailySubmitResponse,
  LadderEntry,
  LadderMode,
  LadderResponse,
  ProgressJson,
} from "@swarm/protocol";
import type { Db } from "./db";
import type { Account, Clock, Logger } from "./engine";
import { GameError } from "./engine";
import { initialRating, rateGame } from "./glicko";
import { accounts, dailyScores, progress, ratings } from "./schema";

const DAY_MS = 86_400_000;
const LEADERBOARD_SIZE = 20;

/**
 * Progression services (SPEC §11): progress sync, the Daily Seed leaderboard and the ranked
 * ladder. Kept apart from GameEngine, which owns live games; the engine calls `rateFinished`
 * when a ranked game ends.
 */
export class Progression {
  constructor(
    private readonly db: Db,
    private readonly deps: { clock: Clock; log: Logger },
  ) {}

  // ----------------------------------------------------------------------------------------
  // Progress (SPEC §11.1): union merge, plus season rewards the server grants.

  async syncProgress(account: Account, incoming: ProgressJson | null): Promise<ProgressJson> {
    const row = await this.db.query.progress.findFirst({
      where: eq(progress.accountId, account.id),
    });
    const stored = (row?.data as Progress | undefined) ?? emptyProgress();
    let merged = incoming ? mergeProgress(incoming as Progress, stored) : stored;
    const rewards = await this.seasonRewards(account);
    if (rewards.some((r) => !merged.rewards.includes(r)))
      merged = { ...merged, rewards: [...new Set([...merged.rewards, ...rewards])].sort() };
    await this.db
      .insert(progress)
      .values({ accountId: account.id, data: merged as ProgressJson })
      .onConflictDoUpdate({
        target: progress.accountId,
        set: { data: merged as ProgressJson, updatedAt: new Date(this.deps.clock.now()) },
      });
    return merged as ProgressJson;
  }

  /** Season-end cosmetics (SPEC §11.2): earned by playing enough ranked games in a past season. */
  private async seasonRewards(account: Account): Promise<string[]> {
    const current = seasonAt(this.deps.clock.now()).season;
    const rows = await this.db
      .select({ season: ratings.season, games: sql<number>`sum(${ratings.games})::int` })
      .from(ratings)
      .where(eq(ratings.accountId, account.id))
      .groupBy(ratings.season);
    const out: string[] = [];
    for (const c of COSMETICS) {
      if (c.source.kind !== "season") continue;
      const min = c.source.minGames;
      if (rows.some((r) => r.season < current && r.games >= min)) out.push(c.id);
    }
    return out;
  }

  // ----------------------------------------------------------------------------------------
  // Daily Seed (SPEC §3, §9.5): replayed against the deterministic Normal bot.

  private today(): string {
    return dailyDate(this.deps.clock.now());
  }

  /**
   * Replays a Daily run: your orders each turn, the bot's from `chooseOrders` with the day's
   * seed. Every order set must be legal, and the game must end exactly on the last one.
   */
  validateDaily(
    date: string,
    turns: readonly OrderSet[],
  ): { score: number; outcome: "win" | "loss" | "draw"; turns: number } {
    const setup = dailySetup(date);
    let state: GameState = createGame(setup.config, setup.seed);
    const played: Record<PlayerId, OrderSet>[] = [];
    for (const [i, mine] of turns.entries()) {
      if (state.result) throw new GameError("badDaily", `The game ended before turn ${i + 1}`);
      const check = validateOrderSet(state, 0, mine);
      if (!check.ok)
        throw new GameError(
          "badDaily",
          `Turn ${i + 1}, order ${check.index + 1}: ${check.message}`,
        );
      const orders: Record<PlayerId, OrderSet> = {
        0: mine,
        1: chooseOrders(state, 1, "normal", setup.botSeed),
      };
      played.push(orders);
      state = resolveTurn(state, orders).state;
    }
    if (!state.result) throw new GameError("badDaily", "The game is not finished");
    const summary = summarizeGame(setup.config, setup.seed, played, 0, { mode: "daily" });
    return {
      score: dailyScore(summary, state.rules.turnLimit),
      outcome: summary.outcome,
      turns: summary.turns,
    };
  }

  async submitDaily(
    account: Account,
    date: string,
    turns: readonly OrderSet[],
  ): Promise<DailySubmitResponse> {
    // Today, or yesterday for a run that started before midnight UTC.
    const yesterday = dailyDate(this.deps.clock.now() - DAY_MS);
    if (!isDailyDate(date) || (date !== this.today() && date !== yesterday))
      throw new GameError("staleDaily", "That Daily Seed is closed");
    const run = this.validateDaily(date, turns);
    const prev = await this.db.query.dailyScores.findFirst({
      where: and(eq(dailyScores.date, date), eq(dailyScores.accountId, account.id)),
    });
    const best = !prev || run.score > prev.score;
    if (best) {
      const values = {
        score: run.score,
        outcome: run.outcome,
        turns: run.turns,
        orders: turns as Order[][],
        submittedAt: new Date(this.deps.clock.now()),
      };
      await this.db
        .insert(dailyScores)
        .values({ date, accountId: account.id, ...values })
        .onConflictDoUpdate({ target: [dailyScores.date, dailyScores.accountId], set: values });
    }
    const score = best ? run.score : (prev?.score ?? run.score);
    return {
      score: run.score,
      best,
      rank: await this.dailyRank(date, score),
      streak: await this.streak(account, date),
    };
  }

  private async dailyRank(date: string, score: number): Promise<number> {
    const [r] = await this.db
      .select({ n: count() })
      .from(dailyScores)
      .where(and(eq(dailyScores.date, date), gt(dailyScores.score, score)));
    return (r?.n ?? 0) + 1;
  }

  /** Consecutive days with a submission, ending on `date` (or the day before it). */
  private async streak(account: Account, date: string): Promise<number> {
    const rows = await this.db
      .select({ date: dailyScores.date })
      .from(dailyScores)
      .where(eq(dailyScores.accountId, account.id))
      .orderBy(desc(dailyScores.date))
      .limit(400);
    const days = new Set(rows.map((r) => r.date));
    let day = Date.parse(`${date}T00:00:00Z`);
    if (!days.has(date)) day -= DAY_MS;
    let n = 0;
    while (days.has(dailyDate(day))) {
      n++;
      day -= DAY_MS;
    }
    return n;
  }

  async daily(account: Account, date = this.today()): Promise<DailyResponse> {
    if (!isDailyDate(date)) throw new GameError("badRequest", "Bad date");
    const rows = await this.db
      .select({
        accountId: dailyScores.accountId,
        name: accounts.name,
        score: dailyScores.score,
        outcome: dailyScores.outcome,
        turns: dailyScores.turns,
      })
      .from(dailyScores)
      .innerJoin(accounts, eq(accounts.id, dailyScores.accountId))
      .where(eq(dailyScores.date, date))
      .orderBy(desc(dailyScores.score), dailyScores.submittedAt)
      .limit(LEADERBOARD_SIZE);
    const [total] = await this.db
      .select({ n: count() })
      .from(dailyScores)
      .where(eq(dailyScores.date, date));
    // Equal scores share a rank.
    const entries: DailyEntry[] = [];
    for (const [i, r] of rows.entries()) {
      const prev = entries[i - 1];
      entries.push({
        rank: prev && prev.score === r.score ? prev.rank : i + 1,
        name: r.name,
        score: r.score,
        outcome: r.outcome,
        turns: r.turns,
        you: r.accountId === account.id,
      });
    }
    const mine = await this.db.query.dailyScores.findFirst({
      where: and(eq(dailyScores.date, date), eq(dailyScores.accountId, account.id)),
    });
    return {
      date,
      entries,
      me: mine
        ? {
            rank: await this.dailyRank(date, mine.score),
            name: account.name,
            score: mine.score,
            outcome: mine.outcome,
            turns: mine.turns,
            you: true,
          }
        : null,
      streak: await this.streak(account, this.today()),
      players: total?.n ?? 0,
    };
  }

  // ----------------------------------------------------------------------------------------
  // Ranked ladder (SPEC §11.2)

  /** The season and its sector for a ranked game created now. */
  currentSeason(): { season: number; sector: ReturnType<typeof sectorFor> } {
    const { season } = seasonAt(this.deps.clock.now());
    return { season, sector: sectorFor(season) };
  }

  /**
   * Updates ratings when a ranked game ends. Places: the winner first, then everyone else by
   * final dominance (eliminated players last); equal dominance draws (DECISIONS).
   */
  async rateFinished(
    season: number,
    seats: readonly { accountId: string; seat: number }[],
    final: GameState,
  ): Promise<void> {
    const mode: LadderMode = seats.length === 2 ? "duel" : "ffa";
    const winner = final.result?.winner ?? null;
    const key = (seat: number) =>
      seat === winner ? Number.MAX_SAFE_INTEGER : dominancePermille(final, seat);
    const keys = seats.map((s) => key(s.seat));
    const places = keys.map((k) => keys.filter((o) => o > k).length);
    await this.db.transaction(async (tx) => {
      const current = await Promise.all(
        seats.map(async (s) => {
          const row = await tx.query.ratings.findFirst({
            where: and(
              eq(ratings.accountId, s.accountId),
              eq(ratings.mode, mode),
              eq(ratings.season, season),
            ),
          });
          return row ?? null;
        }),
      );
      const next = rateGame(
        current.map((r, i) => ({
          rating: r ?? initialRating(),
          place: places[i] as number,
        })),
      );
      for (const [i, s] of seats.entries()) {
        const r = next[i] as ReturnType<typeof initialRating>;
        const won = places[i] === 0 && keys.filter((k) => k === keys[i]).length === 1 ? 1 : 0;
        const prev = current[i];
        const values = {
          rating: r.rating,
          deviation: r.deviation,
          volatility: r.volatility,
          games: (prev?.games ?? 0) + 1,
          wins: (prev?.wins ?? 0) + won,
          updatedAt: new Date(this.deps.clock.now()),
        };
        await tx
          .insert(ratings)
          .values({ accountId: s.accountId, mode, season, ...values })
          .onConflictDoUpdate({
            target: [ratings.accountId, ratings.mode, ratings.season],
            set: values,
          });
      }
    });
    this.deps.log.info({ season, mode, players: seats.length }, "ranked game rated");
  }

  async ladder(account: Account, mode: LadderMode, season?: number): Promise<LadderResponse> {
    const s = season ?? seasonAt(this.deps.clock.now()).season;
    const ends = SEASON_EPOCH_UTC + (s + 1) * SEASON_DAYS * DAY_MS;
    const sector = sectorFor(s);
    const placed = and(
      eq(ratings.mode, mode),
      eq(ratings.season, s),
      sql`${ratings.games} >= ${RATING.provisionalGames}`,
    );
    const rows = await this.db
      .select({
        accountId: ratings.accountId,
        name: accounts.name,
        rating: ratings.rating,
        deviation: ratings.deviation,
        games: ratings.games,
        wins: ratings.wins,
      })
      .from(ratings)
      .innerJoin(accounts, eq(accounts.id, ratings.accountId))
      .where(placed)
      .orderBy(desc(ratings.rating))
      .limit(LEADERBOARD_SIZE);
    const entry = (r: (typeof rows)[number], rank: number): LadderEntry => ({
      rank,
      name: r.name,
      rating: Math.round(r.rating),
      deviation: Math.round(r.deviation),
      games: r.games,
      wins: r.wins,
      you: r.accountId === account.id,
    });
    const mine = await this.db
      .select({
        accountId: ratings.accountId,
        name: accounts.name,
        rating: ratings.rating,
        deviation: ratings.deviation,
        games: ratings.games,
        wins: ratings.wins,
      })
      .from(ratings)
      .innerJoin(accounts, eq(accounts.id, ratings.accountId))
      .where(and(eq(ratings.accountId, account.id), eq(ratings.mode, mode), eq(ratings.season, s)));
    let me: LadderEntry | null = null;
    const m = mine[0];
    if (m) {
      let rank = 0;
      if (m.games >= RATING.provisionalGames) {
        const [above] = await this.db
          .select({ n: count() })
          .from(ratings)
          .where(and(placed, gt(ratings.rating, m.rating)));
        rank = (above?.n ?? 0) + 1;
      }
      me = entry(m, rank);
    }
    return {
      mode,
      season: s,
      sector: { id: sector.id, name: sector.name, description: sector.description },
      endsAt: new Date(ends).toISOString(),
      entries: rows.map((r, i) => entry(r, i + 1)),
      me,
    };
  }
}
