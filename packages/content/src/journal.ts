import {
  BASE_RULES,
  type BodyType,
  type DepositKind,
  type MutationId,
  type StrainId,
} from "@swarm/sim";
import { ACHIEVEMENTS } from "./achievements";
import { CAMPAIGN } from "./campaign";
import { LESSONS } from "./lessons";
import type { Mood } from "./narrator";
import type { Progress } from "./progress";

/**
 * The Codex as Dr. Purr's field journal (docs/plans/tutorial.md, step 6). Everything here is
 * data: her field notes on each Codex entry, the World entries, and the Journal's lore. A field
 * note opens once the player has met the thing (`Progress.met`, or `drafted` for mutations); a
 * Journal entry opens from lessons, campaign nodes and achievements already in progress.
 */

/** What a player can meet in a game: a key in `Progress.met`. */
export type MetId =
  | `strain:${StrainId}`
  | `body:${BodyType}`
  | `deposit:${DepositKind}`
  | "event:flare"
  | "event:comet";

export const STRAIN_NOTES: Record<Exclude<StrainId, "base">, string> = {
  swarmer:
    "Thin, fast and terribly enthusiastic. It covers ground the way spilled milk does, and holds it about as well.",
  biofilm:
    "Slow, dense, and smug about it. I respect that. Poking it achieves nothing; going around it achieves a little more.",
  predator:
    "It eats its neighbours and is paid for it. My assistant calls this rude. I call it efficient, and take notes from a safe distance.",
  sporer:
    "Its ambitions are interplanetary. Its landings are not always graceful, but neither were mine.",
};

export const MUTATION_NOTES: Record<MutationId, string> = {
  acid_tendrils:
    "Dissolving the opposition. Crude, but I've seen worse manners at faculty dinners.",
  chemotaxis: "It smells food and goes. A strategy I have personally refined over many years.",
  cryophile: "It thrives on ice. Cold-blooded, in the best sense.",
  deep_reserves: "It saves for later. Rare, in a colony. Rarer still in an assistant.",
  dormancy: "Cut off, it simply waits. Patience is underrated, especially near a radiator.",
  hardened_spores:
    "Armoured spores: they land heavier, and stay. Think of it as a better pair of boots.",
  lithotroph: "It eats rock. I tried to stop it. It ate the stopper.",
  quorum: "It counts its neighbours before it acts. Democracy, in slime. Remarkably effective.",
  rad_shield: "Sun-proof. I'd like the recipe for my ears.",
  rapid_fruiting: "It fruits early and often. Impatient, like a kitten at the cupboard.",
  regeneration: "It heals on the even turns. I nap on all of them. We each have our methods.",
  thick_veins: "It guards its heart with muscle. Sentimental, and correct.",
};

export interface WorldEntry {
  id: MetId;
  name: string;
  /** The rules, plainly (numbers from BASE_RULES). */
  facts: string[];
  note: string;
}

const r = BASE_RULES;

export const WORLD: readonly WorldEntry[] = [
  {
    id: "body:carbonaceous",
    name: "Carbonaceous rock",
    facts: ["Rich in organic deposits.", "Homes are Carbonaceous or Icy."],
    note: "Dark, crumbly, and full of things to eat. The specimen's favourite, and frankly mine.",
  },
  {
    id: "body:icy",
    name: "Icy rock",
    facts: ["Rich in ice deposits.", "Homes are Carbonaceous or Icy."],
    note: "Pretty, cold, and wet. Two out of three, which is about my tolerance.",
  },
  {
    id: "body:metallic",
    name: "Metallic rock",
    facts: [
      "Rich in mineral deposits.",
      `Growing costs +${r.metallicEntryExtra} N on every cell.`,
      `Cells hold up to +${r.metallicMaxBiomassBonus} more biomass.`,
    ],
    note: "Expensive to settle and hard to take back. Like a good armchair.",
  },
  {
    id: "body:irradiated",
    name: "Irradiated rock",
    facts: [
      `Deposits are richer (+${r.irradiatedDepositBonusPermille / 10}%).`,
      "At the end of each turn, every colony cell at biomass 1 is removed.",
    ],
    note: "It glows. Things that glow are either valuable or dangerous. This is both.",
  },
  {
    id: "deposit:organic",
    name: "Organic deposit",
    facts: [`Yields ${r.depositYield.organic} N a turn while connected.`],
    note: "Dark pods of something nourishing. I don't ask what. Neither should you.",
  },
  {
    id: "deposit:ice",
    name: "Ice deposit",
    facts: [`Yields ${r.depositYield.ice} N a turn while connected.`],
    note: "Crystal shards, slowly melting into dinner.",
  },
  {
    id: "deposit:mineral",
    name: "Mineral deposit",
    facts: [`Yields ${r.depositYield.mineral} N a turn while connected.`],
    note: "Metallic flecks. Poor eating, unless you have the stomach for it. Some strains do.",
  },
  {
    id: "event:flare",
    name: "Solar flare",
    facts: [
      `About one every ${r.flareEveryMin}–${r.flareEveryMax} turns, announced a turn ahead.`,
      `Cells facing the star lose ${r.flareLoss} biomass.`,
    ],
    note: "The star sneezes. Thin cells don't survive the sneeze. Keep them thick, as I keep my coat.",
  },
  {
    id: "event:comet",
    name: "Comet",
    facts: [
      `Announced ${r.cometWarning} turns ahead; lands on a body as a rich deposit.`,
      `Yields ${r.cometYield} N a turn for ${r.cometDuration} turns, then it's gone.`,
    ],
    note: "Dinner, delivered from space, with a strict serving time. Be there when it lands.",
  },
];

/** What opens a Journal entry. */
export type JournalUnlock =
  | { kind: "start" }
  | { kind: "lesson"; id: string }
  | { kind: "allLessons" }
  | { kind: "node"; id: string }
  | { kind: "achievement"; id: string };

export interface JournalEntry {
  id: string;
  title: string;
  mood: Mood;
  unlock: JournalUnlock;
  /** Paragraphs. */
  text: string[];
}

export const JOURNAL: readonly JournalEntry[] = [
  {
    id: "j_start",
    title: "Survey log, day one",
    mood: "smug",
    unlock: { kind: "start" },
    text: [
      "I have been sent to survey a belt of rocks around an unremarkable star. The grant committee was vague about why. I suspect they wanted me out of the department.",
      "The belt is alive: a slime that grows, feeds and fights. I have one question, and I intend to answer it before the grant runs out. Is it clever, or merely hungry?",
      "I have also been given an assistant. That's you. Try not to touch anything I haven't labelled.",
    ],
  },
  {
    id: "j_feeding",
    title: "On feeding",
    mood: "intrigued",
    unlock: { kind: "lesson", id: "l1" },
    text: [
      "The specimen finds deposits and grows toward them. It does not stop to admire the view. Neither do I, at dinner.",
      "Hungry, then. A point for that column.",
    ],
  },
  {
    id: "j_hearts",
    title: "On hearts",
    mood: "intrigued",
    unlock: { kind: "lesson", id: "l4" },
    text: [
      "Every colony keeps a core, and everything it holds is fed through it. Lose the core and the colony does not grieve. It simply starves.",
      "And yet it thickens the cells around its core, as if it knows. Hungry things don't usually plan ahead.",
    ],
  },
  {
    id: "j_assistant",
    title: "Assessment of the assistant",
    mood: "smug",
    unlock: { kind: "allLessons" },
    text: [
      "My assistant has completed basic training. Grow, mass, neighbours, cores, supply, spores, and the business of reaching for the same cell at the same time.",
      "Grade: adequate. From me, that is a garland. Do not let it go to your head; there is no room in there with all those orders.",
    ],
  },
  {
    id: "j_contact",
    title: "First contact",
    mood: "intrigued",
    unlock: { kind: "node", id: "c01" },
    text: [
      "A rival colony on the same rock. They met at the edges and did not share. Neither did they negotiate.",
      "I wrote “hungry” in the margin, then crossed it out. They went for the weak cells first.",
    ],
  },
  {
    id: "j_spores",
    title: "On travel",
    mood: "intrigued",
    unlock: { kind: "node", id: "c03" },
    text: [
      "It fruits, waits for the rocks to line up, and throws itself across the void. Waiting for the right moment is not a hungry habit.",
      "A point for “clever”. I have informed nobody. Yet.",
    ],
  },
  {
    id: "j_belt",
    title: "The belt",
    mood: "smug",
    unlock: { kind: "node", id: "c04" },
    text: [
      "We have reached the belt proper: rocks to spare and colonies on most of them. My assistant insists on naming the rocks. I have allowed three.",
      "The Predator strain lives here. It eats other colonies. My notes on manners will have to wait.",
    ],
  },
  {
    id: "j_star",
    title: "The star",
    mood: "unimpressed",
    unlock: { kind: "node", id: "c05" },
    text: [
      "The star flares, and thin cells on the bright side wither. The colonies that survive are the thick ones.",
      "I have moved my chair to the shady side of the ship. Science is about adapting.",
    ],
  },
  {
    id: "j_iron",
    title: "Iron moons",
    mood: "intrigued",
    unlock: { kind: "node", id: "c07" },
    text: [
      "Metal moons: dear to enter, dense to hold. The colony pays the price only where the deposits justify it.",
      "It is doing sums. Hungry things do not do sums.",
    ],
  },
  {
    id: "j_three",
    title: "Three's a crowd",
    mood: "smug",
    unlock: { kind: "node", id: "c09" },
    text: [
      "Two rivals and my specimen. It let them wear each other down, then took the remains.",
      "I would call that strategy. My assistant called it “rude”. You'll find those often overlap.",
    ],
  },
  {
    id: "j_bloom",
    title: "Conclusions",
    mood: "intrigued",
    unlock: { kind: "node", id: "c12" },
    text: [
      "The last colony standing holds the belt. The survey is complete, and I have my answer.",
      "Clever, or hungry? Both. The cleverness is in the service of the hunger. I recognise the type.",
      "The grant committee will receive a report of considerable length. My assistant will receive a biscuit.",
    ],
  },
  {
    id: "j_win",
    title: "A result",
    mood: "smug",
    unlock: { kind: "achievement", id: "first_win" },
    text: ["A win, recorded in ink. I underlined it once. Twice would be excessive."],
  },
  {
    id: "j_hope",
    title: "On hope",
    mood: "intrigued",
    unlock: { kind: "achievement", id: "comeback" },
    text: [
      "Down to a handful of cells, and still it won. Hungry things give up when the food runs out. This one went looking for more.",
    ],
  },
  {
    id: "j_outgrown",
    title: "Outgrown",
    mood: "intrigued",
    unlock: { kind: "achievement", id: "beat_hard" },
    text: [
      "My assistant has beaten the cleverest colony in the belt. I'm reconsidering which of you I am studying.",
    ],
  },
  {
    id: "j_panspermia",
    title: "Everywhere",
    mood: "smug",
    unlock: { kind: "achievement", id: "five_bodies" },
    text: [
      "Five rocks at once. The specimen is no longer a thing on a rock; the rocks are things in the specimen.",
    ],
  },
];

export function journalUnlocked(entry: JournalEntry, p: Progress): boolean {
  const u = entry.unlock;
  const lessons = p.completedLessons ?? [];
  switch (u.kind) {
    case "start":
      return true;
    case "lesson":
      return lessons.includes(u.id);
    case "allLessons":
      return LESSONS.every((l) => lessons.includes(l.id));
    case "node":
      return p.completedNodes.includes(u.id);
    case "achievement":
      return p.achievements.includes(u.id);
  }
}

/** Where a locked Journal entry is found. */
export function journalHint(u: JournalUnlock): string {
  switch (u.kind) {
    case "start":
      return "";
    case "lesson": {
      const l = LESSONS.find((x) => x.id === u.id);
      return `Finish the lesson “${l?.name ?? u.id}” in the Training grounds.`;
    }
    case "allLessons":
      return "Finish every lesson in the Training grounds.";
    case "node": {
      const n = CAMPAIGN.find((x) => x.id === u.id);
      return `Complete campaign system ${n?.index ?? "?"}: ${n?.name ?? u.id}.`;
    }
    case "achievement": {
      const a = ACHIEVEMENTS.find((x) => x.id === u.id);
      return `Earn the feat “${a?.name ?? u.id}”.`;
    }
  }
}
