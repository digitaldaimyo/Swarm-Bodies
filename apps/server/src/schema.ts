import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { GameState, Order, Rules } from "@swarm/sim";
import type { GameSettings, ProgressJson, Strain } from "@swarm/protocol";

/** SPEC §9.4 persistence. Game state is rebuilt from the seed plus the orders (plus snapshots). */

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** sha-256 of the bearer token; the token itself is never stored. */
  tokenHash: text("token_hash").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const games = pgTable("games", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  settings: jsonb("settings").$type<GameSettings>().notNull(),
  seed: text("seed").notNull(),
  status: text("status").$type<"lobby" | "active" | "finished">().notNull().default("lobby"),
  /** The turn being planned (matches GameState.turn). */
  turn: integer("turn").notNull().default(1),
  deadline: timestamp("deadline", { withTimezone: true }),
  hostAccount: uuid("host_account")
    .notNull()
    .references(() => accounts.id),
  result: jsonb("result").$type<GameState["result"]>(),
  /** Turn for which the "1 h before the deadline" push went out (SPEC §9.4 Web Push). */
  reminderSentTurn: integer("reminder_sent_turn").notNull().default(0),
  /** M7: a ranked ladder game (SPEC §11.2), and its season. */
  ranked: boolean("ranked").notNull().default(false),
  season: integer("season"),
  /** M7: rule overrides the game was created with (the season's sector); null for none. */
  rules: jsonb("rules").$type<Partial<Rules>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const gamePlayers = pgTable(
  "game_players",
  {
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    seat: integer("seat").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    strain: text("strain").$type<Strain>().notNull(),
    botControlled: boolean("bot_controlled").notNull().default(false),
    missedTurns: integer("missed_turns").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.gameId, t.seat] }),
    uniqueIndex("game_players_account").on(t.gameId, t.accountId),
  ],
);

/** Sealed orders submitted for the turn being planned. */
export const turnOrders = pgTable(
  "turn_orders",
  {
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    turn: integer("turn").notNull(),
    seat: integer("seat").notNull(),
    orders: jsonb("orders").$type<Order[]>().notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.turn, t.seat] })],
);

/**
 * One row per resolved turn. The (game_id, turn) key makes resolution idempotent (SPEC §9.4).
 * `orders` holds what the sim actually resolved, bot and missed turns included, so replays
 * and restarts never depend on rerunning the bot.
 */
export const turnResults = pgTable(
  "turn_results",
  {
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    turn: integer("turn").notNull(),
    orders: jsonb("orders").$type<Record<string, Order[]>>().notNull(),
    stateHash: text("state_hash").notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.turn] })],
);

/** Full state every 10 turns, for fast loading (SPEC §9.4). `turn` is the state's turn. */
export const gameSnapshots = pgTable(
  "game_snapshots",
  {
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    turn: integer("turn").notNull(),
    state: jsonb("state").$type<GameState>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.turn] })],
);

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Campaign and codex progress, synced from devices by union (SPEC §11.1). */
export const progress = pgTable("progress", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<ProgressJson>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Daily Seed scores (SPEC §3): the best validated run per account and day. The orders are kept
 * so any score can be replayed and checked again.
 */
export const dailyScores = pgTable(
  "daily_scores",
  {
    date: text("date").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    outcome: text("outcome").$type<"win" | "loss" | "draw">().notNull(),
    turns: integer("turns").notNull(),
    orders: jsonb("orders").$type<Order[][]>().notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.date, t.accountId] }),
    index("daily_scores_rank").on(t.date, t.score),
  ],
);

/** Glicko-2 ratings per account, mode and season (SPEC §11.2). */
export const ratings = pgTable(
  "ratings",
  {
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    mode: text("mode").$type<"duel" | "ffa">().notNull(),
    season: integer("season").notNull(),
    rating: doublePrecision("rating").notNull(),
    deviation: doublePrecision("deviation").notNull(),
    volatility: doublePrecision("volatility").notNull(),
    games: integer("games").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.mode, t.season] }),
    index("ratings_board").on(t.mode, t.season, t.rating),
  ],
);
