import { BASE_RULES, MUTATION_IDS, type MutationId } from "@swarm/sim";

/**
 * Mutation presentation (SPEC §7.3, §11.3): names, the rules line shown on draft cards
 * (generated from the sim's numbers), flavour, and a real microbiology note for the codex.
 */
export interface MutationInfo {
  id: MutationId;
  name: string;
  /** One-word glyph for HUD banners (drawn as text; no bitmap assets). */
  glyph: string;
  effect: string;
  flavour: string;
  note: string;
}

const n = BASE_RULES.mutations;
const signed = (v: number) => `${v > 0 ? "+" : "−"}${Math.abs(v)}`;

const INFO: Record<MutationId, Omit<MutationInfo, "id">> = {
  acid_tendrils: {
    name: "Acid Tendrils",
    glyph: "⚗",
    effect: `${signed(n.acidAttack)} attack on assaults.`,
    flavour: "Dissolve what you cannot outgrow.",
    note: "Many bacteria secrete acids and enzymes that break down neighbouring tissue and competitors' cell walls.",
  },
  chemotaxis: {
    name: "Chemotaxis",
    glyph: "➶",
    effect: `Entering a deposit costs ${signed(n.chemotaxisCostDelta)} N. Paths ending on a deposit get ${signed(n.chemotaxisReach)} reach.`,
    flavour: "Follow the gradient.",
    note: "Chemotaxis is directed movement along a chemical gradient: E. coli swims toward nutrients by biasing its tumbles.",
  },
  cryophile: {
    name: "Cryophile",
    glyph: "❄",
    effect: `Ice yields ${signed(n.cryophileIceBonus)}.`,
    flavour: "At home where water freezes.",
    note: "Psychrophiles grow below 15 °C, using antifreeze proteins and flexible enzymes to stay active in ice.",
  },
  deep_reserves: {
    name: "Deep Reserves",
    glyph: "◉",
    effect: `${signed(n.deepReservesPerCore)} N per core per turn. Bank interest: +${n.deepReservesInterestPermille / 10}% of banked N, at most +${n.deepReservesInterestCap}.`,
    flavour: "Store now, spend later.",
    note: "Bacteria stockpile carbon as granules of polyhydroxybutyrate and phosphate as polyphosphate for lean times.",
  },
  dormancy: {
    name: "Dormant Cells",
    glyph: "☾",
    effect: `Cut-off cells do not starve for their first ${n.dormancyTurns} disconnected turns.`,
    flavour: "Sleep through the siege.",
    note: "Persister cells and spores shut down metabolism to survive starvation and antibiotics, then wake when conditions improve.",
  },
  hardened_spores: {
    name: "Hardened Spores",
    glyph: "◆",
    effect: `Landing biomass ${signed(n.hardenedLandingBonus)}.`,
    flavour: "Built to survive the void.",
    note: "Bacillus endospores have layered protein coats and dehydrated cores; some have survived exposure in low Earth orbit.",
  },
  lithotroph: {
    name: "Lithotroph",
    glyph: "⛏",
    effect: `Mineral cells cost no extra to enter. Mineral yields ${signed(n.lithotrophMineralBonus)}.`,
    flavour: "Eat the rock itself.",
    note: "Lithotrophs draw energy from inorganic compounds such as iron, sulfur or hydrogen, and some live kilometres underground.",
  },
  quorum: {
    name: "Quorum Sensing",
    glyph: "⁂",
    effect: `Cells with ${n.quorumNeighbours}+ adjacent own cells get ${signed(n.quorumAttack)} attack and ${signed(n.quorumDefense)} defense.`,
    flavour: "Strength in numbers, counted chemically.",
    note: "Bacteria release signal molecules and switch on group behaviours, like glowing or virulence, only once the crowd is dense enough.",
  },
  rad_shield: {
    name: "Radiation Shielding",
    glyph: "☢",
    effect: "Immune to solar flares. Ignores the Irradiated body rule.",
    flavour: "Let the star rage.",
    note: "Deinococcus radiodurans survives thousands of times the radiation that kills a human, repairing its shattered DNA within hours.",
  },
  rapid_fruiting: {
    name: "Rapid Fruiting",
    glyph: "⚘",
    effect: `Fruiting bodies mature ${n.rapidFruitingTurns} turn faster (minimum 1).`,
    flavour: "Ready before the window closes.",
    note: "Myxobacteria aggregate into fruiting bodies within hours when food runs out, packing spores for dispersal.",
  },
  regeneration: {
    name: "Regeneration",
    glyph: "✚",
    effect: `On even turns, connected cells below biomass ${n.regenerationBelow} gain ${signed(n.regenerationAmount)}.`,
    flavour: "Every wound closes.",
    note: "Biofilms regrow quickly after damage because surviving cells are fed through shared channels in the matrix.",
  },
  thick_veins: {
    name: "Thick Veins",
    glyph: "≋",
    effect: `Cells adjacent to an own core get ${signed(n.thickVeinsDefense)} defense.`,
    flavour: "Guard the heart.",
    note: "Fungal mycelia thicken the cords nearest their food sources into rhizomorphs, armoured transport cables.",
  },
};

export function mutationInfo(id: MutationId): MutationInfo {
  return { id, ...INFO[id] };
}

export const ALL_MUTATIONS: readonly MutationInfo[] = MUTATION_IDS.map(mutationInfo);
