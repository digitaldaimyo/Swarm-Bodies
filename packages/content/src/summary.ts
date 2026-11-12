import {
  createGame,
  dominancePermille,
  resolveTurn,
  type GameConfig,
  type GameResult,
  type GameState,
  type MutationId,
  type OrderSet,
  type PlayerId,
  type StrainId,
  type VictoryReason,
} from "@swarm/sim";

/**
 * A finished game from one player's point of view (SPEC §11.3): achievements, campaign
 * objectives and the Daily score are predicates over this. It is rebuilt from the seed plus the
 * orders, like everything else, so a summary can be recomputed and checked by the server.
 */
export type PlayMode = "skirmish" | "campaign" | "daily" | "online" | "ranked";

export interface SummaryContext {
  mode: PlayMode;
  /** The bots' difficulty in offline modes. */
  difficulty?: "easy" | "normal" | "hard";
  campaignNode?: string;
  /** Consecutive days with a Daily Seed submission, including this one. */
  dailyStreak?: number;
}

export interface GameSummary {
  player: PlayerId;
  context: SummaryContext;
  map: GameConfig["mode"];
  players: number;
  strain: StrainId;
  mutations: MutationId[];
  outcome: "win" | "loss" | "draw";
  reason: VictoryReason;
  turns: number;
  finalDominance: number;
  peakDominance: number;
  /** Fewest cells held at the end of any turn after turn 3 (comebacks). */
  lowestCellsAfterTurn3: number;
  cellsClaimed: number;
  captures: number;
  coresDestroyed: number;
  coresLost: number;
  launches: number;
  sporeNewCores: number;
  sporeCoreCaptures: number;
  stalemates: number;
  reinforces: number;
  retracts: number;
  fruits: number;
  /** Most bodies this player held cells on at once. */
  maxBodiesHeld: number;
  /** Every body this player ever held cells on. */
  bodiesTouched: number;
  starvedCells: number;
  flareHits: number;
  cometIncomeTurns: number;
  nutrientsFromCaptures: number;
  maxNutrients: number;
  ordersIssued: number;
}

export function summarizeGame(
  config: GameConfig,
  seed: string,
  turns: readonly Record<PlayerId, OrderSet>[],
  player: PlayerId,
  context: SummaryContext,
): GameSummary {
  let state: GameState = createGame(config, seed);
  const s: GameSummary = {
    player,
    context,
    map: config.mode,
    players: config.playerCount,
    strain: state.players.find((p) => p.id === player)?.strain ?? "base",
    mutations: [],
    outcome: "draw",
    reason: "draw",
    turns: 0,
    finalDominance: 0,
    peakDominance: 0,
    lowestCellsAfterTurn3: Infinity,
    cellsClaimed: 0,
    captures: 0,
    coresDestroyed: 0,
    coresLost: 0,
    launches: 0,
    sporeNewCores: 0,
    sporeCoreCaptures: 0,
    stalemates: 0,
    reinforces: 0,
    retracts: 0,
    fruits: 0,
    maxBodiesHeld: 0,
    bodiesTouched: 0,
    starvedCells: 0,
    flareHits: 0,
    cometIncomeTurns: 0,
    nutrientsFromCaptures: 0,
    maxNutrients: 0,
    ordersIssued: 0,
  };
  const touched = new Set<number>();
  for (const orders of turns) {
    if (state.result) break;
    s.ordersIssued += (orders[player] ?? []).filter((o) => o.type !== "draft").length;
    const { state: next, events } = resolveTurn(state, orders);
    const sporeCells = new Set<string>();
    for (const e of events) {
      if (e.type === "SporeLanded" && e.player === player && e.outcome === "captured")
        sporeCells.add(`${e.cell.body}:${e.cell.q},${e.cell.r}`);
    }
    for (const e of events) {
      switch (e.type) {
        case "CellClaimed":
          if (e.player === player) s.cellsClaimed++;
          break;
        case "CellCaptured":
          if (e.player === player) s.captures++;
          break;
        case "CoreDestroyed":
          if (e.by === player) {
            s.coresDestroyed++;
            if (sporeCells.has(`${e.cell.body}:${e.cell.q},${e.cell.r}`)) s.sporeCoreCaptures++;
          }
          if (e.player === player) s.coresLost++;
          break;
        case "SporeLaunched":
          if (e.player === player) s.launches++;
          break;
        case "SporeLanded":
          if (e.player === player && e.outcome === "newCore") s.sporeNewCores++;
          if (e.player === player && e.outcome === "captured") s.captures++;
          break;
        case "CellStalemate":
          if (e.players.includes(player)) s.stalemates++;
          break;
        case "Reinforced":
          if (e.player === player) s.reinforces++;
          break;
        case "Retracted":
          if (e.player === player) s.retracts++;
          break;
        case "FruitStarted":
          if (e.player === player) s.fruits++;
          break;
        case "Starved":
          if (e.player === player && e.biomass === 0) s.starvedCells++;
          break;
        case "FlareStruck":
          if (e.player === player) s.flareHits++;
          break;
        case "CaptureFed":
          if (e.player === player) s.nutrientsFromCaptures += e.amount;
          break;
        default:
          break;
      }
    }
    state = next;
    let cells = 0;
    let bodies = 0;
    let onComet = false;
    for (const b of state.bodies) {
      let here = false;
      b.colony.forEach((c, i) => {
        if (c?.owner !== player) return;
        cells++;
        here = true;
        if (c.connected && b.comets.some((m) => m.cell === i)) onComet = true;
      });
      if (here) {
        bodies++;
        touched.add(b.id);
      }
    }
    if (onComet) s.cometIncomeTurns++;
    s.maxBodiesHeld = Math.max(s.maxBodiesHeld, bodies);
    if (state.turn > 4) s.lowestCellsAfterTurn3 = Math.min(s.lowestCellsAfterTurn3, cells);
    const d = dominancePermille(state, player);
    s.peakDominance = Math.max(s.peakDominance, d);
    s.finalDominance = d;
    const ps = state.players.find((p) => p.id === player);
    s.maxNutrients = Math.max(s.maxNutrients, ps?.nutrients ?? 0);
  }
  const ps = state.players.find((p) => p.id === player);
  s.mutations = ps?.mutations.slice() ?? [];
  s.bodiesTouched = touched.size;
  const result = state.result as GameResult | null;
  s.turns = result?.turn ?? state.turn;
  s.reason = result?.reason ?? "draw";
  s.outcome =
    !result || result.winner === null ? "draw" : result.winner === player ? "win" : "loss";
  if (s.lowestCellsAfterTurn3 === Infinity) s.lowestCellsAfterTurn3 = 0;
  return s;
}
