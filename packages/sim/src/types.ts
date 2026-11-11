import type { BodySize, BodyType, DepositKind, Rules } from "./config";
import type { Hex } from "./hex";

export type PlayerId = number;

export type Terrain = "regolith" | "rock";

/** A cell a player owns (SPEC §2). */
export interface Colony {
  owner: PlayerId;
  biomass: number;
  core: boolean;
  /** Result of the last connectivity pass (SPEC §5.3 phase 8). */
  connected: boolean;
}

export interface Body {
  id: number;
  size: BodySize;
  type: BodyType;
  radius: number;
  /** Indexed by board cell index (see getBoard). */
  terrain: Terrain[];
  deposits: (DepositKind | null)[];
  colony: (Colony | null)[];
}

export interface PlayerState {
  id: PlayerId;
  nutrients: number;
  eliminated: boolean;
  /** Turn on which the player was eliminated, or null. */
  eliminatedOnTurn: number | null;
  /** Consecutive end-of-turn checks at or above the dominance threshold (SPEC §3). */
  dominanceStreak: number;
  /** Start cell of the home core, for reference by UI and tests. */
  home: { body: number; cell: Hex };
}

export type GameMode = "singleRock";

export interface GameConfig {
  mode: GameMode;
  playerCount: number;
  rules?: Partial<Rules>;
}

export type VictoryReason = "lastStanding" | "dominance" | "turnLimit" | "draw";

export interface GameResult {
  winner: PlayerId | null;
  reason: VictoryReason;
  turn: number;
}

export interface GameState {
  version: 1;
  seed: string;
  mode: GameMode;
  rules: Rules;
  /** The turn currently being planned. Starts at 1. */
  turn: number;
  bodies: Body[];
  players: PlayerState[];
  result: GameResult | null;
}

/** A cell on a body, as used in orders and events. */
export interface CellRef {
  body: number;
  q: number;
  r: number;
}

export interface GrowOrder {
  type: "grow";
  body: number;
  /** path[0] is the start cell (an own connected cell); path[1..] are the cells grown into. */
  path: Hex[];
}

export interface ReinforceOrder {
  type: "reinforce";
  body: number;
  cell: Hex;
}

export interface RetractOrder {
  type: "retract";
  body: number;
  cell: Hex;
}

export type Order = GrowOrder | ReinforceOrder | RetractOrder;
export type OrderSet = Order[];

export type RejectReason =
  | "gameOver"
  | "eliminated"
  | "tooManyOrders"
  | "malformed"
  | "noSuchBody"
  | "offBoard"
  | "rock"
  | "notOwn"
  | "notConnected"
  | "isCore"
  | "pathTooShort"
  | "pathTooLong"
  | "pathNotAdjacent"
  | "pathRepeats"
  | "pathNoNewCells"
  | "duplicateGrowStart"
  | "overlappingPath"
  | "alreadyReinforced"
  | "atMaxBiomass"
  | "duplicateRetract"
  | "conflictsWithOrder"
  | "insufficientNutrients";

export type ValidationResult =
  { ok: true; cost: number } | { ok: false; reason: RejectReason; message: string };

export type GameEvent =
  | { type: "OrderRejected"; player: PlayerId; index: number; reason: RejectReason }
  | { type: "OrdersPaid"; player: PlayerId; cost: number; nutrients: number }
  | { type: "Retracted"; player: PlayerId; cell: CellRef; refund: number }
  | { type: "Reinforced"; player: PlayerId; cell: CellRef; biomass: number }
  | { type: "GrowthStep"; step: number }
  | {
      type: "CellClaimed";
      player: PlayerId;
      step: number;
      order: number;
      cell: CellRef;
      biomass: number;
      attack: number;
    }
  | {
      type: "CellCaptured";
      player: PlayerId;
      from: PlayerId;
      step: number;
      order: number;
      cell: CellRef;
      attack: number;
      defense: number;
      biomass: number;
    }
  | {
      type: "AssaultRepelled";
      player: PlayerId;
      defender: PlayerId;
      step: number;
      order: number;
      cell: CellRef;
      attack: number;
      defense: number;
      defenderBiomass: number;
    }
  | { type: "CellStalemate"; players: PlayerId[]; step: number; cell: CellRef; attack: number }
  | {
      type: "PathHalted";
      player: PlayerId;
      step: number;
      order: number;
      cell: CellRef;
      reason: "lost" | "stalemate" | "repelled" | "brokenPath";
    }
  | { type: "CoreDestroyed"; player: PlayerId; by: PlayerId; cell: CellRef }
  | { type: "Starved"; player: PlayerId; cell: CellRef; biomass: number }
  | { type: "Income"; player: PlayerId; amount: number; nutrients: number }
  | { type: "PlayerEliminated"; player: PlayerId }
  | { type: "GameOver"; result: GameResult };

export interface ResolveResult {
  state: GameState;
  events: GameEvent[];
}
