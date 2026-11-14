import {
  authoredGame,
  getBoard,
  incomeFor,
  type AuthoredMap,
  type GameState,
  type Hex,
  type Order,
  type Rules,
} from "@swarm/sim";
import type { TutorialStep } from "./campaign";

/**
 * The Training grounds (docs/plans/tutorial.md): short lessons on hand-placed boards, each
 * teaching one idea with a scripted opponent, so its key moment always happens. Optional, opened
 * from the title screen. Base strain throughout, so players learn the reference numbers.
 */
export type LessonGoal =
  /** Projected income (the HUD's figure) at least this much. */
  | { kind: "income"; atLeast: number }
  /** You own this cell, and the turn being planned is at least `fromTurn` (default 1). */
  | { kind: "own"; cell: Hex; fromTurn?: number };

export interface Lesson {
  id: string;
  index: number;
  name: string;
  blurb: string;
  /** The goal, as the player reads it. */
  goalText: string;
  map: AuthoredMap;
  /** The opponent's orders (seat 1) by turn number; turns not listed: no orders. */
  script: Readonly<Record<number, readonly Order[]>>;
  tutorial: readonly TutorialStep[];
  goal: LessonGoal;
}

/** Lessons run without drafts (they would interrupt the one idea a lesson teaches). */
const LESSON_RULES: Partial<Rules> = { draftThresholds: [] };

const grow = (...path: [number, number][]): Order => ({
  type: "grow",
  body: 0,
  path: path.map(([q, r]) => ({ q, r })),
});

/** A rival core sealed behind rock in a corner: present (a game needs two), but out of reach. */
const SEALED_RIVAL = {
  rock: [
    { q: 4, r: -5 },
    { q: 5, r: -4 },
    { q: 4, r: -4 },
  ],
  core: { q: 5, r: -5, owner: 1, biomass: 5, core: true },
};

export const LESSONS: readonly Lesson[] = [
  {
    id: "l1",
    index: 1,
    name: "Grow",
    blurb: "Paths, cost, reach and resources.",
    goalText: "Reach an income of 7 N a turn.",
    map: {
      radius: 5,
      rules: LESSON_RULES,
      nutrients: [14, 0],
      rock: [{ q: -2, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }, ...SEALED_RIVAL.rock],
      deposits: [
        { q: 1, r: 0, kind: "ice" },
        { q: -2, r: -2, kind: "organic" },
        { q: -1, r: -1, kind: "mineral" },
      ],
      cells: [
        { q: -4, r: 2, owner: 0, biomass: 5, core: true },
        { q: -3, r: 2, owner: 0, biomass: 2 },
        { q: -4, r: 3, owner: 0, biomass: 2 },
        SEALED_RIVAL.core,
      ],
    },
    script: {},
    tutorial: [
      {
        text: "Deposits pay income once your colony reaches them: ice 2 N a turn, organic 3. Your core pays 2. Goal: an income of 7.",
        until: { kind: "next" },
      },
      {
        text: "Drag from your colony toward a deposit. Each new cell costs 2 N, and a mineral cell 1 more.",
        until: { kind: "order", order: "grow" },
      },
      {
        text: "A path reaches at most 3 new cells a turn, and both deposits are 4 away. Start a path toward the other one too, from a different cell.",
        until: { kind: "order", order: "grow" },
      },
      { text: "Submit. Rock blocks paths: grow around it.", until: { kind: "submit" } },
      {
        text: "Finish both paths. Income arrives as soon as a deposit is connected to your core.",
        until: { kind: "submit" },
      },
    ],
    goal: { kind: "income", atLeast: 7 },
  },
  {
    id: "l2",
    index: 2,
    name: "Mass matters",
    blurb: "Reinforce, and zoom in to see biomass.",
    goalText: "Hold the gap through turn 3.",
    map: {
      radius: 5,
      rules: LESSON_RULES,
      nutrients: [10, 20],
      // A ridge down the middle with a three-cell gap, and a feeding ground in the gap.
      rock: [-5, -4, -3, -2, 2, 3, 4, 5].map((r) => ({ q: 0, r })),
      deposits: [{ q: 0, r: 0, kind: "organic" }],
      cells: [
        { q: -4, r: 0, owner: 0, biomass: 5, core: true },
        { q: -3, r: 0, owner: 0, biomass: 3 },
        { q: -2, r: 0, owner: 0, biomass: 3 },
        { q: -1, r: 0, owner: 0, biomass: 4 },
        { q: 0, r: 0, owner: 0, biomass: 1 },
        { q: 4, r: 0, owner: 1, biomass: 5, core: true },
        { q: 3, r: 0, owner: 1, biomass: 3 },
        { q: 2, r: 0, owner: 1, biomass: 3 },
        { q: 1, r: 0, owner: 1, biomass: 4 },
      ],
    },
    // The same attack twice: it captures the thin cell, then fails against the reinforced one.
    script: { 1: [grow([1, 0], [0, 0])], 3: [grow([1, 0], [0, 0])] },
    tutorial: [
      {
        text: "A gap in the rock, with a feeding ground in it. Pinch to zoom in until each cell shows its biomass.",
        until: { kind: "zoomIn" },
      },
      {
        text: "Your cell in the gap has biomass 1. Submit with no orders, and watch the rival.",
        until: { kind: "submit" },
      },
      {
        text: "They took it: attack 4 beat your defense 2 (biomass 1, plus 1 for your connected neighbour). Take it back: drag from your biomass-4 cell into the gap.",
        until: { kind: "order", order: "grow" },
      },
      { text: "Attack 4 against their 3. Submit.", until: { kind: "submit" } },
      {
        text: "They will try the same attack again. Tap your gap cell and Reinforce it: +3 biomass for 3 N.",
        until: { kind: "order", order: "reinforce" },
      },
      {
        text: "Reinforce resolves before growth: their attack 4 meets defense 5. Submit, and watch it fail.",
        until: { kind: "submit" },
      },
    ],
    goal: { kind: "own", cell: { q: 0, r: 0 }, fromTurn: 4 },
  },
  {
    id: "l3",
    index: 3,
    name: "Neighbours matter",
    blurb: "How attack and defense count adjacent cells.",
    goalText: "Capture the lower target.",
    map: {
      radius: 5,
      rules: LESSON_RULES,
      nutrients: [10, 10],
      cells: [
        { q: -4, r: 0, owner: 0, biomass: 5, core: true },
        { q: -3, r: 0, owner: 0, biomass: 3 },
        { q: -2, r: -1, owner: 0, biomass: 4 },
        { q: -3, r: 1, owner: 0, biomass: 2 },
        { q: -2, r: 1, owner: 0, biomass: 4 },
        { q: -2, r: 2, owner: 0, biomass: 2 },
        { q: -1, r: 2, owner: 0, biomass: 2 },
        { q: 2, r: -1, owner: 1, biomass: 5, core: true },
        { q: 2, r: -2, owner: 1, biomass: 2 },
        { q: 1, r: -2, owner: 1, biomass: 2 },
        { q: 0, r: -2, owner: 1, biomass: 2 },
        { q: -1, r: -2, owner: 1, biomass: 3 },
        { q: 1, r: 0, owner: 1, biomass: 2 },
        { q: 0, r: 1, owner: 1, biomass: 2 },
        { q: -1, r: 1, owner: 1, biomass: 3 },
      ],
    },
    script: {},
    tutorial: [
      {
        text: "Attack is your feeding cell's biomass, plus 1 for each other cell of yours touching the target. Defense is the target's biomass, plus 1 for each connected neighbour it has.",
        until: { kind: "next" },
      },
      {
        text: "Both rival tips have defense 4. Attack the upper one from your lone biomass-4 cell: 4 against 4.",
        until: { kind: "order", order: "grow" },
      },
      {
        text: "Now the lower one, from the biomass-4 cell whose two neighbours also touch it: 4 + 2 = 6 against 4.",
        until: { kind: "order", order: "grow" },
      },
      {
        text: "Submit. Watch which attack lands: ties go to the defender.",
        until: { kind: "submit" },
      },
    ],
    goal: { kind: "own", cell: { q: -1, r: 1 } },
  },
];

export function lesson(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}

/** The lesson's starting state. */
export function lessonState(l: Lesson): GameState {
  return authoredGame(l.map, `lesson-${l.id}`);
}

/** The opponent's orders for the turn being planned. */
export function lessonScript(l: Lesson, turn: number): readonly Order[] {
  return l.script[turn] ?? [];
}

/** Whether the lesson's goal is met in `state` (seat 0 is the player). */
export function lessonComplete(l: Lesson, state: GameState): boolean {
  const g = l.goal;
  if (g.kind === "income") return incomeFor(state, 0) >= g.atLeast;
  if (state.turn < (g.fromTurn ?? 1)) return false;
  const body = state.bodies[0];
  if (!body) return false;
  return body.colony[getBoard(body.radius).indexOf(g.cell.q, g.cell.r)]?.owner === 0;
}
