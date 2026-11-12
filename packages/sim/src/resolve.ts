import { connectivityOf, refreshConnectivity } from "./connectivity";
import { getBoard, type Hex } from "./hex";
import { idiv } from "./math";
import { bodyPosition, travelTime } from "./orbit";
import { rngStream } from "./rng";
import { cellIndexOf, maxBiomassFor, playableCellCount, playerRules, playerTotals } from "./rules";
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
  Spore,
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
      const biomass = Math.min(
        maxBiomassFor(next, c, body),
        c.biomass + playerRules(next, pid).reinforceAmount,
      );
      body.colony[i] = { ...c, biomass };
      events.push({ type: "Reinforced", player: pid, cell: ref(body, i), biomass });
    }
  }

  // Phase 4 (cont.): Fruit orders start growing launchers, before growth (DECISIONS).
  for (const pid of pids) {
    for (const { order } of accepted.get(pid) ?? []) {
      if (order.type !== "fruit") continue;
      const body = bodyOf(order.body);
      const i = cellIndexOf(body, order.cell);
      const c = body.colony[i] as Colony;
      body.colony[i] = { ...c, fruiting: next.rules.fruitMatureTurns };
      events.push({ type: "FruitStarted", player: pid, cell: ref(body, i) });
    }
  }

  // Phase 5: growth in lockstep steps.
  resolveGrowth(state, next, pids, accepted, events, ref);

  // Phase 6: launches.
  for (const pid of pids) {
    for (const { order } of accepted.get(pid) ?? []) {
      if (order.type !== "launch") continue;
      const body = bodyOf(order.body);
      const i = cellIndexOf(body, order.cell);
      const c = body.colony[i];
      // The fruiting body may have been captured during growth: then the launch fizzles.
      if (!c || c.owner !== pid || c.fruiting !== 0) {
        events.push({ type: "LaunchFizzled", player: pid, from: ref(body, i) });
        continue;
      }
      const target = bodyOf(order.targetBody);
      const spore: Spore = {
        id: next.nextSporeId++,
        owner: pid,
        sourceBody: body.id,
        targetBody: target.id,
        targetCell: { q: order.targetCell.q, r: order.targetCell.r },
        landing: next.rules.landingBiomass,
        launchedTurn: state.turn,
        arrivalTurn: state.turn + travelTime(next, body, target, state.turn),
      };
      next.spores.push(spore);
      body.colony[i] = { ...c, biomass: 1, fruiting: null };
      events.push({
        type: "SporeLaunched",
        player: pid,
        spore: spore.id,
        from: ref(body, i),
        targetBody: target.id,
        arrivalTurn: spore.arrivalTurn,
      });
    }
  }

  // Phase 7: spore arrivals.
  landSpores(next, state.turn, events, ref);

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
      for (const comet of body.comets) if (comet.cell === i) gain += comet.yield;
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

  // Phase 11: fruiting progress.
  for (const body of next.bodies) {
    body.colony.forEach((c, i) => {
      if (!c || c.fruiting === null || c.fruiting === 0) return;
      body.colony[i] = { ...c, fruiting: c.fruiting - 1 };
      if (c.fruiting - 1 === 0)
        events.push({ type: "FruitMatured", player: c.owner, cell: ref(body, i) });
    });
  }

  // Phase 12: events (flares and comets).
  resolveEvents(next, state.turn, events, ref);

  // Phase 13: body rules. Irradiated bodies burn away biomass-1 cells (cores are spared).
  for (const body of next.bodies) {
    if (body.type !== "irradiated") continue;
    body.colony.forEach((c, i) => {
      if (!c || c.core || c.biomass !== 1) return;
      body.colony[i] = null;
      events.push({ type: "Irradiated", player: c.owner, cell: ref(body, i) });
    });
  }
  // Flares and irradiation can cut supply lines: refresh so the next turn starts consistent.
  for (const body of next.bodies) refreshConnectivity(body);

  // Phase 14: biomass thresholds and draft offers arrive in M6.

  // Phase 15: elimination and victory.
  checkEndOfTurn(next, pids, events);

  // Phase 16: advance the turn; orbits move with it (positions derive from the turn).
  next.turn = state.turn + 1;
  return { state: next, events };
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    // Terrain and deposits never change during a turn, so they are shared.
    bodies: state.bodies.map((b) => ({ ...b, colony: b.colony.slice(), comets: b.comets.slice() })),
    players: state.players.map((p) => ({ ...p })),
    spores: state.spores.slice(),
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
        body.colony[cell] = {
          owner: winner.path.player,
          biomass,
          core: false,
          connected: false,
          fruiting: null,
        };
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
        if (board[n]?.owner === defender.owner && flags[n])
          defense += playerRules(next, defender.owner).defenseSupport;
      }
      if (winner.attack > defense) {
        const cap = maxBiomassFor(next, { owner: winner.path.player, core: false }, body);
        const biomass = Math.min(cap, Math.max(1, winner.attack - defense));
        body.colony[cell] = {
          owner: winner.path.player,
          biomass,
          core: false,
          connected: false,
          fruiting: null,
        };
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
    // No cores and no spores in flight (SPEC §3).
    if ((totals.get(pid)?.cores ?? 0) === 0 && !next.spores.some((sp) => sp.owner === pid)) {
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

/**
 * Phase 7 (SPEC §6): spores whose travel time ends this turn land. Spores aimed at the same cell
 * contest their landing biomass first: the strongest lands, the rest die, and a tie kills all.
 */
function landSpores(
  next: GameState,
  turn: number,
  events: GameEvent[],
  ref: (body: Body, i: number) => CellRef,
): void {
  const arriving = next.spores.filter((s) => s.arrivalTurn <= turn);
  if (arriving.length === 0) return;
  next.spores = next.spores.filter((s) => s.arrivalTurn > turn);
  const flags = new Map<number, boolean[]>();
  for (const body of next.bodies) flags.set(body.id, connectivityOf(body.radius, body.colony));

  const groups = new Map<string, Spore[]>();
  for (const s of arriving) {
    const body = next.bodies.find((b) => b.id === s.targetBody) as Body;
    const i = cellIndexOf(body, s.targetCell);
    const k = `${String(body.id).padStart(4, "0")}:${String(i).padStart(5, "0")}`;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  for (const k of [...groups.keys()].sort()) {
    const group = (groups.get(k) as Spore[]).sort(
      (a, b) => b.landing - a.landing || a.owner - b.owner || a.id - b.id,
    );
    const body = next.bodies.find((b) => b.id === (group[0] as Spore).targetBody) as Body;
    const i = cellIndexOf(body, (group[0] as Spore).targetCell);
    const cell = ref(body, i);
    const tie = group.length > 1 && (group[0] as Spore).landing === (group[1] as Spore).landing;
    const losers = tie ? group : group.slice(1);
    for (const s of losers) {
      events.push({
        type: "SporeLanded",
        player: s.owner,
        spore: s.id,
        cell,
        outcome: "collided",
        biomass: 0,
        from: null,
      });
    }
    if (tie) continue;
    const s = group[0] as Spore;
    const c = body.colony[i];
    const coreMax = maxBiomassFor(next, { owner: s.owner, core: true }, body);
    if (!c) {
      const biomass = Math.min(coreMax, s.landing);
      body.colony[i] = { owner: s.owner, biomass, core: true, connected: true, fruiting: null };
      events.push({
        type: "SporeLanded",
        player: s.owner,
        spore: s.id,
        cell,
        outcome: "newCore",
        biomass,
        from: null,
      });
    } else if (c.owner === s.owner) {
      const biomass = Math.min(coreMax, Math.max(c.biomass, s.landing));
      body.colony[i] = { ...c, biomass, core: true, fruiting: null };
      events.push({
        type: "SporeLanded",
        player: s.owner,
        spore: s.id,
        cell,
        outcome: "merged",
        biomass,
        from: null,
      });
    } else {
      // A landing contests the cell like an assault: landing biomass against the defense.
      const board = getBoard(body.radius);
      const connected = flags.get(body.id) as boolean[];
      let defense = c.biomass;
      for (const n of board.neighbours[i] as readonly number[]) {
        if (body.colony[n]?.owner === c.owner && connected[n])
          defense += playerRules(next, c.owner).defenseSupport;
      }
      if (s.landing > defense) {
        const biomass = Math.min(coreMax, Math.max(1, s.landing - defense));
        body.colony[i] = { owner: s.owner, biomass, core: true, connected: true, fruiting: null };
        events.push({
          type: "SporeLanded",
          player: s.owner,
          spore: s.id,
          cell,
          outcome: "captured",
          biomass,
          from: c.owner,
        });
        if (c.core) events.push({ type: "CoreDestroyed", player: c.owner, by: s.owner, cell });
      } else {
        const biomass = Math.max(1, c.biomass - 1);
        body.colony[i] = { ...c, biomass };
        events.push({
          type: "SporeLanded",
          player: s.owner,
          spore: s.id,
          cell,
          outcome: "repelled",
          biomass,
          from: c.owner,
        });
      }
    }
  }
}

/** √3 × 10000, for the integer flare test below. */
const SQRT3_FX = 17321;

/**
 * Phase 12 (SPEC §8): comets fade and arrive, flares strike, and warnings go out for what is
 * coming next turn (flares) or in two turns (comets).
 */
function resolveEvents(
  next: GameState,
  turn: number,
  events: GameEvent[],
  ref: (body: Body, i: number) => CellRef,
): void {
  const { rules } = next;
  for (const body of next.bodies) {
    const fading = body.comets.filter((c) => c.until <= turn);
    if (fading.length === 0) continue;
    body.comets = body.comets.filter((c) => c.until > turn);
    for (const c of fading) events.push({ type: "CometFaded", cell: ref(body, c.cell) });
  }

  for (const e of next.schedule) {
    if (e.turn !== turn) continue;
    if (e.kind === "flare") {
      events.push({ type: "Flare" });
      for (const body of next.bodies) {
        if (!body.orbit) continue;
        // Direction to the star is minus the body's position. A cell is hit when its offset from
        // the body's centre is within 90° of that direction: dot product ≥ 0. Pixel offsets of a
        // pointy-top hex are (√3/2·(2q + r), 3/2·r); scaled by 2 and with √3 in fixed point the
        // test stays in integers.
        const pos = bodyPosition(body, turn);
        const board = getBoard(body.radius);
        body.colony.forEach((c, i) => {
          if (!c) return;
          const h = board.cells[i] as Hex;
          const dot = SQRT3_FX * (2 * h.q + h.r) * -pos.x + 30000 * h.r * -pos.y;
          if (dot < 0) return;
          const left = c.biomass - rules.flareLoss;
          const biomass = c.core ? Math.max(1, left) : left;
          body.colony[i] = biomass > 0 ? { ...c, biomass } : null;
          events.push({
            type: "FlareStruck",
            player: c.owner,
            cell: ref(body, i),
            biomass: Math.max(0, biomass),
          });
        });
      }
    } else {
      const body = next.bodies.find((b) => b.id === e.body);
      if (!body) continue;
      // A random empty regolith cell without a deposit, chosen when the comet arrives.
      const open: number[] = [];
      body.colony.forEach((c, i) => {
        if (
          !c &&
          body.terrain[i] === "regolith" &&
          !body.deposits[i] &&
          !body.comets.some((m) => m.cell === i)
        )
          open.push(i);
      });
      if (open.length === 0) continue;
      const cell = rngStream(next.seed, `comet:${turn}:${body.id}`).pick(open);
      const until = turn + rules.cometDuration;
      body.comets = [...body.comets, { cell, yield: rules.cometYield, until }];
      events.push({ type: "CometArrived", cell: ref(body, cell), until, yield: rules.cometYield });
    }
  }

  for (const e of next.schedule) {
    if (e.kind === "flare" && e.turn === turn + 1)
      events.push({ type: "FlareWarning", impactTurn: e.turn });
    if (e.kind === "comet" && e.turn === turn + rules.cometWarning) {
      events.push({ type: "CometWarning", arrivalTurn: e.turn, body: e.body });
    }
  }
}
