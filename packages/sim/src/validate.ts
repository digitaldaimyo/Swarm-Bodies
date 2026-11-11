import { areAdjacent, getBoard, type Hex } from "./hex";
import { cellIndexOf, entryCost, maxBiomassFor } from "./rules";
import type { Body, GameState, Order, PlayerId, RejectReason, ValidationResult } from "./types";

/**
 * Order validation (SPEC §5.1). This is the single implementation used by the client while
 * planning, by the server and by every bot; `resolveTurn` re-runs it against the start-of-turn
 * state in phase 2.
 */

interface PlanContext {
  cost: number;
  count: number;
  /** Keys are `${body}:${cellIndex}`. */
  growStarts: Set<string>;
  growNewCells: Set<string>;
  growAllCells: Set<string>;
  reinforced: Set<string>;
  retracted: Set<string>;
}

function emptyContext(): PlanContext {
  return {
    cost: 0,
    count: 0,
    growStarts: new Set(),
    growNewCells: new Set(),
    growAllCells: new Set(),
    reinforced: new Set(),
    retracted: new Set(),
  };
}

const key = (body: number, i: number): string => `${body}:${i}`;

function fail(reason: RejectReason, message: string): ValidationResult {
  return { ok: false, reason, message };
}

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

function isHex(v: unknown): v is Hex {
  if (typeof v !== "object" || v === null) return false;
  const h = v as Record<string, unknown>;
  return isInt(h["q"]) && isInt(h["r"]);
}

/** Structural check for untrusted input. */
export function isWellFormedOrder(order: unknown): order is Order {
  if (typeof order !== "object" || order === null) return false;
  const o = order as Record<string, unknown>;
  if (!isInt(o["body"])) return false;
  switch (o["type"]) {
    case "grow":
      return Array.isArray(o["path"]) && o["path"].length <= 64 && o["path"].every(isHex);
    case "reinforce":
    case "retract":
      return isHex(o["cell"]);
    default:
      return false;
  }
}

/** Indices of `path` (from 1) that are new cells, i.e. not owned by `player` at validation time. */
export function newCellPositions(body: Body, player: PlayerId, path: readonly Hex[]): number[] {
  const out: number[] = [];
  for (let j = 1; j < path.length; j++) {
    const c = body.colony[cellIndexOf(body, path[j] as Hex)];
    if (!c || c.owner !== player) out.push(j);
  }
  return out;
}

function checkOne(
  state: GameState,
  player: PlayerId,
  order: unknown,
  ctx: PlanContext,
): ValidationResult {
  if (state.result) return fail("gameOver", "The game is over.");
  const ps = state.players.find((p) => p.id === player);
  if (!ps || ps.eliminated) return fail("eliminated", "This player is eliminated.");
  if (ctx.count >= state.rules.maxOrdersPerSet) {
    return fail("tooManyOrders", `At most ${state.rules.maxOrdersPerSet} orders per turn.`);
  }
  if (!isWellFormedOrder(order)) return fail("malformed", "The order is malformed.");
  const body = state.bodies.find((b) => b.id === order.body);
  if (!body) return fail("noSuchBody", "No such body.");
  const board = getBoard(body.radius);

  const locate = (h: Hex): number => board.indexOf(h.q, h.r);

  let cost = 0;
  switch (order.type) {
    case "grow": {
      const { path } = order;
      if (path.length < 2) return fail("pathTooShort", "A grow path needs at least one new cell.");
      if (path.length - 1 > state.rules.growReach) {
        return fail("pathTooLong", `Grow reach is ${state.rules.growReach}.`);
      }
      const idx: number[] = [];
      for (const h of path) {
        const i = locate(h);
        if (i < 0) return fail("offBoard", "The path leaves the body.");
        if (body.terrain[i] === "rock") return fail("rock", "The path crosses rock.");
        if (idx.includes(i)) return fail("pathRepeats", "The path visits a cell twice.");
        idx.push(i);
      }
      for (let j = 1; j < path.length; j++) {
        if (!areAdjacent(path[j - 1] as Hex, path[j] as Hex)) {
          return fail("pathNotAdjacent", "Path cells must be adjacent.");
        }
      }
      const startIdx = idx[0] as number;
      const start = body.colony[startIdx];
      if (!start || start.owner !== player)
        return fail("notOwn", "A path must start on your own cell.");
      if (!start.connected) return fail("notConnected", "A path must start on a connected cell.");
      if (ctx.growStarts.has(key(body.id, startIdx))) {
        return fail("duplicateGrowStart", "Only one grow path may start from a cell.");
      }
      const fresh = newCellPositions(body, player, path);
      if (fresh.length === 0) return fail("pathNoNewCells", "The path has no new cells.");
      for (const i of idx) {
        if (ctx.retracted.has(key(body.id, i))) {
          return fail("conflictsWithOrder", "The path uses a cell you are retracting.");
        }
      }
      for (const j of fresh) {
        const i = idx[j] as number;
        if (ctx.growNewCells.has(key(body.id, i))) {
          return fail("overlappingPath", "Another of your paths already targets that cell.");
        }
        cost += entryCost(state, body, i);
      }
      break;
    }
    case "reinforce": {
      const i = locate(order.cell);
      if (i < 0) return fail("offBoard", "No such cell.");
      const c = body.colony[i];
      if (!c || c.owner !== player) return fail("notOwn", "You can only reinforce your own cells.");
      if (!c.connected) return fail("notConnected", "You can only reinforce connected cells.");
      if (ctx.reinforced.has(key(body.id, i))) {
        return fail("alreadyReinforced", "Each cell may be reinforced once per turn.");
      }
      if (ctx.retracted.has(key(body.id, i))) {
        return fail("conflictsWithOrder", "That cell is being retracted.");
      }
      if (c.biomass >= maxBiomassFor(state, c))
        return fail("atMaxBiomass", "That cell is already at max biomass.");
      cost = state.rules.reinforceCost;
      break;
    }
    case "retract": {
      const i = locate(order.cell);
      if (i < 0) return fail("offBoard", "No such cell.");
      const c = body.colony[i];
      if (!c || c.owner !== player) return fail("notOwn", "You can only retract your own cells.");
      if (c.core) return fail("isCore", "Cores cannot be retracted.");
      const k = key(body.id, i);
      if (ctx.retracted.has(k))
        return fail("duplicateRetract", "That cell is already being retracted.");
      if (ctx.growAllCells.has(k) || ctx.reinforced.has(k)) {
        return fail("conflictsWithOrder", "Another of your orders uses that cell.");
      }
      cost = 0;
      break;
    }
  }

  if (ctx.cost + cost > ps.nutrients) {
    return fail("insufficientNutrients", `Needs ${ctx.cost + cost} N, you have ${ps.nutrients} N.`);
  }
  return { ok: true, cost };
}

/** Records an accepted order in the context. */
function commit(
  state: GameState,
  player: PlayerId,
  order: Order,
  cost: number,
  ctx: PlanContext,
): void {
  const body = state.bodies.find((b) => b.id === order.body) as Body;
  ctx.cost += cost;
  ctx.count++;
  switch (order.type) {
    case "grow": {
      const idx = order.path.map((h) => cellIndexOf(body, h));
      ctx.growStarts.add(key(body.id, idx[0] as number));
      for (const i of idx) ctx.growAllCells.add(key(body.id, i));
      for (const j of newCellPositions(body, player, order.path))
        ctx.growNewCells.add(key(body.id, idx[j] as number));
      break;
    }
    case "reinforce":
      ctx.reinforced.add(key(body.id, cellIndexOf(body, order.cell)));
      break;
    case "retract":
      ctx.retracted.add(key(body.id, cellIndexOf(body, order.cell)));
      break;
  }
}

/**
 * Validates `order` as the next order after `pending`, which are assumed to have been accepted
 * already (as they are while planning in the UI).
 */
export function validateOrder(
  state: GameState,
  player: PlayerId,
  order: Order,
  pending: readonly Order[],
): ValidationResult {
  const ctx = emptyContext();
  for (const p of pending) {
    const r = checkOne(state, player, p, ctx);
    if (r.ok) commit(state, player, p, r.cost, ctx);
  }
  return checkOne(state, player, order, ctx);
}

export type OrderSetValidation =
  { ok: true; cost: number } | { ok: false; index: number; reason: RejectReason; message: string };

/** Validates a whole order set in order; reports the first invalid order. */
export function validateOrderSet(
  state: GameState,
  player: PlayerId,
  orders: readonly Order[],
): OrderSetValidation {
  const result = filterOrderSet(state, player, orders);
  const first = result.rejected[0];
  if (first) return { ok: false, ...first };
  return { ok: true, cost: result.cost };
}

export interface FilteredOrders {
  accepted: { index: number; order: Order }[];
  rejected: { index: number; reason: RejectReason; message: string }[];
  cost: number;
}

/** Keeps every order that is valid given the ones accepted before it (SPEC §5.3 phase 2). */
export function filterOrderSet(
  state: GameState,
  player: PlayerId,
  orders: readonly unknown[],
): FilteredOrders {
  const ctx = emptyContext();
  const out: FilteredOrders = { accepted: [], rejected: [], cost: 0 };
  orders.forEach((order, index) => {
    const r = checkOne(state, player, order, ctx);
    if (r.ok) {
      commit(state, player, order as Order, r.cost, ctx);
      out.accepted.push({ index, order: order as Order });
    } else {
      out.rejected.push({ index, reason: r.reason, message: r.message });
    }
  });
  out.cost = ctx.cost;
  return out;
}
