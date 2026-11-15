import type { GameEvent, GameState, PlayerId } from "@swarm/sim";
import type { Line } from "./narrator";

/**
 * Dr. Purr's in-game moments (docs/plans/tutorial.md, step 5): things worth a line, detected
 * from a turn's before state, events and after state. Pure, so the same code drives the game and
 * the frequency measurement over bot games (`pnpm balance -- --moments`).
 */
export type MomentId =
  | "myCoreLost"
  | "theirCoreTaken"
  | "supplyCut"
  | "cutTheirSupply"
  | "comeback"
  | "sporeLanded"
  | "capture"
  | "repelled"
  | "stalemate"
  | "flare"
  | "comet";

/** When several fire in one turn, the first in this list speaks. */
export const MOMENT_PRIORITY: readonly MomentId[] = [
  "myCoreLost",
  "theirCoreTaken",
  "supplyCut",
  "cutTheirSupply",
  "comeback",
  "sporeLanded",
  "capture",
  "repelled",
  "stalemate",
  "flare",
  "comet",
];

/** Turns that must pass after a line before the next one (taste rule; measured, see DECISIONS). */
export const MOMENT_COOLDOWN = 4;
/** Newly cut-off cells that count as a supply cut. */
const CUT_CELLS = 2;
/** A comeback: you led after falling to this share of the leader's cells or less. */
const COMEBACK_SHARE = 0.5;

export const MOMENT_LINES: Record<MomentId, Line> = {
  myCoreLost: {
    mood: "unimpressed",
    text: "You've lost a core. Everything fed through it is starving now. Reconnect what you can.",
  },
  theirCoreTaken: {
    mood: "intrigued",
    text: "Their core is gone, and everything it fed will starve. Ruthless. I'm taking notes.",
  },
  supplyCut: {
    mood: "unimpressed",
    text: "Your colony has been cut in two. The far side is starving; reconnect it or let it go.",
  },
  cutTheirSupply: {
    mood: "intrigued",
    text: "Severed. Everything beyond the cut will starve. Elegant, if a little rude.",
  },
  comeback: {
    mood: "intrigued",
    text: "From the brink to the lead. I'm updating my notes. Grudgingly.",
  },
  sporeLanded: {
    mood: "intrigued",
    text: "A spore has landed: a new core on a new rock. The specimen travels.",
  },
  capture: {
    mood: "intrigued",
    text: "A capture. The specimen is learning, or eating. Possibly both.",
  },
  repelled: {
    mood: "unimpressed",
    text: "Repelled. Count their neighbours next time, or bring some of your own.",
  },
  stalemate: {
    mood: "smug",
    text: "You both reached for the same cell with equal pressure. Nobody gets it. I relate.",
  },
  flare: {
    mood: "unimpressed",
    text: "A solar flare is coming. Cells facing the star will thin out. Keep them thick.",
  },
  comet: {
    mood: "intrigued",
    text: "A comet is on its way: a rich, short-lived deposit. Worth a detour.",
  },
};

/** What a game's moments have used so far. Plain data, so it can be kept between turns. */
export interface MomentTracker {
  said: MomentId[];
  /** The turn the last line was spoken on, or null. */
  lastTurn: number | null;
  /** You fell to COMEBACK_SHARE of the leader's cells or less at some point. */
  wasBehind: boolean;
}

export function newMomentTracker(): MomentTracker {
  return { said: [], lastTurn: null, wasBehind: false };
}

function cells(state: GameState): Map<PlayerId, number> {
  const n = new Map<PlayerId, number>();
  for (const b of state.bodies)
    for (const c of b.colony) if (c) n.set(c.owner, (n.get(c.owner) ?? 0) + 1);
  return n;
}

/** Cells owned by `who` that were connected before and are cut off now (still theirs). */
function newlyCut(before: GameState, after: GameState, who: (owner: PlayerId) => boolean): number {
  let n = 0;
  for (const b of after.bodies) {
    const prev = before.bodies[b.id];
    b.colony.forEach((c, i) => {
      const p = prev?.colony[i];
      if (c && who(c.owner) && !c.connected && p && p.owner === c.owner && p.connected) n++;
    });
  }
  return n;
}

/** Every moment the turn produced for `me` (before the once-per-game and cooldown rules). */
export function detectMoments(
  before: GameState,
  events: readonly GameEvent[],
  after: GameState,
  me: PlayerId,
  wasBehind: boolean,
): { found: MomentId[]; wasBehind: boolean } {
  const found = new Set<MomentId>();
  let iCaptured = false;
  for (const e of events) {
    if (e.type === "CoreDestroyed" && e.player === me) found.add("myCoreLost");
    if (e.type === "CoreDestroyed" && e.by === me && e.player !== me) found.add("theirCoreTaken");
    if (e.type === "CellCaptured" && e.player === me) {
      iCaptured = true;
      found.add("capture");
    }
    if (e.type === "AssaultRepelled" && e.player === me) found.add("repelled");
    if (e.type === "CellStalemate" && e.players.includes(me)) found.add("stalemate");
    if (e.type === "SporeLanded" && e.player === me && e.outcome === "newCore")
      found.add("sporeLanded");
    if (e.type === "FlareWarning") found.add("flare");
    if (e.type === "CometWarning") found.add("comet");
  }
  if (newlyCut(before, after, (o) => o === me) >= CUT_CELLS) found.add("supplyCut");
  if (iCaptured && newlyCut(before, after, (o) => o !== me) >= CUT_CELLS)
    found.add("cutTheirSupply");

  const n = cells(after);
  const mine = n.get(me) ?? 0;
  let leader = 0;
  for (const [p, c] of n) if (p !== me) leader = Math.max(leader, c);
  const behind = wasBehind || (leader > 0 && mine <= leader * COMEBACK_SHARE);
  if (wasBehind && mine > leader && !after.players.find((p) => p.id === me)?.eliminated)
    found.add("comeback");
  return { found: MOMENT_PRIORITY.filter((m) => found.has(m)), wasBehind: behind };
}

/**
 * The taste rules: at most one line a turn, each moment once a game, and MOMENT_COOLDOWN turns
 * between lines. Returns the moment to speak this turn (or null) and the updated tracker.
 */
export function nextMoment(
  tracker: MomentTracker,
  before: GameState,
  events: readonly GameEvent[],
  after: GameState,
  me: PlayerId,
): { moment: MomentId | null; tracker: MomentTracker } {
  const { found, wasBehind } = detectMoments(before, events, after, me, tracker.wasBehind);
  const turn = before.turn;
  const cooling = tracker.lastTurn !== null && turn - tracker.lastTurn < MOMENT_COOLDOWN;
  const pick = cooling ? undefined : found.find((m) => !tracker.said.includes(m));
  // A comeback is spent once it has happened, said or not.
  const behindNext = found.includes("comeback") ? false : wasBehind;
  if (!pick) return { moment: null, tracker: { ...tracker, wasBehind: behindNext } };
  return {
    moment: pick,
    tracker: { said: [...tracker.said, pick], lastTurn: turn, wasBehind: behindNext },
  };
}
