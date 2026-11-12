import { BASE_RULES } from "@swarm/sim";

/**
 * "How to play" (Codex): the core rules in plain words. Every number is read from BASE_RULES,
 * so the guide cannot drift from the tunables (CLAUDE.md: never tune numbers inline).
 */
export interface GuideSection {
  id: string;
  title: string;
  points: string[];
}

const r = BASE_RULES;
const pct = (permille: number) => `${permille / 10}%`;
const support = r.defenseSupport === 1 ? "1" : String(r.defenseSupport);

/** The combat rule, shared by the guide and the campaign tutorial. */
export const COMBAT_RULE = {
  attack: "your feeder cell's biomass, plus 1 for each other cell of yours touching the target",
  defense: `their cell's biomass, plus ${support} for each of their connected cells touching it`,
};

export const GUIDE: readonly GuideSection[] = [
  {
    id: "goal",
    title: "Goal",
    points: [
      `Spread your colony. Dominance is your share of all open cells: hold ${pct(r.dominanceWinPermille)} at the end of ${r.dominanceWinConsecutiveTurns} turns in a row to win.`,
      "Lose every core and you are out; the last colony standing wins.",
      `If nobody has won by the end of turn ${r.turnLimit}, the highest dominance wins.`,
    ],
  },
  {
    id: "turns",
    title: "Turns",
    points: [
      "Everyone plans at once, then all orders resolve together. Nobody sees your orders until the turn plays out.",
      "Watch the replay and the “What happened” log to see how each fight went.",
    ],
  },
  {
    id: "growing",
    title: "Growing",
    points: [
      `Drag from one of your connected cells to paint a Grow path, up to ${r.growReach} new cells (your strain may change this).`,
      `Each new cell costs ${r.baseEntryCost} N (minerals and metallic rock cost more). New cells start with biomass ${r.newCellBiomass}.`,
      `Reinforce adds ${r.reinforceAmount} biomass to a cell for ${r.reinforceCost} N. Retract gives a cell up for ${r.retractRefund} N back.`,
    ],
  },
  {
    id: "combat",
    title: "Combat",
    points: [
      "There is no attack button: growing into an enemy cell is an assault.",
      `Attack is ${COMBAT_RULE.attack}. Defense is ${COMBAT_RULE.defense}.`,
      "If attack beats defense, you capture the cell with the difference as its biomass (at least 1). Capturing a core destroys it.",
      "Otherwise your path stops there, and the defender loses half your attack in biomass (never below 1).",
      "While you drag, the label on an enemy cell shows attack vs defense: green captures, red bounces, and “?” means other players' orders could change it.",
      "Thick cells win fights. Reinforce your front before you push, and attack where several of your cells touch the target.",
      "If several paths reach the same empty cell, the strongest takes it; a tie leaves it empty (a stalemate).",
    ],
  },
  {
    id: "supply",
    title: "Supply lines",
    points: [
      "Cells linked to a core through your colony are connected. Only connected cells earn income and count for defense.",
      `Cut-off cells starve, losing ${r.starvationLoss} biomass a turn. Cutting an enemy vein weakens everything beyond the cut.`,
    ],
  },
  {
    id: "nutrients",
    title: "Nutrients",
    points: [
      `Each connected core pays ${r.incomePerCore} N a turn, and each connected deposit (ice, organic, mineral) pays its yield.`,
      "The HUD shows N banked, the cost of your plan, and next turn's income.",
    ],
  },
  {
    id: "spores",
    title: "Spores and other bodies",
    points: [
      `Fruit a connected cell with biomass ${r.fruitMinBiomass} or more (${r.fruitCost} N). It ripens in ${r.fruitMatureTurns} turns.`,
      `A ripe fruiting body can Launch a spore at a body within range when their orbits line up (the forecast shows launch windows). It lands as a new core with biomass ${r.landingBiomass}.`,
      "Solar flares thin out cells facing the sun; comets drop rich, short-lived deposits.",
    ],
  },
  {
    id: "mutations",
    title: "Mutations",
    points: [
      `When your colony's total biomass first reaches ${r.draftThresholds.join(", ")}, you draft one of ${r.draftOptions} mutations. Each changes your rules for the rest of the game.`,
    ],
  },
];
