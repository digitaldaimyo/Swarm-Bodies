import {
  authoredGame,
  createGame,
  getBoard,
  incomeFor,
  type AuthoredMap,
  type GameState,
  type Hex,
  type Order,
  type Rules,
} from "@swarm/sim";
import type { TutorialStep } from "./campaign";
import type { Line } from "./narrator";

/**
 * The Training grounds (docs/plans/tutorial.md): short lessons on hand-placed boards, each
 * teaching one idea with a scripted opponent, so its key moment always happens. Optional, opened
 * from the title screen. Base strain throughout, so players learn the reference numbers.
 */
export type LessonGoal =
  /** Projected income (the HUD's figure) at least this much. */
  | { kind: "income"; atLeast: number }
  /** You own this cell, and the turn being planned is at least `fromTurn` (default 1). */
  | { kind: "own"; cell: Hex; fromTurn?: number }
  /** None of these cells (on body 0) holds a colony. */
  | { kind: "empty"; cells: Hex[] }
  /** You won the game. */
  | { kind: "won" }
  /** You hold cells on at least this many bodies. */
  | { kind: "bodies"; atLeast: number }
  /** Every one of these goals. */
  | { kind: "all"; goals: LessonGoal[] };

export interface Lesson {
  id: string;
  index: number;
  name: string;
  blurb: string;
  /** The goal, as the player reads it. */
  goalText: string;
  /** A hand-placed board (most lessons)... */
  map?: AuthoredMap;
  /** ...or a generated system (Fruit and launch: launches need orbits and other bodies). */
  system?: LessonSystem;
  /** The opponent's orders (seat 1) by turn number; turns not listed: no orders. */
  script: Readonly<Record<number, readonly Order[]>>;
  tutorial: readonly TutorialStep[];
  /** Dr. Purr's line when the lesson is complete. */
  done: Line;
  goal: LessonGoal;
}

/**
 * A generated two-player system for a lesson. The seed is chosen so the taught sequence (Reinforce,
 * Fruit, wait two turns, Launch) lands a spore early; a test checks it. Your first connected cell
 * beside the core starts at `cellBiomass`, one Reinforce short of fruiting.
 */
export interface LessonSystem {
  seed: string;
  rules: Partial<Rules>;
  nutrients: [number, number];
  cellBiomass: number;
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
        mood: "smug",
        text: "Welcome aboard the Third Nap, assistant. Our specimen eats deposits: ice pays 2 N a turn, organic 3, the core 2. Get it to 7.",
        until: { kind: "next" },
      },
      {
        mood: "smug",
        text: "Drag from the colony toward a deposit. Each new cell costs 2 N, and mineral costs 1 more, naturally.",
        until: { kind: "order", order: "grow" },
      },
      {
        mood: "intrigued",
        text: "Three new cells a turn is its limit, and both deposits are 4 away. Start a second path from another cell. Ambition is free.",
        until: { kind: "order", order: "grow" },
      },
      {
        mood: "smug",
        text: "Submit. Rock blocks paths; go around it, as I go around stairs.",
        until: { kind: "submit" },
      },
      {
        mood: "smug",
        text: "Finish both paths. Income arrives the moment a deposit connects to the core.",
        until: { kind: "submit" },
      },
    ],
    done: {
      mood: "intrigued",
      text: "Seven a turn. The specimen is fed, and I have a theory to ignore.",
    },
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
        mood: "smug",
        text: "A gap in the rock, with lunch in it. Pinch to zoom until every cell shows its biomass.",
        until: { kind: "zoomIn" },
      },
      {
        mood: "smug",
        text: "Your cell in the gap has biomass 1. Submit with no orders and watch the rival. I'll take notes.",
        until: { kind: "submit" },
      },
      {
        mood: "unimpressed",
        text: "They took it: attack 4 beat your defense 2. One biomass guarding a feeding ground. I've seen better strategy from a hairball.",
        until: { kind: "next" },
      },
      {
        mood: "smug",
        text: "Take it back: drag from your biomass-4 cell into the gap. Attack 4 against their 3.",
        until: { kind: "order", order: "grow" },
      },
      { mood: "smug", text: "Submit.", until: { kind: "submit" } },
      {
        mood: "intrigued",
        text: "They'll try the exact same thing. Tap your gap cell and Reinforce: +3 biomass for 3 N.",
        until: { kind: "order", order: "reinforce" },
      },
      {
        mood: "smug",
        text: "Reinforce lands before growth, so their 4 meets your 5. Submit, and watch.",
        until: { kind: "submit" },
      },
    ],
    done: {
      mood: "intrigued",
      text: "Held. Mass, assistant. It solves most problems, and naps solve the rest.",
    },
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
        mood: "smug",
        text: "Attack is your feeding cell's biomass, plus 1 for each other cell of yours touching the target. Defense is the target's biomass, plus 1 per connected neighbour. Do keep up.",
        until: { kind: "next" },
      },
      {
        mood: "smug",
        text: "Both rival tips have defense 4. Attack the upper one from your lone biomass-4 cell: 4 against 4.",
        until: { kind: "order", order: "grow" },
      },
      {
        mood: "intrigued",
        text: "Now the lower one, from the biomass-4 cell whose two neighbours also touch it: 4 + 2 = 6 against 4.",
        until: { kind: "order", order: "grow" },
      },
      {
        mood: "smug",
        text: "Submit. Ties go to the defender, so one of these will disappoint you.",
        until: { kind: "submit" },
      },
    ],
    done: { mood: "intrigued", text: "Same cell, two results. Friends help. Even for slime." },
    goal: { kind: "own", cell: { q: -1, r: 1 } },
  },
  {
    id: "l4",
    index: 4,
    name: "Protect your core",
    blurb: "What happens to a colony that loses its core.",
    goalText: "Destroy the rival core.",
    map: {
      radius: 5,
      rules: LESSON_RULES,
      nutrients: [10, 0],
      cells: [
        { q: -3, r: 0, owner: 0, biomass: 5, core: true },
        { q: -2, r: 0, owner: 0, biomass: 5 },
        { q: -1, r: 0, owner: 0, biomass: 7 },
        { q: 0, r: 0, owner: 1, biomass: 2, core: true },
        { q: 1, r: 0, owner: 1, biomass: 1 },
        { q: 2, r: 0, owner: 1, biomass: 2 },
        { q: 1, r: -1, owner: 1, biomass: 1 },
        { q: 0, r: 1, owner: 1, biomass: 1 },
      ],
    },
    script: {},
    tutorial: [
      {
        mood: "smug",
        text: "Every cell is fed through a core. Theirs is feeble: biomass 2, plus 3 for its connected neighbours. Defense 5.",
        until: { kind: "next" },
      },
      {
        mood: "intrigued",
        text: "Drag from your biomass-7 cell into their core: attack 7 against 5.",
        until: { kind: "order", order: "grow" },
      },
      {
        mood: "smug",
        text: "Submit, and watch what happens to a colony without a core.",
        until: { kind: "submit" },
      },
    ],
    done: {
      mood: "intrigued",
      text: "No core, no colony. Keep yours thick and surrounded, assistant. I'd hate to start over.",
    },
    goal: { kind: "won" },
  },
  {
    id: "l5",
    index: 5,
    name: "Supply is critical",
    blurb: "Cut a supply line and the cells beyond it starve.",
    goalText: "Cut the rival's arm off, and let it starve.",
    map: {
      radius: 5,
      rules: LESSON_RULES,
      nutrients: [10, 0],
      cells: [
        { q: 0, r: -4, owner: 0, biomass: 5, core: true },
        { q: 0, r: -3, owner: 0, biomass: 4 },
        { q: 0, r: -2, owner: 0, biomass: 4 },
        { q: 0, r: -1, owner: 0, biomass: 5 },
        { q: 3, r: 0, owner: 1, biomass: 5, core: true },
        { q: 2, r: 0, owner: 1, biomass: 3 },
        { q: 1, r: 0, owner: 1, biomass: 3 },
        { q: 0, r: 0, owner: 1, biomass: 1 },
        { q: -1, r: 0, owner: 1, biomass: 2 },
        { q: -2, r: 0, owner: 1, biomass: 2 },
        { q: -2, r: 1, owner: 1, biomass: 2 },
      ],
    },
    script: {},
    tutorial: [
      {
        mood: "smug",
        text: "Cells live only while connected to a core. The rival's western arm hangs off a single cell of biomass 1. Careless.",
        until: { kind: "next" },
      },
      {
        mood: "intrigued",
        text: "Drag from your biomass-5 cell into that neck: attack 5 against 1, plus 2 support.",
        until: { kind: "order", order: "grow" },
      },
      { mood: "smug", text: "Submit, and watch the arm.", until: { kind: "submit" } },
      {
        mood: "intrigued",
        text: "Cut off, it starves: 1 biomass a turn, starting at once. The rims show how long each cell has. Submit again.",
        until: { kind: "submit" },
      },
    ],
    done: { mood: "smug", text: "Severed and starved. Elegant, if a little rude." },
    goal: {
      kind: "all",
      goals: [
        { kind: "own", cell: { q: 0, r: 0 } },
        {
          kind: "empty",
          cells: [
            { q: -1, r: 0 },
            { q: -2, r: 0 },
            { q: -2, r: 1 },
          ],
        },
      ],
    },
  },
  {
    id: "l6",
    index: 6,
    name: "Fruit and launch",
    blurb: "Spread to another body with a spore.",
    goalText: "Land a spore on another body.",
    system: {
      seed: "lesson-6-7",
      rules: { ...LESSON_RULES, systemMinNeutrals: 1, systemExtraBodies: 1 },
      nutrients: [20, 0],
      cellBiomass: 4,
    },
    script: {},
    tutorial: [
      {
        mood: "intrigued",
        text: "Spores carry a colony to other bodies. A connected cell with biomass 5 or more can Fruit for 10 N; it ripens in 2 turns, then can Launch.",
        until: { kind: "next" },
      },
      {
        mood: "smug",
        text: "The cell beside your core has biomass 4. Tap it and Reinforce it to 7.",
        until: { kind: "order", order: "reinforce" },
      },
      { mood: "smug", text: "Submit.", until: { kind: "submit" } },
      {
        mood: "intrigued",
        text: "Tap that cell again and choose Fruit.",
        until: { kind: "order", order: "fruit" },
        when: { kind: "canFruit" },
      },
      {
        mood: "smug",
        text: "Submit. Watch the stalk grow as it ripens. Patience is a virtue I mostly admire in others.",
        until: { kind: "submit" },
      },
      {
        mood: "intrigued",
        text: "Pinch out, or tap the sun in the body strip, for the System view. Bodies move on their orbits; the forecast shows when one comes in range.",
        until: { kind: "systemView" },
      },
      {
        mood: "intrigued",
        text: "It's ripe. Open your home body, tap it, choose Launch, pick a body in range, then where to land.",
        until: { kind: "order", order: "launch" },
        when: { kind: "canLaunch" },
      },
      {
        mood: "smug",
        text: "Submit. The spore crosses space for a turn or more, then lands as a new core.",
        until: { kind: "submit" },
      },
    ],
    done: {
      mood: "intrigued",
      text: "A new colony on a new rock. I'll be insufferable about this at the next conference.",
    },
    goal: { kind: "bodies", atLeast: 2 },
  },
  {
    id: "l7",
    index: 7,
    name: "At the same time",
    blurb: "Orders are sealed and resolve together.",
    goalText: "Take the cell between you.",
    map: {
      radius: 5,
      rules: LESSON_RULES,
      nutrients: [10, 20],
      cells: [
        { q: -3, r: 0, owner: 0, biomass: 5, core: true },
        { q: -2, r: 0, owner: 0, biomass: 2 },
        { q: -1, r: 0, owner: 0, biomass: 2 },
        { q: 3, r: 0, owner: 1, biomass: 5, core: true },
        { q: 2, r: 0, owner: 1, biomass: 2 },
        { q: 1, r: 0, owner: 1, biomass: 2 },
      ],
    },
    // The rival reaches for the middle cell on odd turns, giving you a turn to reinforce.
    script: Object.fromEntries([1, 3, 5, 7, 9].map((t) => [t, [grow([1, 0], [0, 0])]])),
    tutorial: [
      {
        mood: "smug",
        text: "Everyone plans in secret, then all orders resolve together. Drag from your tip into the empty cell between you, then submit.",
        until: { kind: "submit" },
      },
      {
        mood: "unimpressed",
        text: "You both reached it with equal pressure, 2 against 2: a stalemate. Nobody gets it. Reinforce your tip (+3).",
        until: { kind: "order", order: "reinforce" },
      },
      { mood: "smug", text: "Submit, and let them reach again.", until: { kind: "submit" } },
      {
        mood: "intrigued",
        text: "Grow into it again: 5 against their 2, and the stronger claim wins. A “?” on a preview means someone else might reach that cell too.",
        until: { kind: "submit" },
      },
    ],
    done: {
      mood: "smug",
      text: "You both reached for it at the same moment, then you reached harder. I relate to this deeply.",
    },
    goal: { kind: "own", cell: { q: 0, r: 0 } },
  },
];

export function lesson(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}

/** The lesson's starting state. */
export function lessonState(l: Lesson): GameState {
  if (l.map) return authoredGame(l.map, `lesson-${l.id}`);
  const sys = l.system;
  if (!sys) throw new Error(`lesson ${l.id} has no board`);
  const s = createGame({ mode: "system", playerCount: 2, rules: sys.rules }, sys.seed);
  const home = s.players.find((p) => p.id === 0)?.home.body ?? 0;
  const homeBody = s.bodies[home];
  const cell = homeBody
    ? homeBody.colony.findIndex((c) => !!c && c.owner === 0 && !c.core && c.connected)
    : -1;
  return {
    ...s,
    bodies: s.bodies.map((b) =>
      b.id === home
        ? {
            ...b,
            colony: b.colony.map((c, i) =>
              i === cell && c ? { ...c, biomass: sys.cellBiomass } : c,
            ),
          }
        : b,
    ),
    players: s.players.map((p, i) => ({ ...p, nutrients: sys.nutrients[i] ?? p.nutrients })),
  };
}

/** The opponent's orders for the turn being planned. */
export function lessonScript(l: Lesson, turn: number): readonly Order[] {
  return l.script[turn] ?? [];
}

/** Whether the lesson's goal is met in `state` (seat 0 is the player). */
export function lessonComplete(l: Lesson, state: GameState): boolean {
  return goalMet(l.goal, state);
}

function goalMet(g: LessonGoal, state: GameState): boolean {
  const body = state.bodies[0];
  const cellAt = (h: Hex) =>
    body ? (body.colony[getBoard(body.radius).indexOf(h.q, h.r)] ?? null) : null;
  switch (g.kind) {
    case "income":
      return incomeFor(state, 0) >= g.atLeast;
    case "own":
      return state.turn >= (g.fromTurn ?? 1) && cellAt(g.cell)?.owner === 0;
    case "empty":
      return g.cells.every((h) => cellAt(h) === null);
    case "won":
      return state.result?.winner === 0;
    case "bodies":
      return state.bodies.filter((b) => b.colony.some((c) => c?.owner === 0)).length >= g.atLeast;
    case "all":
      return g.goals.every((x) => goalMet(x, state));
  }
}
