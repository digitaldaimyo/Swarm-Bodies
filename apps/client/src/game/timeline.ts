import {
  connectivityOf,
  getBoard,
  newCellPositions,
  type CellRef,
  type Colony,
  type GameEvent,
  type GameState,
  type Hex,
  type Order,
  type PlayerId,
} from "@swarm/sim";
import { mutationInfo } from "@swarm/content";

/**
 * Turn replay (SPEC §10.5). The sim's ordered events are folded into a short sequence of
 * frames, one per resolution phase and one per growth step. Each frame holds the board after
 * that phase plus the effects to animate on the way there. The last frame is always the real
 * resolved state, so the replay can never drift from the sim.
 */

export type FramePhase = "prep" | "growth" | "launch" | "starve" | "income" | "events" | "final";

export type Effect =
  | { kind: "pulse"; body: number; cell: Hex; player: PlayerId }
  | { kind: "retract"; body: number; cell: Hex; player: PlayerId }
  | {
      kind: "tendril";
      body: number;
      from: Hex;
      to: Hex;
      player: PlayerId;
      outcome: "claim" | "capture" | "repelled" | "stalemate" | "lost" | "broken";
    }
  | { kind: "splash"; body: number; cell: Hex }
  | { kind: "flip"; body: number; cell: Hex; from: PlayerId; to: PlayerId }
  | { kind: "coreLost"; body: number; cell: Hex; player: PlayerId }
  | { kind: "fade"; body: number; cell: Hex; player: PlayerId; removed: boolean }
  | { kind: "income"; body: number; cell: Hex; player: PlayerId; amount: number }
  | { kind: "fruit"; body: number; cell: Hex; player: PlayerId }
  | { kind: "launch"; body: number; cell: Hex; player: PlayerId; fizzled: boolean }
  | {
      kind: "land";
      body: number;
      cell: Hex;
      player: PlayerId;
      outcome: "newCore" | "captured" | "repelled" | "merged" | "collided";
    }
  | { kind: "flare"; body: number; cell: Hex }
  | { kind: "comet"; body: number; cell: Hex; arrived: boolean }
  /** A full-screen flash on every body (a solar flare). */
  | { kind: "flash"; body: -1 };

export interface Frame {
  phase: FramePhase;
  step: number;
  /** Colony per body after this frame, with connectivity recomputed for rendering. */
  colony: Map<number, (Colony | null)[]>;
  effects: Effect[];
  /** Duration at 1× speed, in ms. */
  duration: number;
}

export const FRAME_MS: Record<FramePhase, number> = {
  prep: 450,
  growth: 650,
  launch: 700,
  starve: 450,
  income: 600,
  events: 700,
  final: 250,
};

export interface LogEntry {
  text: string;
  body: number;
  cell: Hex | null;
  important: boolean;
}

export function buildTimeline(
  before: GameState,
  after: GameState,
  events: readonly GameEvent[],
  ordersByPlayer: Readonly<Record<PlayerId, readonly Order[]>>,
): Frame[] {
  const boards = new Map<number, (Colony | null)[]>();
  for (const b of before.bodies) boards.set(b.id, b.colony.slice());
  const bodyOf = (id: number) => before.bodies.find((b) => b.id === id);
  const idx = (ref: CellRef): number => {
    const b = bodyOf(ref.body);
    return b ? getBoard(b.radius).indexOf(ref.q, ref.r) : -1;
  };
  const hex = (ref: CellRef): Hex => ({ q: ref.q, r: ref.r });

  /** Feeder of the k-th new cell of a player's order, from the start-of-turn board. */
  const feeder = (player: PlayerId, order: number, step: number): Hex | null => {
    const o = ordersByPlayer[player]?.[order];
    if (!o || o.type !== "grow") return null;
    const b = bodyOf(o.body);
    if (!b) return null;
    const pos = newCellPositions(b, player, o.path)[step - 1];
    return pos === undefined ? null : (o.path[pos - 1] ?? null);
  };

  const frames: Frame[] = [];
  let current: Frame | null = null;
  const open = (phase: FramePhase, step = 0): Frame => {
    if (current && current.phase === phase && current.step === step) return current;
    if (current) seal(current);
    current = { phase, step, colony: new Map(), effects: [], duration: FRAME_MS[phase] };
    return current;
  };
  const seal = (f: Frame) => {
    for (const b of before.bodies) {
      const colony = (boards.get(b.id) as (Colony | null)[]).slice();
      const flags = connectivityOf(b.radius, colony);
      f.colony.set(
        b.id,
        colony.map((c, i) => (c ? { ...c, connected: flags[i] as boolean } : null)),
      );
    }
    frames.push(f);
  };
  const set = (ref: CellRef, c: Colony | null) => {
    const board = boards.get(ref.body);
    const i = idx(ref);
    if (board && i >= 0) board[i] = c;
  };
  const get = (ref: CellRef): Colony | null => boards.get(ref.body)?.[idx(ref)] ?? null;
  const coreCell = (player: PlayerId): { body: number; cell: Hex } | null => {
    for (const b of after.bodies) {
      const board = getBoard(b.radius);
      const i = b.colony.findIndex((c) => c?.owner === player && c.core);
      if (i >= 0) return { body: b.id, cell: board.cells[i] as Hex };
    }
    return null;
  };

  const phaseNow = (): FramePhase | null => (current as Frame | null)?.phase ?? null;
  let step = 0;
  for (const e of events) {
    switch (e.type) {
      case "Retracted": {
        open("prep").effects.push({
          kind: "retract",
          body: e.cell.body,
          cell: hex(e.cell),
          player: e.player,
        });
        set(e.cell, null);
        break;
      }
      case "Reinforced": {
        open("prep").effects.push({
          kind: "pulse",
          body: e.cell.body,
          cell: hex(e.cell),
          player: e.player,
        });
        const c = get(e.cell);
        if (c) set(e.cell, { ...c, biomass: e.biomass });
        break;
      }
      case "GrowthStep":
        step = e.step;
        open("growth", step);
        break;
      case "CellClaimed": {
        const f = open("growth", step);
        const from = feeder(e.player, e.order, e.step);
        if (from)
          f.effects.push({
            kind: "tendril",
            body: e.cell.body,
            from,
            to: hex(e.cell),
            player: e.player,
            outcome: "claim",
          });
        set(e.cell, {
          owner: e.player,
          biomass: e.biomass,
          core: false,
          connected: true,
          fruiting: null,
          cut: 0,
        });
        break;
      }
      case "CellCaptured": {
        const f = open("growth", step);
        const from = feeder(e.player, e.order, e.step);
        if (from)
          f.effects.push({
            kind: "tendril",
            body: e.cell.body,
            from,
            to: hex(e.cell),
            player: e.player,
            outcome: "capture",
          });
        f.effects.push({
          kind: "flip",
          body: e.cell.body,
          cell: hex(e.cell),
          from: e.from,
          to: e.player,
        });
        set(e.cell, {
          owner: e.player,
          biomass: e.biomass,
          core: false,
          connected: true,
          fruiting: null,
          cut: 0,
        });
        break;
      }
      case "AssaultRepelled": {
        const f = open("growth", step);
        const from = feeder(e.player, e.order, e.step);
        if (from)
          f.effects.push({
            kind: "tendril",
            body: e.cell.body,
            from,
            to: hex(e.cell),
            player: e.player,
            outcome: "repelled",
          });
        f.effects.push({ kind: "splash", body: e.cell.body, cell: hex(e.cell) });
        const c = get(e.cell);
        if (c) set(e.cell, { ...c, biomass: e.defenderBiomass });
        break;
      }
      case "CellStalemate":
        open("growth", step).effects.push({ kind: "splash", body: e.cell.body, cell: hex(e.cell) });
        break;
      case "PathHalted": {
        if (e.reason !== "stalemate" && e.reason !== "lost") break;
        const from = feeder(e.player, e.order, e.step);
        if (from) {
          open("growth", step).effects.push({
            kind: "tendril",
            body: e.cell.body,
            from,
            to: hex(e.cell),
            player: e.player,
            outcome: e.reason,
          });
        }
        break;
      }
      case "CoreDestroyed":
        // Cores fall to growth, or to a spore landing in the launch phase.
        open(phaseNow() === "launch" ? "launch" : "growth", step).effects.push({
          kind: "coreLost",
          body: e.cell.body,
          cell: hex(e.cell),
          player: e.player,
        });
        break;
      case "Starved": {
        open("starve").effects.push({
          kind: "fade",
          body: e.cell.body,
          cell: hex(e.cell),
          player: e.player,
          removed: e.biomass === 0,
        });
        const c = get(e.cell);
        set(e.cell, e.biomass > 0 && c ? { ...c, biomass: e.biomass } : null);
        break;
      }
      case "FruitStarted": {
        open("prep").effects.push({
          kind: "fruit",
          body: e.cell.body,
          cell: hex(e.cell),
          player: e.player,
        });
        const c = get(e.cell);
        if (c) set(e.cell, { ...c, fruiting: before.rules.fruitMatureTurns });
        break;
      }
      case "SporeLaunched":
      case "LaunchFizzled": {
        open("launch").effects.push({
          kind: "launch",
          body: e.from.body,
          cell: hex(e.from),
          player: e.player,
          fizzled: e.type === "LaunchFizzled",
        });
        const c = get(e.from);
        if (c && c.owner === e.player) set(e.from, { ...c, biomass: 1, fruiting: null });
        break;
      }
      case "SporeLanded": {
        open("launch").effects.push({
          kind: "land",
          body: e.cell.body,
          cell: hex(e.cell),
          player: e.player,
          outcome: e.outcome,
        });
        const c = get(e.cell);
        if (e.outcome === "repelled") {
          if (c) set(e.cell, { ...c, biomass: e.biomass });
        } else if (e.outcome !== "collided") {
          set(e.cell, {
            owner: e.player,
            biomass: e.biomass,
            core: true,
            connected: true,
            fruiting: null,
            cut: 0,
          });
        }
        break;
      }
      case "Flare":
        open("events").effects.push({ kind: "flash", body: -1 });
        break;
      case "FlareStruck": {
        open("events").effects.push({ kind: "flare", body: e.cell.body, cell: hex(e.cell) });
        const c = get(e.cell);
        if (c) set(e.cell, e.biomass > 0 ? { ...c, biomass: e.biomass } : null);
        break;
      }
      case "CometArrived":
      case "CometFaded":
        open("events").effects.push({
          kind: "comet",
          body: e.cell.body,
          cell: hex(e.cell),
          arrived: e.type === "CometArrived",
        });
        break;
      case "Regenerated": {
        const c = get(e.cell);
        if (c) set(e.cell, { ...c, biomass: e.biomass });
        break;
      }
      case "Irradiated":
        open("events").effects.push({
          kind: "fade",
          body: e.cell.body,
          cell: hex(e.cell),
          player: e.player,
          removed: true,
        });
        set(e.cell, null);
        break;
      case "Income": {
        if (e.amount <= 0) break;
        const where = coreCell(e.player);
        if (where)
          open("income").effects.push({
            kind: "income",
            ...where,
            player: e.player,
            amount: e.amount,
          });
        break;
      }
      default:
        break;
    }
  }
  if (current) seal(current);

  // The truth: the resolved state, connectivity included.
  const final: Frame = {
    phase: "final",
    step: 0,
    colony: new Map(),
    effects: [],
    duration: FRAME_MS.final,
  };
  for (const b of after.bodies) final.colony.set(b.id, b.colony.slice());
  frames.push(final);
  return frames;
}

/** Total replay length at 1× speed, in ms. */
export function timelineDuration(frames: readonly Frame[]): number {
  return frames.reduce((t, f) => t + f.duration, 0);
}

/** The "what happened" log (SPEC §10.5), from the viewer's point of view. */
export function describeEvents(
  events: readonly GameEvent[],
  viewer: PlayerId,
  names: (p: PlayerId) => string,
): LogEntry[] {
  const who = (p: PlayerId) => (p === viewer ? "You" : names(p));
  const out: LogEntry[] = [];
  const claimed = new Map<PlayerId, number>();
  for (const e of events) {
    const at =
      "cell" in e
        ? { body: e.cell.body, cell: { q: e.cell.q, r: e.cell.r } }
        : { body: 0, cell: null };
    switch (e.type) {
      case "CellClaimed":
        claimed.set(e.player, (claimed.get(e.player) ?? 0) + 1);
        break;
      case "CellCaptured":
        out.push({
          text: `${who(e.player)} captured a cell from ${e.from === viewer ? "you" : names(e.from)} (${e.attack} vs ${e.defense})`,
          ...at,
          important: true,
        });
        break;
      case "AssaultRepelled":
        out.push({
          text: `${who(e.defender)} held off an assault (${e.attack} vs ${e.defense})`,
          ...at,
          important: true,
        });
        break;
      case "CellStalemate":
        out.push({
          text: `Stalemate: equal pressure (${e.attack}), nobody took the cell`,
          ...at,
          important: true,
        });
        break;
      case "CoreDestroyed":
        out.push({ text: `${who(e.player)} lost a core!`, ...at, important: true });
        break;
      case "Starved":
        if (e.biomass === 0)
          out.push({
            text: `A cut-off ${e.player === viewer ? "cell of yours" : "enemy cell"} starved`,
            ...at,
            important: false,
          });
        break;
      case "OrderRejected":
        if (e.player === viewer)
          out.push({
            text: `An order was dropped (${e.reason})`,
            body: 0,
            cell: null,
            important: true,
          });
        break;
      case "PlayerEliminated":
        out.push({
          text: `${who(e.player)} ${e.player === viewer ? "were" : "was"} eliminated`,
          body: 0,
          cell: null,
          important: true,
        });
        break;
      case "Income":
        if (e.player === viewer)
          out.push({ text: `+${e.amount} N income`, body: 0, cell: null, important: false });
        break;
      case "DraftPicked":
        out.push({
          text: `${who(e.player)} drafted ${mutationInfo(e.mutation).name}${e.auto ? " (assigned)" : ""}`,
          body: 0,
          cell: null,
          important: true,
        });
        break;
      case "DraftOffered":
        if (e.player === viewer)
          out.push({ text: "A mutation draft is waiting", body: 0, cell: null, important: true });
        break;
      case "CaptureFed":
        if (e.player === viewer)
          out.push({ text: `+${e.amount} N from a capture`, ...at, important: false });
        break;
      case "FruitMatured":
        if (e.player === viewer)
          out.push({ text: "Your fruiting body is ready to launch", ...at, important: true });
        break;
      case "SporeLaunched":
        out.push({
          text: `${who(e.player)} launched a spore toward body ${e.targetBody + 1} (lands turn ${e.arrivalTurn})`,
          body: e.from.body,
          cell: { q: e.from.q, r: e.from.r },
          important: true,
        });
        break;
      case "LaunchFizzled":
        out.push({
          text: `${e.player === viewer ? "Your" : `${names(e.player)}'s`} launch fizzled`,
          body: e.from.body,
          cell: { q: e.from.q, r: e.from.r },
          important: e.player === viewer,
        });
        break;
      case "SporeLanded": {
        const text =
          e.outcome === "newCore"
            ? `${who(e.player)} seeded a new core on body ${e.cell.body + 1}`
            : e.outcome === "captured"
              ? `${who(e.player)} landed a spore and took a cell on body ${e.cell.body + 1}`
              : e.outcome === "merged"
                ? `${who(e.player)} landed a spore on ${e.player === viewer ? "your" : "their"} own cell`
                : e.outcome === "repelled"
                  ? `A spore from ${e.player === viewer ? "you" : names(e.player)} was repelled`
                  : "Spores collided and died";
        out.push({ text, ...at, important: true });
        break;
      }
      case "FlareWarning":
        out.push({
          text: `Solar flare coming on turn ${e.impactTurn}: sun-facing cells lose biomass`,
          body: 0,
          cell: null,
          important: true,
        });
        break;
      case "Flare":
        out.push({ text: "A solar flare struck", body: 0, cell: null, important: true });
        break;
      case "CometWarning":
        out.push({
          text: `A comet will strike body ${e.body + 1} on turn ${e.arrivalTurn}`,
          body: e.body,
          cell: null,
          important: true,
        });
        break;
      case "CometArrived":
        out.push({
          text: `A comet left a rich deposit (+${e.yield} N) on body ${e.cell.body + 1}`,
          ...at,
          important: true,
        });
        break;
      case "Irradiated":
        if (e.player === viewer)
          out.push({ text: "Radiation burned away a thin cell", ...at, important: false });
        break;
      default:
        break;
    }
  }
  const growth = [...claimed]
    .sort((a, b) => a[0] - b[0])
    .map(([p, n]): LogEntry => ({
      text: `${who(p)} grew into ${n} new cell${n === 1 ? "" : "s"}`,
      body: 0,
      cell: null,
      important: false,
    }));
  return [...growth, ...out];
}

/**
 * Bodies to show while a turn replays (playtest): the one in view first if anything happened on
 * it, then every other body with action, in id order. Never empty: with no action anywhere, the
 * body in view is shown.
 */
export function replayBodies(frames: readonly Frame[], current: number): number[] {
  const active = new Set<number>();
  for (const f of frames) for (const e of f.effects) if (e.body >= 0) active.add(e.body);
  const others = [...active].filter((b) => b !== current).sort((a, b) => a - b);
  return active.has(current) || others.length === 0 ? [current, ...others] : others;
}

/**
 * The frames a later pass plays on `body`: only those with action there, and without the
 * system-wide effects (the solar flash), which the first pass already showed.
 */
export function framesFor(frames: readonly Frame[], body: number): Frame[] {
  return frames
    .filter((f) => f.effects.some((e) => e.body === body))
    .map((f) => ({ ...f, effects: f.effects.filter((e) => e.body === body) }));
}
