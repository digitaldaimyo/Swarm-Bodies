import {
  attackOn,
  defenseOf,
  getBoard,
  incomeFor,
  maxBiomassFor,
  playerRules,
  validateOrder,
  type GameState,
  type Hex,
  type MutationId,
  type Order,
  type PlayerId,
  type ValidationResult,
} from "@swarm/sim";

/**
 * The planning phase (SPEC §5.1, §10.2): an order set validated live by the shared sim, with
 * the planned cost summed as orders are added.
 */
export class Planner {
  orders: Order[] = [];

  constructor(
    readonly state: GameState,
    readonly player: PlayerId,
  ) {}

  get banked(): number {
    return this.state.players.find((p) => p.id === this.player)?.nutrients ?? 0;
  }

  /** Validates without adding. */
  check(order: Order): ValidationResult {
    return validateOrder(this.state, this.player, order, this.orders);
  }

  add(order: Order): ValidationResult {
    const r = this.check(order);
    if (r.ok) this.orders = [...this.orders, order];
    return r;
  }

  remove(index: number): void {
    this.orders = this.orders.filter((_, i) => i !== index);
    this.revalidate();
  }

  /** The pending draft pick, if one is queued (it is always the first order). */
  get draftPick(): MutationId | null {
    const first = this.orders[0];
    return first?.type === "draft" ? first.mutation : null;
  }

  /**
   * Picks a mutation from the pending draft (SPEC §7.2): the pick goes first in the set, so every
   * other order is judged with it in effect; orders it makes invalid are dropped.
   */
  pickDraft(mutation: MutationId): ValidationResult {
    const order: Order = { type: "draft", mutation };
    const r = validateOrder(this.state, this.player, order, []);
    if (!r.ok) return r;
    this.orders = [order, ...this.orders.filter((o) => o.type !== "draft")];
    this.revalidate();
    return r;
  }

  undo(): void {
    this.orders = this.orders.slice(0, -1);
  }

  clear(): void {
    this.orders = [];
  }

  /** Removing an order can make later ones invalid only in edge cases; drop any that are. */
  private revalidate(): void {
    const kept: Order[] = [];
    for (const o of this.orders)
      if (validateOrder(this.state, this.player, o, kept).ok) kept.push(o);
    this.orders = kept;
  }

  get plannedCost(): number {
    let total = 0;
    const pending: Order[] = [];
    for (const o of this.orders) {
      const r = validateOrder(this.state, this.player, o, pending);
      if (r.ok) total += r.cost;
      pending.push(o);
    }
    return total;
  }

  /** Income if the board stayed as it is: 2 N per core plus connected deposit and comet yields. */
  get projectedIncome(): number {
    return incomeOf(this.state, this.player);
  }

  /** Which order (if any) already uses this cell, for the radial menu and highlights. */
  ordersAt(body: number, h: Hex): number[] {
    const out: number[] = [];
    this.orders.forEach((o, i) => {
      if (o.type === "draft" || o.body !== body) return;
      const cells = o.type === "grow" ? o.path : [o.cell];
      if (cells.some((c) => c.q === h.q && c.r === h.r)) out.push(i);
    });
    return out;
  }
}

/** Next turn's income if the board stayed as it is (the sim's own phase-10 rule). */
export function incomeOf(state: GameState, player: PlayerId): number {
  return incomeFor(state, player);
}

export interface StepPreview {
  cell: Hex;
  kind: "empty" | "assault";
  attack: number;
  defense: number;
  /** "capture" for empty cells too (claim). */
  outcome: "capture" | "fail";
  /** Other players' orders could change the outcome (SPEC §10.2). */
  uncertain: boolean;
}

/**
 * Previews a painted path against the start-of-turn board, the way the sim will resolve it if
 * nobody else interferes. Stops at the first step that would fail.
 */
export function previewPath(
  state: GameState,
  player: PlayerId,
  body: number,
  path: readonly Hex[],
): StepPreview[] {
  const b = state.bodies.find((x) => x.id === body);
  if (!b || path.length < 2) return [];
  const board = getBoard(b.radius);
  const at = (h: Hex) => board.indexOf(h.q, h.r);
  const startIdx = at(path[0] as Hex);
  if (!b.colony[startIdx]) return [];
  // A virtual board: cells this path has already taken count as ours for the next step, the way
  // they will on the sim's board at the start of that step. Pressure itself is the sim's.
  const virtual = b.colony.slice();
  const flags = b.colony.map((c) => !!c?.connected);
  const pr = playerRules(state, player);
  let feederIdx = startIdx;
  const out: StepPreview[] = [];
  for (const h of path.slice(1)) {
    const t = at(h);
    if (t < 0) break;
    const here = virtual[t];
    if (here && here.owner === player) {
      feederIdx = t;
      continue;
    }
    const attack = attackOn(state, b, virtual, player, feederIdx, t);
    let enemyNear = false;
    for (const n of board.neighbours[t] as readonly number[]) {
      const c = b.colony[n];
      if (c && c.owner !== player) enemyNear = true;
    }
    const defender = b.colony[t];
    if (!defender) {
      out.push({
        cell: h,
        kind: "empty",
        attack,
        defense: 0,
        outcome: "capture",
        uncertain: enemyNear,
      });
      virtual[t] = {
        owner: player,
        biomass: state.rules.newCellBiomass,
        core: false,
        connected: true,
        fruiting: null,
        cut: 0,
      };
    } else {
      const defense = defenseOf(state, b, b.colony, flags, t);
      const win = attack > defense;
      out.push({
        cell: h,
        kind: "assault",
        attack,
        defense,
        outcome: win ? "capture" : "fail",
        uncertain: true,
      });
      if (!win) break;
      virtual[t] = {
        owner: player,
        biomass: Math.min(pr.maxBiomass, attack - defense),
        core: false,
        connected: true,
        fruiting: null,
        cut: 0,
      };
    }
    feederIdx = t;
  }
  return out;
}

export function canReinforceMore(state: GameState, body: number, h: Hex): boolean {
  const b = state.bodies.find((x) => x.id === body);
  if (!b) return false;
  const c = b.colony[getBoard(b.radius).indexOf(h.q, h.r)];
  return !!c && c.biomass < maxBiomassFor(state, c, b);
}
