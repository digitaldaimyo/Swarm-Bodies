import {
  getBoard,
  maxBiomassFor,
  validateOrder,
  type GameState,
  type Hex,
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

  /** Income if the board stayed as it is: 2 N per core plus connected deposit yields. */
  get projectedIncome(): number {
    return incomeOf(this.state, this.player);
  }

  /** Which order (if any) already uses this cell, for the radial menu and highlights. */
  ordersAt(body: number, h: Hex): number[] {
    const out: number[] = [];
    this.orders.forEach((o, i) => {
      if (o.body !== body) return;
      const cells = o.type === "grow" ? o.path : [o.cell];
      if (cells.some((c) => c.q === h.q && c.r === h.r)) out.push(i);
    });
    return out;
  }
}

export function incomeOf(state: GameState, player: PlayerId): number {
  let n = 0;
  for (const body of state.bodies) {
    body.colony.forEach((c, i) => {
      if (!c || c.owner !== player || !c.connected) return;
      if (c.core) n += state.rules.incomePerCore;
      const d = body.deposits[i];
      if (d) n += state.rules.depositYield[d];
    });
  }
  return n;
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
  const own = new Set<number>();
  b.colony.forEach((c, i) => c?.owner === player && own.add(i));
  const start = b.colony[at(path[0] as Hex)];
  if (!start) return [];
  let feederB = start.biomass;
  let feederIdx = at(path[0] as Hex);
  const out: StepPreview[] = [];
  for (const h of path.slice(1)) {
    const t = at(h);
    if (t < 0) break;
    if (own.has(t)) {
      feederB = (b.colony[t] as NonNullable<(typeof b.colony)[number]>).biomass;
      feederIdx = t;
      continue;
    }
    let attack = feederB;
    let enemyNear = false;
    for (const n of board.neighbours[t] as readonly number[]) {
      if (n !== feederIdx && own.has(n)) attack++;
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
      feederB = state.rules.newCellBiomass;
    } else {
      let defense = defender.biomass;
      for (const n of board.neighbours[t] as readonly number[]) {
        const c = b.colony[n];
        if (c && c.owner === defender.owner && c.connected) defense += state.rules.defenseSupport;
      }
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
      feederB = Math.min(state.rules.maxBiomass, attack - defense);
    }
    own.add(t);
    feederIdx = t;
  }
  return out;
}

export function canReinforceMore(state: GameState, body: number, h: Hex): boolean {
  const b = state.bodies.find((x) => x.id === body);
  if (!b) return false;
  const c = b.colony[getBoard(b.radius).indexOf(h.q, h.r)];
  return !!c && c.biomass < maxBiomassFor(state, c);
}
