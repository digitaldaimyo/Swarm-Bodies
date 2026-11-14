import { describe, expect, it } from "vitest";
import {
  getBoard,
  incomeFor,
  resolveTurn,
  validateOrderSet,
  type GameState,
  type Order,
} from "@swarm/sim";
import { LESSONS, lesson, lessonComplete, lessonScript, lessonState } from "../src";

const grow = (...path: [number, number][]): Order => ({
  type: "grow",
  body: 0,
  path: path.map(([q, r]) => ({ q, r })),
});
const reinforce = (q: number, r: number): Order => ({ type: "reinforce", body: 0, cell: { q, r } });
const owner = (s: GameState, q: number, r: number) =>
  s.bodies[0]!.colony[getBoard(s.bodies[0]!.radius).indexOf(q, r)]?.owner ?? null;
const biomass = (s: GameState, q: number, r: number) =>
  s.bodies[0]!.colony[getBoard(s.bodies[0]!.radius).indexOf(q, r)]?.biomass ?? 0;

/** Plays the player's `turns` against the lesson's script; every set must be legal. */
function play(id: string, turns: Order[][]): GameState {
  const l = lesson(id)!;
  let s = lessonState(l);
  for (const mine of turns) {
    expect(validateOrderSet(s, 0, mine)).toMatchObject({ ok: true });
    const theirs = [...lessonScript(l, s.turn)];
    expect(validateOrderSet(s, 1, theirs)).toMatchObject({ ok: true });
    s = resolveTurn(s, { 0: mine, 1: theirs }).state;
    expect(s.result).toBeNull();
  }
  return s;
}

describe("Training grounds lessons (docs/plans/tutorial.md)", () => {
  it("every lesson starts valid, unfinished, and on a phone-sized board", () => {
    for (const l of LESSONS) {
      const s = lessonState(l);
      expect(s.bodies[0]!.radius).toBeLessThanOrEqual(5);
      expect(lessonComplete(l, s)).toBe(false);
      expect(s.players.every((p) => p.strain === "base")).toBe(true);
      expect(l.tutorial.length).toBeGreaterThan(0);
    }
  });

  it("1. Grow: reach doesn't cover a deposit in one turn, but two turns reach income 7", () => {
    const l = lesson("l1")!;
    expect(incomeFor(lessonState(l), 0)).toBe(2);
    const t1 = play("l1", [
      [grow([-3, 2], [-2, 1], [-1, 0], [0, 0]), grow([-4, 2], [-4, 1], [-3, 0], [-2, -1])],
    ]);
    expect(lessonComplete(l, t1)).toBe(false);
    const t2 = play("l1", [
      [grow([-3, 2], [-2, 1], [-1, 0], [0, 0]), grow([-4, 2], [-4, 1], [-3, 0], [-2, -1])],
      [grow([0, 0], [1, 0]), grow([-2, -1], [-2, -2])],
    ]);
    expect(incomeFor(t2, 0)).toBe(7);
    expect(lessonComplete(l, t2)).toBe(true);
  });

  it("2. Mass matters: the unreinforced gap falls twice; reinforced, it holds", () => {
    const l = lesson("l2")!;
    // Turn 1: no orders; their attack 4 against defense 1 + 1 takes the gap.
    const t1 = play("l2", [[]]);
    expect(owner(t1, 0, 0)).toBe(1);
    // Turn 2: retake from the biomass-4 cell, 4 against 2 + 1.
    const t2 = play("l2", [[], [grow([-1, 0], [0, 0])]]);
    expect(owner(t2, 0, 0)).toBe(0);
    expect(biomass(t2, 0, 0)).toBe(1);
    // Turn 3 without reinforcing: the same attack takes it again.
    const lost = play("l2", [[], [grow([-1, 0], [0, 0])], []]);
    expect(owner(lost, 0, 0)).toBe(1);
    expect(lessonComplete(l, lost)).toBe(false);
    // Turn 3 reinforced: 4 against 4 + 1 fails, and the lesson is complete.
    const held = play("l2", [[], [grow([-1, 0], [0, 0])], [reinforce(0, 0)]]);
    expect(owner(held, 0, 0)).toBe(0);
    expect(held.turn).toBe(4);
    expect(lessonComplete(l, held)).toBe(true);
  });

  it("3. Neighbours matter: the lone attack ties and fails, the flanked one captures", () => {
    const l = lesson("l3")!;
    const s = play("l3", [[grow([-2, -1], [-1, -2]), grow([-2, 1], [-1, 1])]]);
    expect(owner(s, -1, -2)).toBe(1);
    expect(biomass(s, -1, -2)).toBe(1);
    expect(owner(s, -1, 1)).toBe(0);
    expect(biomass(s, -1, 1)).toBe(2);
    expect(lessonComplete(l, s)).toBe(true);
  });
});

describe("lesson progress", () => {
  it("merges finished lessons by union, including progress saved before lessons existed", async () => {
    const { emptyProgress, mergeProgress } = await import("../src");
    const old = { ...emptyProgress() } as Partial<ReturnType<typeof emptyProgress>>;
    delete old.completedLessons;
    const merged = mergeProgress(
      { ...emptyProgress(), completedLessons: ["l2", "l1"] },
      old as ReturnType<typeof emptyProgress>,
    );
    expect(merged.completedLessons).toEqual(["l1", "l2"]);
  });
});
