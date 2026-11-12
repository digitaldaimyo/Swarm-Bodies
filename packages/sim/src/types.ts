import type { BodySize, BodyType, DepositKind, Rules, StrainId } from "./config";
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
  /** Turns until this fruiting body matures (0 = mature, can launch), or null (SPEC §5.1). */
  fruiting: number | null;
}

/** SPEC §4.5. Radius in distance units, period in turns, phase in degrees. */
export interface Orbit {
  radius: number;
  period: number;
  phase: number;
}

/** A comet's temporary deposit (SPEC §8): gone after `until`'s events phase. */
export interface CometDeposit {
  cell: number;
  yield: number;
  until: number;
}

/** A spore in flight (SPEC §6). */
export interface Spore {
  id: number;
  owner: PlayerId;
  sourceBody: number;
  targetBody: number;
  targetCell: Hex;
  landing: number;
  launchedTurn: number;
  arrivalTurn: number;
}

/** Events scheduled at system generation (SPEC §8), visible in the forecast. */
export type ScheduledEvent =
  { kind: "flare"; turn: number } | { kind: "comet"; turn: number; body: number };

export interface Body {
  id: number;
  size: BodySize;
  type: BodyType;
  radius: number;
  /** Indexed by board cell index (see getBoard). */
  terrain: Terrain[];
  deposits: (DepositKind | null)[];
  colony: (Colony | null)[];
  /** Null in Single Rock, which has no orbits. */
  orbit: Orbit | null;
  /** The player whose home this is, if any. */
  home: PlayerId | null;
  comets: CometDeposit[];
}

export interface PlayerState {
  id: PlayerId;
  strain: StrainId;
  nutrients: number;
  eliminated: boolean;
  /** Turn on which the player was eliminated, or null. */
  eliminatedOnTurn: number | null;
  /** Consecutive end-of-turn checks at or above the dominance threshold (SPEC §3). */
  dominanceStreak: number;
  /** Start cell of the home core, for reference by UI and tests. */
  home: { body: number; cell: Hex };
}

export type GameMode = "singleRock" | "system";

export interface GameConfig {
  mode: GameMode;
  playerCount: number;
  /** One strain per player, by seat. Missing entries are "base". */
  strains?: StrainId[];
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
  spores: Spore[];
  nextSporeId: number;
  schedule: ScheduledEvent[];
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

/** Grow a spore launcher on an own connected cell (SPEC §5.1). */
export interface FruitOrder {
  type: "fruit";
  body: number;
  cell: Hex;
}

/** Fire a mature fruiting body at a cell on another body in range (SPEC §5.1, §6). */
export interface LaunchOrder {
  type: "launch";
  body: number;
  cell: Hex;
  targetBody: number;
  targetCell: Hex;
}

export type Order = GrowOrder | ReinforceOrder | RetractOrder | FruitOrder | LaunchOrder;
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
  | "insufficientNutrients"
  | "noLaunches"
  | "tooLittleBiomass"
  | "alreadyFruiting"
  | "tooManyFruiting"
  | "notFruiting"
  | "notMature"
  | "sameBody"
  | "outOfRange"
  | "duplicateLaunch";

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
  | { type: "FruitStarted"; player: PlayerId; cell: CellRef }
  | { type: "FruitMatured"; player: PlayerId; cell: CellRef }
  | {
      type: "SporeLaunched";
      player: PlayerId;
      spore: number;
      from: CellRef;
      targetBody: number;
      arrivalTurn: number;
    }
  | { type: "LaunchFizzled"; player: PlayerId; from: CellRef }
  | {
      type: "SporeLanded";
      player: PlayerId;
      spore: number;
      cell: CellRef;
      outcome: "newCore" | "captured" | "repelled" | "merged" | "collided";
      biomass: number;
      from: PlayerId | null;
    }
  | { type: "FlareWarning"; impactTurn: number }
  | { type: "FlareStruck"; player: PlayerId; cell: CellRef; biomass: number }
  | { type: "Flare" }
  | { type: "CometWarning"; arrivalTurn: number; body: number }
  | { type: "CometArrived"; cell: CellRef; until: number; yield: number }
  | { type: "CometFaded"; cell: CellRef }
  | { type: "Irradiated"; player: PlayerId; cell: CellRef }
  | { type: "PlayerEliminated"; player: PlayerId }
  | { type: "GameOver"; result: GameResult };

export interface ResolveResult {
  state: GameState;
  events: GameEvent[];
}
