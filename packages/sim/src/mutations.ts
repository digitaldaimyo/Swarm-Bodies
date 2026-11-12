import type { MutationId, MutationNumbers } from "./config";
import { getBoard } from "./hex";
import type { Body, Colony, GameState, PlayerId } from "./types";
import type { PlayerRules } from "./rules";

/**
 * The launch mutation pool (SPEC §7.3) as data plus hooks. The sim calls hooks in mutation-ID
 * order, so adding a mutation never touches the resolver: it declares the hooks it needs here.
 *
 * - `adjust` changes the player's static numbers (applied after the strain).
 * - `attack` / `defense` add pressure for one contest, given the board at that moment.
 * - `entryCost` / `reach` adjust Grow orders cell by cell.
 */
export interface CellContext {
  state: GameState;
  body: Body;
  /** The board the contest is judged on (the start of the growth step, or of the landing). */
  colony: readonly (Colony | null)[];
  player: PlayerId;
  cell: number;
}

export interface MutationDef {
  id: MutationId;
  adjust?(r: PlayerRules, n: MutationNumbers): void;
  /** Extra attack for `player` attacking from feeder cell `cell` (into some target). */
  attack?(ctx: CellContext): number;
  /** Extra defense for the owner of `cell`. */
  defense?(ctx: CellContext): number;
  /** Change to the entry cost of `cell` for `player`. */
  entryCost?(ctx: CellContext): number;
  /** Extra reach for a Grow path whose last cell is `cell`. */
  reach?(ctx: CellContext): number;
}

function ownNeighbours(ctx: CellContext): number {
  let n = 0;
  for (const j of getBoard(ctx.body.radius).neighbours[ctx.cell] as readonly number[])
    if (ctx.colony[j]?.owner === ctx.player) n++;
  return n;
}

const quorumBonus = (ctx: CellContext, amount: number): number =>
  ownNeighbours(ctx) >= ctx.state.rules.mutations.quorumNeighbours ? amount : 0;

export const MUTATIONS: Readonly<Record<MutationId, MutationDef>> = {
  acid_tendrils: {
    id: "acid_tendrils",
    adjust: (r, n) => (r.assaultBonus += n.acidAttack),
  },
  chemotaxis: {
    id: "chemotaxis",
    entryCost: (ctx) =>
      ctx.body.deposits[ctx.cell] ? ctx.state.rules.mutations.chemotaxisCostDelta : 0,
    reach: (ctx) => (ctx.body.deposits[ctx.cell] ? ctx.state.rules.mutations.chemotaxisReach : 0),
  },
  cryophile: {
    id: "cryophile",
    adjust: (r, n) => (r.depositYield.ice += n.cryophileIceBonus),
  },
  deep_reserves: {
    id: "deep_reserves",
    adjust: (r, n) => {
      r.incomePerCore += n.deepReservesPerCore;
      r.interestPermille += n.deepReservesInterestPermille;
      r.interestCap += n.deepReservesInterestCap;
    },
  },
  dormancy: {
    id: "dormancy",
    adjust: (r, n) => (r.dormancyTurns = Math.max(r.dormancyTurns, n.dormancyTurns)),
  },
  hardened_spores: {
    id: "hardened_spores",
    adjust: (r, n) => (r.landingBiomass += n.hardenedLandingBonus),
  },
  lithotroph: {
    id: "lithotroph",
    adjust: (r, n) => {
      r.mineralEntryExtra = 0;
      r.depositYield.mineral += n.lithotrophMineralBonus;
    },
  },
  quorum: {
    id: "quorum",
    attack: (ctx) => quorumBonus(ctx, ctx.state.rules.mutations.quorumAttack),
    defense: (ctx) => quorumBonus(ctx, ctx.state.rules.mutations.quorumDefense),
  },
  rad_shield: {
    id: "rad_shield",
    adjust: (r) => {
      r.flareImmune = true;
      r.irradiationImmune = true;
    },
  },
  rapid_fruiting: {
    id: "rapid_fruiting",
    adjust: (r, n) => (r.fruitMatureTurns = Math.max(1, r.fruitMatureTurns - n.rapidFruitingTurns)),
  },
  regeneration: {
    id: "regeneration",
    adjust: (r, n) =>
      (r.regeneration = { below: n.regenerationBelow, amount: n.regenerationAmount }),
  },
  thick_veins: {
    id: "thick_veins",
    defense: (ctx) => {
      for (const j of getBoard(ctx.body.radius).neighbours[ctx.cell] as readonly number[]) {
        const c = ctx.colony[j];
        if (c && c.owner === ctx.player && c.core)
          return ctx.state.rules.mutations.thickVeinsDefense;
      }
      return 0;
    },
  },
};

/** A player's mutations in hook order (sorted by ID, SPEC §7.3). */
export function mutationsOf(state: GameState, player: PlayerId): MutationDef[] {
  const owned = state.players.find((p) => p.id === player)?.mutations ?? [];
  return [...owned].sort().map((id) => MUTATIONS[id]);
}

/** Sums one hook over a player's mutations. */
export function hookSum(
  state: GameState,
  ctx: CellContext,
  hook: "attack" | "defense" | "entryCost" | "reach",
): number {
  let n = 0;
  for (const m of mutationsOf(state, ctx.player)) {
    const f = m[hook];
    if (f) n += f(ctx);
  }
  return n;
}
