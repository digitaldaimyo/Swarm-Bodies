import { describe, expect, it } from "vitest";
import {
  BASE_RULES,
  entryCost,
  incomeFor,
  inLaunchRange,
  MUTATION_IDS,
  mutationsOf,
  playerRules,
  resolveTurn,
  validateOrder,
  validateOrderSet,
  type GameEvent,
  type GameState,
  type MutationId,
  type Order,
} from "./sim";
import { cellAt, grow, reinforce, scenario, type CellSpec } from "./helpers";
import { systemScenario } from "../src/testing";

const ofType = <T extends GameEvent["type"]>(events: GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

const P1_CORE: CellSpec = { q: -8, r: 0, owner: 1, biomass: 5, core: true };
const P0_CORE: CellSpec = { q: 0, r: 0, owner: 0, biomass: 5, core: true };

/** P0 assaults a lone enemy cell at (2,0) from a biomass-3 feeder: attack 3 vs defense 3. */
const assault = (opts: { strain?: "predator"; mutations?: MutationId[] } = {}) =>
  scenario({
    cells: [
      P0_CORE,
      { q: 1, r: 0, owner: 0, biomass: 3 },
      { q: 2, r: 0, owner: 1, biomass: 3 },
      P1_CORE,
    ],
    strains: [opts.strain ?? "base", "base"],
    mutations: [opts.mutations ?? [], []],
  });
const ASSAULT = grow([1, 0], [2, 0]);

describe("SPEC §7.1 Predator", () => {
  it("adds +1 attack on assaults and feeds on captures", () => {
    const base = resolveTurn(assault(), { 0: [ASSAULT] });
    expect(ofType(base.events, "AssaultRepelled")).toHaveLength(1);

    const s = assault({ strain: "predator" });
    const { state, events } = resolveTurn(s, { 0: [ASSAULT] });
    expect(ofType(events, "CellCaptured")[0]).toMatchObject({ attack: 4, defense: 3, biomass: 1 });
    // The defender lost its whole cell: 3 biomass, paid as 3 N.
    expect(ofType(events, "CaptureFed")).toEqual([
      { type: "CaptureFed", player: 0, cell: { body: 0, q: 2, r: 0 }, amount: 3 },
    ]);
    const income = ofType(events, "Income").find((e) => e.player === 0)!.amount;
    expect(state.players[0]!.nutrients).toBe(50 - 2 + 3 + income);
  });

  it("does not add the assault bonus when claiming empty cells", () => {
    const s = scenario({
      cells: [P0_CORE, { q: 1, r: 0, owner: 0, biomass: 3 }, P1_CORE],
      strains: ["predator", "base"],
    });
    const { events } = resolveTurn(s, { 0: [ASSAULT] });
    expect(ofType(events, "CellClaimed")[0]).toMatchObject({ attack: 3 });
  });

  it("has deposit yields −1, never below 1", () => {
    const s = scenario({ cells: [P0_CORE, P1_CORE], strains: ["predator", "base"] });
    expect(playerRules(s, 0).depositYield).toEqual({ ice: 1, organic: 2, mineral: 1 });
    expect(playerRules(s, 1).depositYield).toEqual(BASE_RULES.depositYield);
  });
});

/** A at (3,0), B at (9,0) six units away, C at (−5,0) eight units from A. */
const sporerSystem = (strains: ("base" | "sporer")[], cellsA: CellSpec[] = []) =>
  systemScenario({
    bodies: [
      {
        orbit: { radius: 3, period: 360, phase: 0 },
        cells: [{ q: 0, r: 0, owner: 0, biomass: 5, core: true }, ...cellsA],
      },
      {
        orbit: { radius: 9, period: 360, phase: 0 },
        cells: [{ q: 0, r: 0, owner: 1, biomass: 5, core: true }],
      },
      { orbit: { radius: 5, period: 360, phase: 180 } },
    ],
    strains,
  });

describe("SPEC §7.1 Sporer", () => {
  it("fruits for 6 N, matures in 1 turn, and may hold 3 fruiting bodies", () => {
    const cells: CellSpec[] = [1, 2, 3, 4].map((q) => ({ q: q - 2, r: 1, owner: 0, biomass: 6 }));
    const s = sporerSystem(["sporer", "base"], [{ q: 1, r: 0, owner: 0, biomass: 6 }, ...cells]);
    expect(playerRules(s, 0)).toMatchObject({
      fruitCost: 6,
      fruitMatureTurns: 1,
      maxFruiting: 3,
      landingBiomass: 2,
    });
    const f = (q: number, r: number): Order => ({ type: "fruit", body: 0, cell: { q, r } });
    expect(validateOrder(s, 0, f(1, 0), [])).toEqual({ ok: true, cost: 6 });
    const three = [f(1, 0), f(-1, 1), f(0, 1)];
    expect(validateOrderSet(s, 0, three)).toEqual({ ok: true, cost: 18 });
    expect(validateOrder(s, 0, f(1, 1), three)).toMatchObject({ reason: "tooManyFruiting" });
    const { state } = resolveTurn(s, { 0: [f(1, 0)] });
    // Started at 1 in phase 4, advanced in phase 11: ready to launch next turn.
    expect(state.bodies[0]!.colony.find((c) => c && c.fruiting !== null)).toMatchObject({
      fruiting: 0,
    });
  });

  it("launches 2 units further and lands with biomass 2", () => {
    const base = sporerSystem(["base", "base"]);
    const sporer = sporerSystem(
      ["sporer", "base"],
      [{ q: 1, r: 0, owner: 0, biomass: 1, fruiting: 0 }],
    );
    const [a, , c] = sporer.bodies;
    expect(inLaunchRange(base, a!, c!, 0, 0)).toBe(false);
    expect(inLaunchRange(sporer, a!, c!, 0, 0)).toBe(true);
    const { state, events } = resolveTurn(sporer, {
      0: [
        {
          type: "launch",
          body: 0,
          cell: { q: 1, r: 0 },
          targetBody: 2,
          targetCell: { q: 0, r: 0 },
        },
      ],
    });
    expect(state.spores[0]).toMatchObject({ landing: 2 });
    expect(ofType(events, "SporeLaunched")).toHaveLength(1);
  });
});

describe("SPEC §7.3 mutations", () => {
  it("are applied in mutation-ID order whatever order they were drafted in", () => {
    const s = scenario({
      cells: [P0_CORE, P1_CORE],
      mutations: [["thick_veins", "acid_tendrils", "quorum"], []],
    });
    expect(mutationsOf(s, 0).map((m) => m.id)).toEqual(["acid_tendrils", "quorum", "thick_veins"]);
    expect(playerRules(s, 0).mutations).toEqual(["thick_veins", "acid_tendrils", "quorum"]);
  });

  it("acid_tendrils: +2 attack on assaults", () => {
    const { events } = resolveTurn(assault({ mutations: ["acid_tendrils"] }), { 0: [ASSAULT] });
    expect(ofType(events, "CellCaptured")[0]).toMatchObject({ attack: 5, biomass: 2 });
  });

  it("acid_tendrils stacks with Predator", () => {
    const s = assault({ strain: "predator", mutations: ["acid_tendrils"] });
    expect(ofType(resolveTurn(s, { 0: [ASSAULT] }).events, "CellCaptured")[0]).toMatchObject({
      attack: 6,
    });
  });

  it("chemotaxis: deposits cost 1 N less, and paths ending on one reach 1 further", () => {
    const spec = (mutations: MutationId[]) =>
      scenario({
        cells: [P0_CORE, P1_CORE],
        deposits: [
          { q: 4, r: 0, kind: "organic" },
          { q: 0, r: 4, kind: "mineral" },
        ],
        mutations: [mutations, []],
      });
    const plain = spec([]);
    const chemo = spec(["chemotaxis"]);
    const body = (s: GameState) => s.bodies[0]!;
    const at = (s: GameState, q: number, r: number) => body(s).colony.length && getIndex(s, q, r);
    expect(entryCost(plain, body(plain), at(plain, 4, 0), 0)).toBe(2);
    expect(entryCost(chemo, body(chemo), at(chemo, 4, 0), 0)).toBe(1);
    expect(entryCost(chemo, body(chemo), at(chemo, 0, 4), 0)).toBe(2); // mineral +1, −1
    const toDeposit = grow([0, 0], [1, 0], [2, 0], [3, 0], [4, 0]);
    const toEmpty = grow([0, 0], [-1, 0], [-2, 0], [-3, 0], [-4, 0]);
    expect(validateOrder(plain, 0, toDeposit, [])).toMatchObject({ reason: "pathTooLong" });
    expect(validateOrder(chemo, 0, toDeposit, [])).toEqual({ ok: true, cost: 7 });
    expect(validateOrder(chemo, 0, toEmpty, [])).toMatchObject({ reason: "pathTooLong" });
  });

  it("cryophile and lithotroph raise yields; lithotroph drops the mineral surcharge", () => {
    const s = scenario({
      cells: [P0_CORE, P1_CORE],
      deposits: [{ q: 1, r: 0, kind: "mineral" }],
      mutations: [["cryophile", "lithotroph"], []],
    });
    expect(playerRules(s, 0).depositYield).toEqual({ ice: 4, organic: 3, mineral: 3 });
    expect(entryCost(s, s.bodies[0]!, getIndex(s, 1, 0), 0)).toBe(2);
    expect(entryCost(s, s.bodies[0]!, getIndex(s, 1, 0), 1)).toBe(3);
  });

  it("deep_reserves: +1 N per core, and 10% interest capped at 3", () => {
    const s = (n: number) =>
      scenario({
        cells: [P0_CORE, P1_CORE],
        nutrients: [n, 0],
        mutations: [["deep_reserves"], []],
      });
    expect(incomeFor(s(50), 0)).toBe(2 + 1 + 3);
    expect(incomeFor(s(25), 0)).toBe(2 + 1 + 2);
    expect(incomeFor(s(9), 0)).toBe(3);
    expect(incomeFor(s(50), 1)).toBe(2);
  });

  it("dormancy: cut-off cells skip starvation for 3 turns", () => {
    let s = scenario({
      cells: [P0_CORE, { q: 5, r: 0, owner: 0, biomass: 2 }, P1_CORE],
      mutations: [["dormancy"], []],
    });
    const seen: string[] = [];
    for (let t = 0; t < 4; t++) {
      const r = resolveTurn(s, {});
      seen.push(
        ofType(r.events, "Dormant").length > 0
          ? "dormant"
          : ofType(r.events, "Starved").length > 0
            ? "starved"
            : "-",
      );
      s = r.state;
    }
    expect(seen).toEqual(["dormant", "dormant", "dormant", "starved"]);
    expect(cellAt(s, 5, 0)).toMatchObject({ biomass: 1, cut: 4 });
  });

  it("dormancy: reconnecting resets the count", () => {
    const s = scenario({
      cells: [P0_CORE, { q: 1, r: 0, owner: 0, biomass: 2, cut: 3 }, P1_CORE],
      mutations: [["dormancy"], []],
    });
    expect(cellAt(resolveTurn(s, {}).state, 1, 0)).toMatchObject({ biomass: 2, cut: 0 });
  });

  it("hardened_spores: landing biomass +2; rapid_fruiting: 1 turn faster, minimum 1", () => {
    const s = sporerSystem(["base", "sporer"]);
    s.players[0]!.mutations = ["hardened_spores", "rapid_fruiting"];
    s.players[1]!.mutations = ["rapid_fruiting"];
    expect(playerRules(s, 0)).toMatchObject({ landingBiomass: 5, fruitMatureTurns: 1 });
    expect(playerRules(s, 1)).toMatchObject({ landingBiomass: 2, fruitMatureTurns: 1 });
  });

  it("quorum: +1 attack from a crowded feeder, +1 defense on a crowded cell", () => {
    // Feeder (1,0) touches (0,0), (1,-1) and (0,1): three own neighbours.
    const s = scenario({
      cells: [
        P0_CORE,
        { q: 1, r: 0, owner: 0, biomass: 3 },
        { q: 1, r: -1, owner: 0, biomass: 1 },
        { q: 0, r: 1, owner: 0, biomass: 1 },
        { q: 2, r: 0, owner: 1, biomass: 4 },
        P1_CORE,
      ],
      mutations: [["quorum"], []],
    });
    // Attack: 3 + 2 adjacent own cells ((1,-1) touches (2,-1)? no — (2,0)'s neighbours are
    // (3,0),(3,−1),(2,−1),(1,0),(1,1),(2,1)) → 3 + 0 + quorum 1 = 4 vs defense 4: repelled.
    const r = resolveTurn(s, { 0: [ASSAULT] });
    expect(ofType(r.events, "AssaultRepelled")[0]).toMatchObject({ attack: 4, defense: 4 });
    // Defense: a quorum cell defends at +1.
    const d = scenario({
      cells: [
        { q: 0, r: 0, owner: 1, biomass: 2 },
        { q: 1, r: -1, owner: 1, biomass: 1 },
        { q: -1, r: 0, owner: 1, biomass: 1 },
        { q: -1, r: 1, owner: 1, biomass: 5, core: true },
        { q: 1, r: 0, owner: 0, biomass: 9 },
        { q: 2, r: 0, owner: 0, biomass: 5, core: true },
      ],
      mutations: [[], ["quorum"]],
    });
    const rd = resolveTurn(d, { 0: [grow([1, 0], [0, 0])] });
    // 2 + 3 connected neighbours + quorum 1 = 6.
    expect(ofType(rd.events, "CellCaptured")[0]).toMatchObject({ defense: 6 });
  });

  it("rad_shield: immune to flares and the Irradiated rule", () => {
    const sys = (mutations: MutationId[]) =>
      systemScenario({
        bodies: [
          {
            orbit: { radius: 4, period: 360, phase: 0 },
            type: "irradiated",
            cells: [
              { q: 0, r: 0, owner: 0, biomass: 5, core: true },
              { q: -1, r: 0, owner: 0, biomass: 4 },
              { q: 1, r: 0, owner: 0, biomass: 2 },
              // East side, away from the star: only the Irradiated rule touches it.
              { q: 2, r: 0, owner: 0, biomass: 1 },
            ],
          },
          {
            orbit: { radius: 9, period: 360, phase: 90 },
            cells: [{ q: 0, r: 0, owner: 1, biomass: 5, core: true }],
          },
        ],
        schedule: [{ kind: "flare", turn: 0 }],
        mutations: [mutations, []],
      });
    const plain = resolveTurn(sys([]), {});
    expect(ofType(plain.events, "FlareStruck").length).toBeGreaterThan(0);
    expect(ofType(plain.events, "Irradiated").length).toBeGreaterThan(0);
    const shielded = resolveTurn(sys(["rad_shield"]), {});
    expect(ofType(shielded.events, "FlareStruck").filter((e) => e.player === 0)).toEqual([]);
    expect(ofType(shielded.events, "Irradiated")).toEqual([]);
  });

  it("regeneration: on even turns, connected cells below 3 gain 1", () => {
    const s = (turn: number) =>
      scenario({
        cells: [
          P0_CORE,
          { q: 1, r: 0, owner: 0, biomass: 1 },
          { q: 2, r: 0, owner: 0, biomass: 3 },
          P1_CORE,
        ],
        mutations: [["regeneration"], []],
        turn,
      });
    const even = resolveTurn(s(2), {});
    expect(cellAt(even.state, 1, 0)).toMatchObject({ biomass: 2 });
    expect(cellAt(even.state, 2, 0)).toMatchObject({ biomass: 3 });
    expect(ofType(even.events, "Regenerated")).toHaveLength(1);
    expect(cellAt(resolveTurn(s(3), {}).state, 1, 0)).toMatchObject({ biomass: 1 });
  });

  it("thick_veins: cells next to an own core defend at +2", () => {
    const s = scenario({
      cells: [
        { q: 0, r: 0, owner: 1, biomass: 1 },
        { q: -1, r: 0, owner: 1, biomass: 5, core: true },
        { q: 1, r: 0, owner: 0, biomass: 9 },
        { q: 2, r: 0, owner: 0, biomass: 5, core: true },
      ],
      mutations: [[], ["thick_veins"]],
    });
    const { events } = resolveTurn(s, { 0: [grow([1, 0], [0, 0])] });
    // 1 + 1 supporting core + 2.
    expect(ofType(events, "CellCaptured")[0]).toMatchObject({ defense: 4 });
  });

  it("every mutation in the pool has a definition", () => {
    expect(MUTATION_IDS).toHaveLength(12);
    expect([...MUTATION_IDS].sort()).toEqual(MUTATION_IDS);
  });
});

/** P0 with 48 biomass: a core at 12 and four cells at 9. */
const rich = (extra: Partial<Parameters<typeof scenario>[0]> = {}) =>
  scenario({
    cells: [
      { q: 0, r: 0, owner: 0, biomass: 12, core: true },
      ...[
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].map(([q, r]) => ({ q: q!, r: r!, owner: 0, biomass: 9 })),
      { q: 2, r: 0, owner: 0, biomass: 1 },
      { q: 3, r: 0, owner: 0, biomass: 3 },
      { q: 4, r: 0, owner: 1, biomass: 3 },
      P1_CORE,
    ],
    ...extra,
  });

describe("SPEC §7.2 drafts", () => {
  it("offers 3 mutations when total biomass first reaches 40, deterministically", () => {
    const { state, events } = resolveTurn(rich(), {});
    const offer = ofType(events, "DraftOffered");
    expect(offer).toHaveLength(1);
    expect(offer[0]).toMatchObject({ player: 0, index: 0 });
    expect(offer[0]!.options).toHaveLength(3);
    expect(new Set(offer[0]!.options).size).toBe(3);
    expect(state.players[0]).toMatchObject({ draftsOffered: 1, draft: { index: 0 } });
    expect(resolveTurn(rich(), {}).state.players[0]!.draft).toEqual(state.players[0]!.draft);
    expect(state.players[1]!.draft).toBeNull();
  });

  it("never offers mutations the player already owns", () => {
    const owned: MutationId[] = MUTATION_IDS.slice(0, 10);
    const { events } = resolveTurn(rich({ mutations: [owned, []] }), {});
    expect([...ofType(events, "DraftOffered")[0]!.options].sort()).toEqual(MUTATION_IDS.slice(10));
  });

  it("applies a pick at the start of the next resolution, in time for that turn's orders", () => {
    const offered = resolveTurn(
      rich({ rules: { mutationPool: ["acid_tendrils", "quorum", "dormancy"] } }),
      {},
    );
    const s = offered.state;
    const pick: Order = { type: "draft", mutation: "acid_tendrils" };
    const attack = grow([3, 0], [4, 0]);
    // Without the pick, 3 vs 3 would be repelled; with Acid Tendrils (picked first) it captures.
    expect(validateOrderSet(s, 0, [pick, attack])).toMatchObject({ ok: true });
    const r = resolveTurn(s, { 0: [pick, attack] });
    expect(ofType(r.events, "DraftPicked")).toEqual([
      { type: "DraftPicked", player: 0, mutation: "acid_tendrils", auto: false },
    ]);
    expect(ofType(r.events, "CellCaptured")[0]).toMatchObject({ attack: 5 });
    expect(r.state.players[0]).toMatchObject({ mutations: ["acid_tendrils"], draft: null });
  });

  it("assigns the first option when the player does not pick", () => {
    const s = resolveTurn(rich(), {}).state;
    const first = s.players[0]!.draft!.options[0]!;
    const r = resolveTurn(s, { 0: [reinforce(3, 0)] });
    expect(ofType(r.events, "DraftPicked")).toEqual([
      { type: "DraftPicked", player: 0, mutation: first, auto: true },
    ]);
    expect(r.state.players[0]!.mutations).toEqual([first]);
  });

  it("validates draft orders: pending, offered, and first", () => {
    const s = resolveTurn(rich(), {}).state;
    const [a, ,] = s.players[0]!.draft!.options;
    const missing = MUTATION_IDS.find((m) => !s.players[0]!.draft!.options.includes(m))!;
    expect(validateOrder(s, 0, { type: "draft", mutation: missing }, [])).toMatchObject({
      reason: "notOffered",
    });
    expect(validateOrder(s, 0, { type: "draft", mutation: a! }, [reinforce(3, 0)])).toMatchObject({
      reason: "draftNotFirst",
    });
    expect(validateOrder(s, 1, { type: "draft", mutation: a! }, [])).toMatchObject({
      reason: "noDraft",
    });
    // A rejected draft order still leaves the draft to be assigned.
    const r = resolveTurn(s, { 0: [reinforce(3, 0), { type: "draft", mutation: a! }] });
    expect(ofType(r.events, "OrderRejected")[0]).toMatchObject({ reason: "noDraft" });
    expect(ofType(r.events, "DraftPicked")[0]).toMatchObject({ auto: true });
  });

  it("offers at most one draft per threshold and one at a time", () => {
    // 200 biomass crosses all three thresholds at once: one offer now, the next after the pick.
    const big = rich({ rules: { draftThresholds: [40, 41, 42] } });
    let s = resolveTurn(big, {}).state;
    expect(s.players[0]).toMatchObject({ draftsOffered: 1 });
    s = resolveTurn(s, {}).state;
    expect(s.players[0]).toMatchObject({ draftsOffered: 2, mutations: [expect.any(String)] });
    s = resolveTurn(s, {}).state;
    s = resolveTurn(s, {}).state;
    expect(s.players[0]!.mutations).toHaveLength(3);
    expect(s.players[0]).toMatchObject({ draftsOffered: 3, draft: null });
    s = resolveTurn(s, {}).state;
    expect(s.players[0]!.mutations).toHaveLength(3);
  });
});

function getIndex(s: GameState, q: number, r: number): number {
  const body = s.bodies[0]!;
  const R = body.radius;
  let i = 0;
  for (let rr = -R; rr <= R; rr++)
    for (let qq = -R; qq <= R; qq++) {
      if ((Math.abs(qq) + Math.abs(rr) + Math.abs(qq + rr)) / 2 > R) continue;
      if (qq === q && rr === r) return i;
      i++;
    }
  return -1;
}
