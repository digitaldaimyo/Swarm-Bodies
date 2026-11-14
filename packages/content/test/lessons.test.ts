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
      if (l.map) expect(s.bodies[0]!.radius).toBeLessThanOrEqual(5);
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

describe("Training grounds lessons 4, 5 and 7 (step 3)", () => {
  /** Plays to the end or to `turns`, whichever is first (lesson 4 ends the game). */
  function playThrough(id: string, turns: Order[][]): GameState {
    const l = lesson(id)!;
    let s = lessonState(l);
    for (const mine of turns) {
      if (s.result) break;
      expect(validateOrderSet(s, 0, mine)).toMatchObject({ ok: true });
      s = resolveTurn(s, { 0: mine, 1: [...lessonScript(l, s.turn)] }).state;
    }
    return s;
  }

  it("4. Protect your core: taking the weak core ends the rival in the same turn", () => {
    const s = playThrough("l4", [[grow([-1, 0], [0, 0])]]);
    expect(s.result?.winner).toBe(0);
    expect(owner(s, 0, 0)).toBe(0);
    expect(lessonComplete(lesson("l4")!, s)).toBe(true);
  });

  it("5. Supply: cutting the neck starves the arm in two turns", () => {
    const l = lesson("l5")!;
    const cut = playThrough("l5", [[grow([0, -1], [0, 0])]]);
    expect(owner(cut, 0, 0)).toBe(0);
    expect(biomass(cut, -1, 0)).toBe(1);
    expect(lessonComplete(l, cut)).toBe(false);
    const starved = playThrough("l5", [[grow([0, -1], [0, 0])], []]);
    expect(owner(starved, -2, 1)).toBeNull();
    expect(lessonComplete(l, starved)).toBe(true);
  });

  it("7. At the same time: a stalemate, then the thicker claim wins", () => {
    const l = lesson("l7")!;
    const tie = playThrough("l7", [[grow([-1, 0], [0, 0])]]);
    expect(owner(tie, 0, 0)).toBeNull();
    expect(lessonComplete(l, tie)).toBe(false);
    const won = playThrough("l7", [
      [grow([-1, 0], [0, 0])],
      [reinforce(-1, 0)],
      [grow([-1, 0], [0, 0])],
    ]);
    expect(owner(won, 0, 0)).toBe(0);
    expect(lessonComplete(l, won)).toBe(true);
  });
});

describe("Training grounds lesson 6: fruit and launch (step 3)", () => {
  it("reinforce, fruit, wait for it to ripen, launch: a spore lands on another body by turn 6", () => {
    const l = lesson("l6")!;
    let s = lessonState(l);
    expect(s.mode).toBe("system");
    const home = s.players[0]!.home.body;
    const body = s.bodies[home]!;
    const board = getBoard(body.radius);
    const i = body.colony.findIndex((c) => !!c && c.owner === 0 && !c.core && c.connected);
    expect(body.colony[i]!.biomass).toBe(4);
    const cell = board.cells[i]!;
    let launched = 0;
    for (let t = 1; t <= 6 && !lessonComplete(l, s); t++) {
      let mine: Order[] = [];
      if (t === 1) mine = [{ type: "reinforce", body: home, cell }];
      else if (t === 2) mine = [{ type: "fruit", body: home, cell }];
      else if (!launched) {
        outer: for (const b of s.bodies) {
          if (b.id === home || b.home === 1) continue;
          const bb = getBoard(b.radius);
          for (const target of bb.cells) {
            const o: Order = {
              type: "launch",
              body: home,
              cell,
              targetBody: b.id,
              targetCell: target,
            };
            if (validateOrderSet(s, 0, [o]).ok) {
              mine = [o];
              launched = t;
              break outer;
            }
          }
        }
      }
      expect(validateOrderSet(s, 0, mine)).toMatchObject({ ok: true });
      s = resolveTurn(s, { 0: mine, 1: [] }).state;
    }
    // Ripe on turn 4 (fruited on 2, two turns to ripen), in range at once.
    expect(launched).toBe(4);
    expect(lessonComplete(l, s)).toBe(true);
    expect(s.turn).toBeLessThanOrEqual(7);
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

describe("Dr. Ottoline Purr's lines (step 4)", () => {
  it("every lesson step, completion, campaign node and result has a line with an expression", async () => {
    const { CAMPAIGN, RESULT_LINES } = await import("../src");
    const lines = [
      ...LESSONS.flatMap((l) => [...l.tutorial, l.done]),
      ...CAMPAIGN.map((n) => n.intro),
      ...Object.values(RESULT_LINES),
    ];
    for (const line of lines) {
      expect(["smug", "intrigued", "unimpressed"]).toContain(line.mood);
      // Short enough to read in one glance on a phone.
      expect(line.text.length).toBeLessThanOrEqual(200);
      expect(line.text.trim()).toBe(line.text);
    }
    expect(CAMPAIGN.every((n) => n.intro.text.length > 0)).toBe(true);
  });

  it("the campaign's old tutorial cards are gone: the Training grounds teach instead", async () => {
    const { CAMPAIGN } = await import("../src");
    expect(CAMPAIGN.slice(0, 3).every((n) => n.tutorial.length === 0)).toBe(true);
  });
});
