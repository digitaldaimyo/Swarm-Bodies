import { connectivityOf, refreshConnectivity } from "./connectivity";
import { getBoard, type Hex } from "./hex";
import { idiv } from "./math";
import { cellIndexOf, maxBiomassFor, playableCellCount, playerTotals } from "./rules";
import type {
  Body,
  CellRef,
  Colony,
  GameEvent,
  GameResult,
  GameState,
  Order,
  OrderSet,
  PlayerId,
  ResolveResult,
} from "./types";
import { filterOrderSet, newCellPositions } from "./validate";

/**
 * resolveTurn (SPEC §5.3). Never mutates `state`. Players are always iterated in ascending id,
 * so the key order of `ordersByPlayer` cannot change the result.
 */
export function resolveTurn(
  state: GameState,
  ordersByPlayer: Readonly<Record<PlayerId, OrderSet>>,
): ResolveResult {
  if (state.result) return { state, events: [] };
  const events: GameEvent[] = [];
  const next = cloneState(state);
  const pids = state.players.map((p) => p.id).sort((a, b) => a - b);
  const player = (id: PlayerId) =>
    next.players.find((p) => p.id === id) as GameState["players"][number];
  const bodyOf = (id: number) => next.bodies.find((b) => b.id === id) as Body;
  const ref = (body: Body, i: number): CellRef => {
    const h = getBoard(body.radius).cells[i] as Hex;
    return { body: body.id, q: h.q, r: h.r };
  };

  // Phase 1: draft picks — none until M6.

  // Phase 2: pay and validate against the start-of-turn state.
  const accepted = new Map<PlayerId, { index: number; order: Order }[]>();
  for (const pid of pids) {
    const ps = player(pid);
    if (ps.eliminated) continue;
    const raw: unknown = Object.prototype.hasOwnProperty.call(ordersByPlayer, pid)
      ? ordersByPlayer[pid]
      : [];
    const list: unknown[] = Array.isArray(raw) ? raw : [];
    const filtered = filterOrderSet(state, pid, list);
    for (const r of filtered.rejected)
      events.push({ type: "OrderRejected", player: pid, index: r.index, reason: r.reason });
    if (filtered.accepted.length > 0) {
      ps.nutrients -= filtered.cost;
      events.push({
        type: "OrdersPaid",
        player: pid,
        cost: filtered.cost,
        nutrients: ps.nutrients,
      });
    }
    accepted.set(pid, filtered.accepted);
  }

  // Phase 3: retract.
  for (const pid of pids) {
    for (const { order } of accepted.get(pid) ?? []) {
      if (order.type !== "retract") continue;
      const body = bodyOf(order.body);
      const i = cellIndexOf(body, order.cell);
      body.colony[i] = null;
      const ps = player(pid);
      ps.nutrients += next.rules.retractRefund;
      events.push({
        type: "Retracted",
        player: pid,
        cell: ref(body, i),
        refund: next.rules.retractRefund,
      });
    }
  }

  // Phase 4: reinforce.
  for (const pid of pids) {
    for (const { order } of accepted.get(pid) ?? []) {
      if (order.type !== "reinforce") continue;
      const body = bodyOf(order.body);
      const i = cellIndexOf(body, order.cell);
      const c = body.colony[i] as Colony;
      const biomass = Math.min(maxBiomassFor(next, c), c.biomass + next.rules.reinforceAmount);
      body.colony[i] = { ...c, biomass };
      events.push({ type: "Reinforced", player: pid, cell: ref(body, i), biomass });
    }
  }

  // Phase 5: growth in lockstep steps.
  resolveGrowth(state, next, pids, accepted, events, ref);

  // Phases 6–7: launches and spore arrivals — M5.

  // Phase 8: connectivity.
  for (const body of next.bodies) refreshConnectivity(body);

  // Phase 9: starvation.
  for (const body of next.bodies) {
    for (let i = 0; i < body.colony.length; i++) {
      const c = body.colony[i];
      if (!c || c.connected || c.core) continue;
      const biomass = c.biomass - next.rules.starvationLoss;
      body.colony[i] = biomass > 0 ? { ...c, biomass } : null;
      events.push({
        type: "Starved",
        player: c.owner,
        cell: ref(body, i),
        biomass: biomass > 0 ? biomass : 0,
      });
    }
  }

  // Phase 10: income.
  const income = new Map<PlayerId, number>();
  for (const body of next.bodies) {
    for (let i = 0; i < body.colony.length; i++) {
      const c = body.colony[i];
      if (!c || !c.connected) continue;
      let gain = c.core ? next.rules.incomePerCore : 0;
      const d = body.deposits[i];
      if (d) gain += next.rules.depositYield[d];
      income.set(c.owner, (income.get(c.owner) ?? 0) + gain);
    }
  }
  for (const pid of pids) {
    const ps = player(pid);
    if (ps.eliminated) continue;
    const amount = income.get(pid) ?? 0;
    ps.nutrients += amount;
    events.push({ type: "Income", player: pid, amount, nutrients: ps.nutrients });
  }

  // Phases 11–14: fruiting, events, body rules, drafts — M5/M6.

  // Phase 15: elimination and victory.
  checkEndOfTurn(next, pids, events);

  // Phase 16: advance the turn (orbits arrive in M5).
  next.turn = state.turn + 1;
  return { state: next, events };
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    // Terrain and deposits never change during a turn in M1, so they are shared.
    bodies: state.bodies.map((b) => ({ ...b, colony: b.colony.slice() })),
    players: state.players.map((p) => ({ ...p })),
  };
}

interface ActivePath {
  player: PlayerId;
  order: number;
  body: Body;
  /** Board indices of the path, start first. */
  cells: number[];
  /** Positions in `cells` of the new cells, in step order. */
  fresh: number[];
  halted: boolean;
}

interface Claim {
  path: ActivePath;
  attack: number;
}

function resolveGrowth(
  start: GameState,
  next: GameState,
  pids: readonly PlayerId[],
  accepted: Map<PlayerId, { index: number; order: Order }[]>,
  events: GameEvent[],
  ref: (body: Body, i: number) => CellRef,
): void {
  const paths: ActivePath[] = [];
  for (const pid of pids) {
    for (const { index, order } of accepted.get(pid) ?? []) {
      if (order.type !== "grow") continue;
      const startBody = start.bodies.find((b) => b.id === order.body) as Body;
      const body = next.bodies.find((b) => b.id === order.body) as Body;
      paths.push({
        player: pid,
        order: index,
        body,
        cells: order.path.map((h) => cellIndexOf(body, h)),
        fresh: newCellPositions(startBody, pid, order.path),
        halted: false,
      });
    }
  }
  const maxSteps = paths.reduce((m, p) => Math.max(m, p.fresh.length), 0);
  const { rules } = next;

  for (let step = 1; step <= maxSteps; step++) {
    const live = paths.filter((p) => !p.halted && p.fresh.length >= step);
    if (live.length === 0) break;
    events.push({ type: "GrowthStep", step });

    // Pressure uses the board as it stands at the start of the step (SPEC §5.4).
    const snapshot = new Map<number, (Colony | null)[]>();
    const connected = new Map<number, boolean[]>();
    for (const body of next.bodies) {
      snapshot.set(body.id, body.colony.slice());
      connected.set(body.id, connectivityOf(body.radius, body.colony));
    }

    const halt = (
      p: ActivePath,
      cell: number,
      reason: "lost" | "stalemate" | "repelled" | "brokenPath",
    ) => {
      p.halted = true;
      events.push({
        type: "PathHalted",
        player: p.player,
        step,
        order: p.order,
        cell: ref(p.body, cell),
        reason,
      });
    };

    const claims = new Map<string, { body: Body; cell: number; claims: Claim[] }>();
    for (const p of live) {
      const pos = p.fresh[step - 1] as number;
      const prev = step === 1 ? 0 : (p.fresh[step - 2] as number);
      const target = p.cells[pos] as number;
      const board = snapshot.get(p.body.id) as (Colony | null)[];
      // Every cell from the previous new cell (or the start) up to the feeder must still be ours.
      let intact = true;
      for (let j = prev; j < pos; j++) {
        if (board[p.cells[j] as number]?.owner !== p.player) intact = false;
      }
      if (!intact) {
        halt(p, target, "brokenPath");
        continue;
      }
      const feederIdx = p.cells[pos - 1] as number;
      const feeder = board[feederIdx] as Colony;
      let attack = feeder.biomass;
      for (const n of getBoard(p.body.radius).neighbours[target] as readonly number[]) {
        if (n !== feederIdx && board[n]?.owner === p.player) attack++;
      }
      const k = `${String(p.body.id).padStart(4, "0")}:${String(target).padStart(5, "0")}`;
      let entry = claims.get(k);
      if (!entry) {
        entry = { body: p.body, cell: target, claims: [] };
        claims.set(k, entry);
      }
      entry.claims.push({ path: p, attack });
    }

    for (const k of [...claims.keys()].sort()) {
      const {
        body,
        cell,
        claims: list,
      } = claims.get(k) as { body: Body; cell: number; claims: Claim[] };
      const board = snapshot.get(body.id) as (Colony | null)[];
      const flags = connected.get(body.id) as boolean[];
      list.sort(
        (a, b) =>
          b.attack - a.attack || a.path.player - b.path.player || a.path.order - b.path.order,
      );
      const top = (list[0] as Claim).attack;
      const tops = list.filter((c) => c.attack === top);
      const losers = list.filter((c) => c.attack !== top);
      const defender = board[cell] ?? null;

      if (tops.length > 1) {
        events.push({
          type: "CellStalemate",
          players: tops.map((c) => c.path.player),
          step,
          cell: ref(body, cell),
          attack: top,
        });
        for (const c of list) halt(c.path, cell, c.attack === top ? "stalemate" : "lost");
        continue;
      }
      const winner = list[0] as Claim;
      for (const c of losers) halt(c.path, cell, "lost");

      if (!defender) {
        const biomass = rules.newCellBiomass;
        body.colony[cell] = { owner: winner.path.player, biomass, core: false, connected: false };
        events.push({
          type: "CellClaimed",
          player: winner.path.player,
          step,
          order: winner.path.order,
          cell: ref(body, cell),
          biomass,
          attack: winner.attack,
        });
        continue;
      }
      if (defender.owner === winner.path.player) continue; // Cannot happen after validation.

      let defense = defender.biomass;
      for (const n of getBoard(body.radius).neighbours[cell] as readonly number[]) {
        if (board[n]?.owner === defender.owner && flags[n]) defense += rules.defenseSupport;
      }
      if (winner.attack > defense) {
        const biomass = Math.min(rules.maxBiomass, Math.max(1, winner.attack - defense));
        body.colony[cell] = { owner: winner.path.player, biomass, core: false, connected: false };
        events.push({
          type: "CellCaptured",
          player: winner.path.player,
          from: defender.owner,
          step,
          order: winner.path.order,
          cell: ref(body, cell),
          attack: winner.attack,
          defense,
          biomass,
        });
        if (defender.core) {
          events.push({
            type: "CoreDestroyed",
            player: defender.owner,
            by: winner.path.player,
            cell: ref(body, cell),
          });
        }
      } else {
        const defenderBiomass = Math.max(1, defender.biomass - idiv(winner.attack, 2));
        body.colony[cell] = { ...defender, biomass: defenderBiomass };
        events.push({
          type: "AssaultRepelled",
          player: winner.path.player,
          defender: defender.owner,
          step,
          order: winner.path.order,
          cell: ref(body, cell),
          attack: winner.attack,
          defense,
          defenderBiomass,
        });
        halt(winner.path, cell, "repelled");
      }
    }
  }
}

function checkEndOfTurn(next: GameState, pids: readonly PlayerId[], events: GameEvent[]): void {
  const totals = playerTotals(next);
  for (const pid of pids) {
    const ps = next.players.find((p) => p.id === pid) as GameState["players"][number];
    if (ps.eliminated) continue;
    // No cores and (from M5) no spores in flight.
    if ((totals.get(pid)?.cores ?? 0) === 0) {
      ps.eliminated = true;
      ps.eliminatedOnTurn = next.turn;
      ps.dominanceStreak = 0;
      events.push({ type: "PlayerEliminated", player: pid });
    }
  }

  const alive = next.players.filter((p) => !p.eliminated).sort((a, b) => a.id - b.id);
  const total = playableCellCount(next);
  const { rules } = next;
  for (const p of alive) {
    const cells = totals.get(p.id)?.cells ?? 0;
    p.dominanceStreak =
      cells * 1000 >= rules.dominanceWinPermille * total ? p.dominanceStreak + 1 : 0;
  }

  let result: GameResult | null = null;
  if (alive.length === 1) {
    result = {
      winner: (alive[0] as (typeof alive)[number]).id,
      reason: "lastStanding",
      turn: next.turn,
    };
  } else if (alive.length === 0) {
    result = { winner: null, reason: "draw", turn: next.turn };
  } else {
    const dominant = alive.filter((p) => p.dominanceStreak >= rules.dominanceWinConsecutiveTurns);
    if (dominant.length > 0) {
      dominant.sort(
        (a, b) => (totals.get(b.id)?.cells ?? 0) - (totals.get(a.id)?.cells ?? 0) || a.id - b.id,
      );
      result = {
        winner: (dominant[0] as (typeof dominant)[number]).id,
        reason: "dominance",
        turn: next.turn,
      };
    } else if (next.turn >= rules.turnLimit) {
      // Highest dominance, then total biomass, then nutrients banked; otherwise a draw (SPEC §3).
      const score = (id: PlayerId): [number, number, number] => {
        const t = totals.get(id);
        const ps = next.players.find((p) => p.id === id);
        return [t?.cells ?? 0, t?.biomass ?? 0, ps?.nutrients ?? 0];
      };
      const ranked = alive
        .map((p) => ({ id: p.id, s: score(p.id) }))
        .sort((a, b) => b.s[0] - a.s[0] || b.s[1] - a.s[1] || b.s[2] - a.s[2] || a.id - b.id);
      const [first, second] = ranked as [(typeof ranked)[number], (typeof ranked)[number]];
      const tied = first.s.every((v, i) => v === second.s[i]);
      result = tied
        ? { winner: null, reason: "draw", turn: next.turn }
        : { winner: first.id, reason: "turnLimit", turn: next.turn };
    }
  }
  if (result) {
    next.result = result;
    events.push({ type: "GameOver", result });
  }
}
