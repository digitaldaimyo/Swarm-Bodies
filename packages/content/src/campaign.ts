import {
  getBoard,
  validateOrder,
  type GameConfig,
  type Hex,
  type GameState,
  type MutationId,
  type PlayerId,
  type Rules,
  type StrainId,
} from "@swarm/sim";
import { MODIFIERS, type ModifierId } from "./modifiers";
import type { GameSummary } from "./summary";

/**
 * The campaign (SPEC §11.1): a galaxy of 12 systems as a node graph with branches. Each node is
 * one match with a fixed seed, an opponent strain and difficulty, an optional modifier and an
 * optional objective twist. Nodes 1–3 double as the tutorial (Single Rock and a two-body
 * system), with scripted overlays.
 */
import type { Line, Mood } from "./narrator";

export type Personality = "balanced" | "aggressive" | "greedy" | "expansionist" | "saboteur";
/** "novice" is the gentlest bot, for the first campaign nodes only (DECISIONS #122). */
export type Difficulty = "novice" | "easy" | "normal" | "hard";

/** Objective twists (SPEC §11.1): extra conditions on a win. */
export interface Twist {
  id: string;
  text: string;
  met(s: GameSummary): boolean;
}

export const TWISTS = {
  no_launch: {
    id: "no_launch",
    text: "Win without launching a spore.",
    met: (s: GameSummary) => s.launches === 0,
  },
  few_launches: {
    id: "few_launches",
    text: "Win launching at most 2 spores.",
    met: (s: GameSummary) => s.launches <= 2,
  },
  hold_3_bodies: {
    id: "hold_3_bodies",
    text: "Hold 3 bodies at once.",
    met: (s: GameSummary) => s.maxBodiesHeld >= 3,
  },
  keep_cores: {
    id: "keep_cores",
    text: "Win without losing a core.",
    met: (s: GameSummary) => s.coresLost === 0,
  },
  fast: {
    id: "fast",
    text: "Win by turn 30.",
    met: (s: GameSummary) => s.turns <= 30,
  },
} as const satisfies Record<string, Twist>;
export type TwistId = keyof typeof TWISTS;

/**
 * A tutorial step (SPEC §11.1): text shown over the match, and what completes it. The client
 * evaluates these against its planner, view and the turn's events.
 */
export type TutorialTrigger =
  | { kind: "next" }
  | { kind: "order"; order: "grow" | "reinforce" | "retract" | "fruit" | "launch" }
  | { kind: "submit" }
  | { kind: "event"; event: "CellCaptured" | "SporeLaunched" | "SporeLanded" | "FruitMatured" }
  | { kind: "systemView" }
  /** The player zoomed in far enough to see biomass numbers (Training grounds). */
  | { kind: "zoomIn" };

/**
 * When a step may appear (M8 tutorial pacing): it waits until the player can actually do what
 * it asks, instead of asking on turn 1 for something only possible on turn 4.
 */
export type TutorialCondition =
  | { kind: "always" }
  /** An own connected cell is thick enough to fruit. */
  | { kind: "canFruit" }
  /** An own fruiting body is ripe. */
  | { kind: "canLaunch" }
  /** An enemy cell touches one of yours. */
  | { kind: "contact" };

export interface TutorialStep {
  text: string;
  until: TutorialTrigger;
  /** Dr. Purr's expression while she says it (default smug). */
  mood?: Mood;
  /** Defaults to always. */
  when?: TutorialCondition;
}

export interface CampaignNode {
  id: string;
  index: number;
  name: string;
  blurb: string;
  /** Position on the galaxy map, 0–100 in both axes. */
  x: number;
  y: number;
  /** Unlocked when any of these is complete (none: always open). */
  after: string[];
  seed: string;
  map: { mode: GameConfig["mode"]; players: number; rules?: Partial<Rules> };
  you: StrainId | null;
  opponent: { strain: StrainId; difficulty: Difficulty; personality: Personality };
  modifier: ModifierId | null;
  twist: TwistId | null;
  unlocks: { strains?: StrainId[]; mutations?: MutationId[] };
  tutorial: TutorialStep[];
  /** Dr. Purr's introduction on the campaign map. */
  intro: Line;
}

const TWO_BODY: Partial<Rules> = {
  systemMinNeutrals: 0,
  systemExtraBodies: 0,
  systemMinBodies: 2,
};

export const CAMPAIGN: readonly CampaignNode[] = [
  {
    id: "c01",
    index: 1,
    name: "First Contact",
    blurb: "A lone asteroid and a rival colony. Learn to grow.",
    x: 10,
    y: 82,
    after: [],
    seed: "campaign-c01",
    map: { mode: "singleRock", players: 2 },
    you: "swarmer",
    opponent: { strain: "biofilm", difficulty: "novice", personality: "greedy" },
    modifier: null,
    twist: null,
    unlocks: {},
    tutorial: [],
    intro: {
      mood: "smug",
      text: "One rock, one rival, one very ambitious Swarmer. Grow toward the deposits and keep your core thick. I'll be watching. Mostly.",
    },
  },
  {
    id: "c02",
    index: 2,
    name: "Fronts",
    blurb: "The rival pushes back. Assaults, reinforcement and supply lines.",
    x: 22,
    y: 66,
    after: ["c01"],
    seed: "campaign-c02",
    map: { mode: "singleRock", players: 2 },
    you: "swarmer",
    opponent: { strain: "swarmer", difficulty: "novice", personality: "aggressive" },
    modifier: null,
    twist: null,
    unlocks: {},
    tutorial: [],
    intro: {
      mood: "intrigued",
      text: "This rival is a Swarmer too, and it pushes back. Reinforce your front before you push, and cut their veins where they're thin.",
    },
  },
  {
    id: "c03",
    index: 3,
    name: "Spore Season",
    blurb: "Two asteroids in orbit. Fruit, wait for the window, launch.",
    x: 34,
    y: 76,
    after: ["c02"],
    seed: "campaign-c03",
    map: { mode: "system", players: 2, rules: TWO_BODY },
    you: "sporer",
    opponent: { strain: "biofilm", difficulty: "novice", personality: "balanced" },
    modifier: null,
    twist: null,
    unlocks: {},
    tutorial: [],
    intro: {
      mood: "smug",
      text: "Two asteroids in orbit, and you're a Sporer now. Fruit, wait for the window, and launch. Do try to land on the rock, not near it.",
    },
  },
  {
    id: "c04",
    index: 4,
    name: "The Belt",
    blurb: "A real system. Win it and the Predator strain is yours.",
    x: 46,
    y: 60,
    after: ["c03"],
    seed: "campaign-c04",
    map: { mode: "system", players: 2 },
    you: null,
    opponent: { strain: "biofilm", difficulty: "easy", personality: "balanced" },
    modifier: null,
    twist: null,
    unlocks: { strains: ["predator"] },
    tutorial: [],
    intro: {
      mood: "intrigued",
      text: "A real system at last, with rocks to spare. Win it, and the Predator strain joins your notes.",
    },
  },
  {
    id: "c05",
    index: 5,
    name: "Flare Storm",
    blurb: "An angry star. Keep your cells thick.",
    x: 56,
    y: 78,
    after: ["c04"],
    seed: "campaign-c05",
    map: { mode: "system", players: 2 },
    you: null,
    opponent: { strain: "swarmer", difficulty: "normal", personality: "aggressive" },
    modifier: "flare_storm",
    twist: null,
    unlocks: { mutations: ["rad_shield"] },
    tutorial: [],
    intro: {
      mood: "unimpressed",
      text: "The star is in a mood: flares every 4 turns thin out the cells facing it. Keep your colonies thick, as I keep my coat.",
    },
  },
  {
    id: "c06",
    index: 6,
    name: "Comet Rain",
    blurb: "Rich comets fall all over the system. Spread to claim them.",
    x: 58,
    y: 44,
    after: ["c04"],
    seed: "campaign-c06",
    map: { mode: "system", players: 2 },
    you: null,
    opponent: { strain: "predator", difficulty: "normal", personality: "greedy" },
    modifier: "rich_comets",
    twist: "hold_3_bodies",
    unlocks: { mutations: ["quorum"] },
    tutorial: [],
    intro: {
      mood: "intrigued",
      text: "Rich comets keep falling, 8 N each. Spread out and hold 3 bodies at once. Greed, but scientific.",
    },
  },
  {
    id: "c07",
    index: 7,
    name: "Iron Moons",
    blurb: "Every neutral moon is metal. Win it and the Sporer strain is yours.",
    x: 70,
    y: 62,
    after: ["c05", "c06"],
    seed: "campaign-c07",
    map: { mode: "system", players: 2 },
    you: null,
    opponent: { strain: "biofilm", difficulty: "normal", personality: "balanced" },
    modifier: "metallic_only",
    twist: null,
    unlocks: { strains: ["sporer"] },
    tutorial: [],
    intro: {
      mood: "smug",
      text: "Every neutral moon here is metal: costly to enter, dense to hold. Win it, and the Sporer strain is yours.",
    },
  },
  {
    id: "c08",
    index: 8,
    name: "Grounded",
    blurb: "Spores are scarce: launch two at most, and win on foot.",
    x: 80,
    y: 80,
    after: ["c07"],
    seed: "campaign-c08",
    map: { mode: "system", players: 2 },
    you: null,
    opponent: { strain: "biofilm", difficulty: "easy", personality: "greedy" },
    modifier: null,
    twist: "few_launches",
    unlocks: { mutations: ["hardened_spores"] },
    tutorial: [],
    intro: {
      mood: "unimpressed",
      text: "Spores are scarce: launch two at most, and win on foot. Walking. How quaint.",
    },
  },
  {
    id: "c09",
    index: 9,
    name: "Three-Way",
    blurb: "Two rivals, one system.",
    x: 80,
    y: 44,
    after: ["c07"],
    seed: "campaign-c09",
    map: { mode: "system", players: 3 },
    you: null,
    opponent: { strain: "swarmer", difficulty: "normal", personality: "balanced" },
    modifier: null,
    twist: null,
    unlocks: {},
    tutorial: [],
    intro: {
      mood: "intrigued",
      text: "Two rivals and one system. Let them weaken each other, then take what's left. Purely observational advice.",
    },
  },
  {
    id: "c10",
    index: 10,
    name: "Saboteurs",
    blurb: "They go for the veins. Keep every core.",
    x: 88,
    y: 62,
    after: ["c08", "c09"],
    seed: "campaign-c10",
    map: { mode: "system", players: 2 },
    you: null,
    opponent: { strain: "predator", difficulty: "normal", personality: "saboteur" },
    modifier: null,
    twist: "keep_cores",
    unlocks: { mutations: ["deep_reserves"] },
    tutorial: [],
    intro: {
      mood: "unimpressed",
      text: "These Predators go for the veins. Win without losing a single core. I'm attached to them, and so are you.",
    },
  },
  {
    id: "c11",
    index: 11,
    name: "Swarm Tide",
    blurb: "A Hard Swarmer. Win before turn 30.",
    x: 90,
    y: 30,
    after: ["c10"],
    seed: "campaign-c11",
    map: { mode: "system", players: 2 },
    you: null,
    opponent: { strain: "swarmer", difficulty: "hard", personality: "balanced" },
    modifier: null,
    twist: "fast",
    unlocks: {},
    tutorial: [],
    intro: {
      mood: "smug",
      text: "A Hard Swarmer, and you must win by turn 30. Fast, thin and everywhere, much like my last assistant.",
    },
  },
  {
    id: "c12",
    index: 12,
    name: "Bloom",
    blurb: "Three rivals and the whole system. The last colony standing wins the galaxy.",
    x: 94,
    y: 12,
    after: ["c11"],
    seed: "campaign-c12",
    map: { mode: "system", players: 4 },
    you: null,
    opponent: { strain: "biofilm", difficulty: "normal", personality: "balanced" },
    modifier: null,
    twist: null,
    unlocks: {},
    tutorial: [],
    intro: {
      mood: "intrigued",
      text: "Three rivals, the whole system, and the last colony standing wins the galaxy. Try not to disappoint me now.",
    },
  },
];

export function campaignNode(id: string): CampaignNode | undefined {
  return CAMPAIGN.find((n) => n.id === id);
}

export function nodeOpen(node: CampaignNode, completed: ReadonlySet<string>): boolean {
  return node.after.length === 0 || node.after.some((id) => completed.has(id));
}

/** Whether a finished game completes the node: a win, and the twist when there is one. */
export function nodeCompleted(node: CampaignNode, s: GameSummary): boolean {
  if (s.outcome !== "win") return false;
  return node.twist === null || TWISTS[node.twist].met(s);
}

/**
 * The node's game: your strain (or the chosen one), the bots', the modifier's rules, and the
 * draft pool the player has unlocked so far (omitted: the full pool).
 */
export function nodeConfig(
  node: CampaignNode,
  chosen: StrainId,
  mutationPool?: readonly MutationId[],
): GameConfig {
  const rules: Partial<Rules> = {
    ...(node.map.rules ?? {}),
    ...(node.modifier ? MODIFIERS[node.modifier].rules : {}),
    ...(mutationPool ? { mutationPool: [...mutationPool] } : {}),
  };
  return {
    mode: node.map.mode,
    playerCount: node.map.players,
    strains: [
      node.you ?? chosen,
      ...Array.from({ length: node.map.players - 1 }, () => node.opponent.strain),
    ],
    ...(Object.keys(rules).length > 0 ? { rules } : {}),
  };
}

/** Whether a tutorial step's condition holds for `player` in `state` (client and tests). */
export function tutorialReady(
  state: GameState,
  player: PlayerId,
  when: TutorialCondition | undefined,
): boolean {
  if (!when || when.kind === "always") return true;
  for (const body of state.bodies) {
    const board = getBoard(body.radius);
    for (const [i, c] of body.colony.entries()) {
      if (!c || c.owner !== player) continue;
      // The sim's own check, so the step appears exactly when a Fruit order would be legal.
      if (
        when.kind === "canFruit" &&
        validateOrder(
          state,
          player,
          { type: "fruit", body: body.id, cell: board.cells[i] as Hex },
          [],
        ).ok
      )
        return true;
      if (when.kind === "canLaunch" && c.fruiting === 0) return true;
      if (
        when.kind === "contact" &&
        (board.neighbours[i] ?? []).some((n) => {
          const o = body.colony[n];
          return !!o && o.owner !== player;
        })
      )
        return true;
    }
  }
  return false;
}
