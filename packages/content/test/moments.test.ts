import { describe, expect, it } from "vitest";
import type { GameEvent, GameState } from "@swarm/sim";
import {
  LESSONS,
  MOMENT_COOLDOWN,
  MOMENT_LINES,
  MOMENT_PRIORITY,
  detectMoments,
  lessonState,
  newMomentTracker,
  nextMoment,
} from "../src";

const base = (): GameState => structuredClone(lessonState(LESSONS[1]!));
const owned = (s: GameState, who: number) =>
  s.bodies[0]!.colony.flatMap((c, i) => (c && c.owner === who ? [i] : []));

describe("Dr. Purr's in-game moments", () => {
  it("has a line for every moment, without the word 'first'", () => {
    for (const m of MOMENT_PRIORITY) {
      expect(MOMENT_LINES[m].text.length).toBeGreaterThan(10);
      expect(MOMENT_LINES[m].text).not.toMatch(/\bfirst\b/i);
    }
  });

  it("detects captures, repels and cores from events, ordered by priority", () => {
    const s = base();
    const cell = { body: 0, q: 0, r: 0 };
    const events = [
      { type: "CellCaptured", player: 0, from: 1, cell, attack: 3 },
      { type: "CoreDestroyed", player: 1, by: 0, cell },
      { type: "AssaultRepelled", player: 1, defender: 0, cell, attack: 1 },
    ] as unknown as GameEvent[];
    expect(detectMoments(s, events, s, 0, false).found).toEqual(["theirCoreTaken", "capture"]);
    expect(detectMoments(s, events, s, 1, false).found).toEqual(["myCoreLost", "repelled"]);
  });

  it("detects a supply cut of two or more cells", () => {
    const before = base();
    const after = structuredClone(before);
    const mine = owned(after, 0);
    for (const i of mine.slice(0, 2)) after.bodies[0]!.colony[i]!.connected = false;
    for (const i of mine) before.bodies[0]!.colony[i]!.connected = true;
    expect(detectMoments(before, [], after, 0, false).found).toContain("supplyCut");
    const one = structuredClone(before);
    one.bodies[0]!.colony[mine[0]!]!.connected = false;
    expect(detectMoments(before, [], one, 0, false).found).not.toContain("supplyCut");
  });

  it("detects a comeback only after being far behind", () => {
    const s = base();
    const col = s.bodies[0]!.colony;
    // Player 0 holds one cell, player 1 the rest: far behind.
    const all = [...owned(s, 0), ...owned(s, 1)];
    all.forEach((i, k) => (col[i]!.owner = k === 0 ? 0 : 1));
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(detectMoments(s, [], s, 0, false).wasBehind).toBe(true);
    // Now player 0 holds all but one: the lead.
    const ahead = structuredClone(s);
    all.forEach((i, k) => (ahead.bodies[0]!.colony[i]!.owner = k === 0 ? 1 : 0));
    expect(detectMoments(s, [], ahead, 0, true).found).toContain("comeback");
    expect(detectMoments(s, [], ahead, 0, false).found).not.toContain("comeback");
  });

  it("speaks once a turn, once a moment, with a cooldown between lines", () => {
    const s = base();
    const flare = [{ type: "FlareWarning", impactTurn: 9 }] as unknown as GameEvent[];
    const both = [...flare, { type: "CometWarning", arrivalTurn: 9, body: 0 }] as GameEvent[];
    let t = newMomentTracker();
    const at = (turn: number) => ({ ...s, turn });
    let r = nextMoment(t, at(1), both, at(2), 0);
    expect(r.moment).toBe("flare");
    t = r.tracker;
    r = nextMoment(t, at(1 + MOMENT_COOLDOWN - 1), both, at(5), 0);
    expect(r.moment).toBeNull();
    r = nextMoment(r.tracker, at(1 + MOMENT_COOLDOWN), both, at(5), 0);
    expect(r.moment).toBe("comet");
    r = nextMoment(r.tracker, at(20), both, at(21), 0);
    expect(r.moment).toBeNull();
  });
});
