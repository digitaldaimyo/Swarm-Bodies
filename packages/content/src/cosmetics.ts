/**
 * Cosmetics (SPEC §11.3): colony palettes (on top of the colourblind-safe defaults), vein
 * styles and spore trails. Rewards only: they never change gameplay. A palette recolours your
 * own colony on your own screen; everyone else still sees the standard seat colours.
 */
export type CosmeticKind = "palette" | "vein" | "trail";

export interface Cosmetic {
  id: string;
  kind: CosmeticKind;
  name: string;
  /** Palette: your colony colour. Trail: the spore colour. Vein: a thickness factor ×100. */
  value: number;
  source:
    | { kind: "default" }
    | { kind: "achievement"; id: string }
    | { kind: "season"; minGames: number };
}

export const COSMETICS: readonly Cosmetic[] = [
  { id: "default", kind: "palette", name: "Seat colour", value: 0, source: { kind: "default" } },
  { id: "default", kind: "vein", name: "Standard veins", value: 100, source: { kind: "default" } },
  { id: "default", kind: "trail", name: "Standard trail", value: 0, source: { kind: "default" } },
  {
    id: "ember",
    kind: "palette",
    name: "Ember",
    value: 0xff7a45,
    source: { kind: "achievement", id: "first_win" },
  },
  {
    id: "glacier",
    kind: "palette",
    name: "Glacier",
    value: 0x9fd8ff,
    source: { kind: "achievement", id: "three_bodies" },
  },
  {
    id: "toxin",
    kind: "palette",
    name: "Toxin",
    value: 0xc6ff3d,
    source: { kind: "achievement", id: "predator_feast" },
  },
  {
    id: "royal",
    kind: "palette",
    name: "Royal",
    value: 0xb48cff,
    source: { kind: "achievement", id: "beat_hard" },
  },
  {
    id: "thick",
    kind: "vein",
    name: "Thick veins",
    value: 135,
    source: { kind: "achievement", id: "stalemates_5" },
  },
  {
    id: "lace",
    kind: "vein",
    name: "Lace veins",
    value: 75,
    source: { kind: "achievement", id: "launches_10" },
  },
  {
    id: "golden",
    kind: "trail",
    name: "Golden trail",
    value: 0xffd27a,
    source: { kind: "achievement", id: "spore_core" },
  },
  {
    id: "season",
    kind: "trail",
    name: "Season trail",
    value: 0xff5cd6,
    source: { kind: "season", minGames: 5 },
  },
];

export function cosmetic(kind: CosmeticKind, id: string): Cosmetic {
  return (
    COSMETICS.find((c) => c.kind === kind && c.id === id) ??
    (COSMETICS.find((c) => c.kind === kind && c.id === "default") as Cosmetic)
  );
}
