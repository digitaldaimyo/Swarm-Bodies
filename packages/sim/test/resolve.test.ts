import { describe, expect, it } from "vitest";
import { hashState, resolveTurn, type GameEvent, type GameState, type OrderSet } from "./sim";
import { cellAt, deepFreeze, grow, reinforce, retract, scenario, type CellSpec } from "./helpers";

const P1_CORE: CellSpec = { q: -8, r: 0, owner: 1, biomass: 5, core: true };
const P0_CORE: CellSpec = { q: 8, r: 0, owner: 0, biomass: 5, core: true };

function run(state: GameState, orders: Record<number, OrderSet>) {
  return resolveTurn(state, orders);
}
const ofType = <T extends GameEvent["type"]>(events: GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

describe("SPEC §5.3 phase 2: pay and validate", () => {
  it("drops invalid orders with OrderRejected and only charges accepted ones", () => {
    const s = scenario({
      cells: [{ q: 0, r: 0, owner: 0, biomass: 5, core: true }, P1_CORE],
      nutrients: [10, 10],
    });
    const { state, events } = run(s, {
      0: [grow([0, 0], [1, 0]), reinforce(4, 4), grow([0, 0], [0, 1])],
    });
    expect(ofType(events, "OrderRejected").map((e) => [e.index, e.reason])).toEqual([
      [1, "notOwn"],
      [2, "duplicateGrowStart"],
    ]);
    expect(ofType(events, "OrdersPaid")).toEqual([
      { type: "OrdersPaid", player: 0, cost: 2, nutrients: 8 },
    ]);
    expect(state.players[0]!.nutrients).toBe(8 + 2); // + income from one core
  });

  it("treats a missing or non-array order set as a pass", () => {
    const s = scenario({ cells: [{ q: 0, r: 0, owner: 0, biomass: 5, core: true }, P1_CORE] });
    const a = run(s, {});
    const b = run(s, { 0: "nonsense" as unknown as OrderSet, 1: [] });
    expect(hashState(a.state)).toBe(hashState(b.state));
  });
});

describe("SPEC §5.3 phases 3–4: retract and reinforce", () => {
  it("retract removes the cell and refunds +1 N", () => {
    const s = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        { q: 1, r: 0, owner: 0, biomass: 4 },
        P1_CORE,
      ],
      nutrients: [0, 0],
    });
    const { state, events } = run(s, { 0: [retract(1, 0)] });
    expect(cellAt(state, 1, 0)).toBeNull();
    expect(ofType(events, "Retracted")[0]).toMatchObject({ refund: 1 });
    expect(state.players[0]!.nutrients).toBe(0 + 1 + 2);
  });

  it("reinforce adds +3, capped at 9 for cells and 12 for cores", () => {
    const s = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 11, core: true },
        { q: 1, r: 0, owner: 0, biomass: 2 },
        { q: 2, r: 0, owner: 0, biomass: 8 },
        P1_CORE,
      ],
    });
    const { state } = run(s, { 0: [reinforce(0, 0), reinforce(1, 0), reinforce(2, 0)] });
    expect(cellAt(state, 0, 0)!.biomass).toBe(12);
    expect(cellAt(state, 1, 0)!.biomass).toBe(5);
    expect(cellAt(state, 2, 0)!.biomass).toBe(9);
  });

  it("reinforcement lands before growth, so it strengthens a feeder", () => {
    const s = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        { q: 1, r: 0, owner: 0, biomass: 2 },
        { q: 2, r: 0, owner: 1, biomass: 4 },
        P1_CORE,
      ],
    });
    // Unreinforced attack 2 vs defence 4 would fail; reinforced 5 vs 4 captures with biomass 1.
    const { state } = run(s, { 0: [reinforce(1, 0), grow([1, 0], [2, 0])] });
    expect(cellAt(state, 2, 0)).toMatchObject({ owner: 0, biomass: 1 });
  });
});

describe("SPEC §5.4 growth and contests", () => {
  it("claims empty cells one step at a time with biomass 1, feeding from the previous cell", () => {
    const s = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        { q: 1, r: 0, owner: 0, biomass: 2 },
        P1_CORE,
      ],
    });
    const { state, events } = run(s, { 0: [grow([1, 0], [2, 0], [3, 0], [4, 0])] });
    const claims = ofType(events, "CellClaimed");
    expect(claims.map((e) => [e.step, e.cell.q, e.attack, e.biomass])).toEqual([
      [1, 2, 2, 1],
      [2, 3, 1, 1],
      [3, 4, 1, 1],
    ]);
    expect(ofType(events, "GrowthStep").map((e) => e.step)).toEqual([1, 2, 3]);
    expect(cellAt(state, 4, 0)).toMatchObject({ owner: 0, biomass: 1, connected: true });
    expect(state.players[0]!.nutrients).toBe(50 - 6 + 2);
  });

  it("adds +1 attack per other attacker cell adjacent to the target", () => {
    const s = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        { q: 1, r: 0, owner: 0, biomass: 2 },
        { q: 1, r: -1, owner: 0, biomass: 1 },
        { q: 1, r: 1, owner: 0, biomass: 1 },
        P1_CORE,
      ],
    });
    const { events } = run(s, { 0: [grow([1, 0], [2, 0])] });
    // Feeder (1,0) has biomass 2. Of the other P0 cells only (1,1) touches (2,0); (1,-1) does not.
    expect(ofType(events, "CellClaimed")[0]).toMatchObject({ attack: 3 });
  });

  it("several claimants on an empty cell: highest attack wins, losers halt", () => {
    const s = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        { q: 1, r: 0, owner: 0, biomass: 2 },
        { q: 4, r: 0, owner: 1, biomass: 5, core: true },
        { q: 3, r: 0, owner: 1, biomass: 3 },
      ],
    });
    const { state, events } = run(s, {
      0: [grow([1, 0], [2, 0], [2, 1])],
      1: [grow([3, 0], [2, 0])],
    });
    expect(cellAt(state, 2, 0)).toMatchObject({ owner: 1, biomass: 1 });
    expect(cellAt(state, 2, 1)).toBeNull();
    expect(ofType(events, "PathHalted")).toMatchObject([{ player: 0, step: 1, reason: "lost" }]);
    expect(state.players[0]!.nutrients).toBe(50 - 4 + 2); // halted steps are not refunded
  });

  it("tied claimants on an empty cell stalemate: the cell stays empty and all halt", () => {
    const s = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        { q: 1, r: 0, owner: 0, biomass: 2 },
        { q: 4, r: 0, owner: 1, biomass: 5, core: true },
        { q: 3, r: 0, owner: 1, biomass: 2 },
      ],
    });
    const { state, events } = run(s, {
      0: [grow([1, 0], [2, 0], [2, 1])],
      1: [grow([3, 0], [2, 0])],
    });
    expect(cellAt(state, 2, 0)).toBeNull();
    expect(cellAt(state, 2, 1)).toBeNull();
    expect(ofType(events, "CellStalemate")).toMatchObject([
      { players: [0, 1], step: 1, attack: 2 },
    ]);
    expect(ofType(events, "PathHalted").map((e) => e.reason)).toEqual(["stalemate", "stalemate"]);
  });

  it("assault: attack > defense flips the cell with biomass attack − defense", () => {
    const s = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        { q: 1, r: 0, owner: 0, biomass: 9 },
        { q: 2, r: -1, owner: 0, biomass: 1 },
        { q: 2, r: 0, owner: 1, biomass: 2 },
        { q: 3, r: 0, owner: 1, biomass: 2 },
        { q: 4, r: 0, owner: 1, biomass: 5, core: true },
      ],
    });
    const { state, events } = run(s, { 0: [grow([1, 0], [2, 0])] });
    // attack 9 + 1 (2,-1) = 10; defense 2 + 1 connected neighbour (3,0) = 3.
    expect(ofType(events, "CellCaptured")[0]).toMatchObject({
      attack: 10,
      defense: 3,
      biomass: 7,
      from: 1,
    });
    expect(cellAt(state, 2, 0)).toMatchObject({ owner: 0, biomass: 7 });
  });

  it("defender support only counts the owner's connected cells", () => {
    const cells = (supportConnected: boolean): CellSpec[] => [
      { q: 0, r: 0, owner: 0, biomass: 5, core: true },
      { q: 1, r: 0, owner: 0, biomass: 3 },
      { q: 2, r: 0, owner: 1, biomass: 2 },
      { q: 3, r: 0, owner: 1, biomass: 2 },
      supportConnected ? { q: 4, r: 0, owner: 1, biomass: 5, core: true } : P1_CORE,
    ];
    const cut = run(scenario({ cells: cells(false) }), { 0: [grow([1, 0], [2, 0])] });
    expect(ofType(cut.events, "CellCaptured")[0]).toMatchObject({
      attack: 3,
      defense: 2,
      biomass: 1,
    });
    const linked = run(scenario({ cells: cells(true) }), { 0: [grow([1, 0], [2, 0])] });
    expect(ofType(linked.events, "AssaultRepelled")[0]).toMatchObject({ attack: 3, defense: 3 });
  });

  it("captured biomass is capped at the max", () => {
    const s = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        { q: 1, r: 0, owner: 0, biomass: 9 },
        ...[
          [3, 0],
          [3, -1],
          [2, -1],
          [1, 1],
          [2, 1],
        ].map(([q, r]) => ({ q: q!, r: r!, owner: 0, biomass: 1 })),
        { q: 2, r: 0, owner: 1, biomass: 1 },
        P1_CORE,
      ],
    });
    const { events } = run(s, { 0: [grow([1, 0], [2, 0])] });
    expect(ofType(events, "CellCaptured")[0]).toMatchObject({ attack: 14, defense: 1, biomass: 9 });
  });

  it("attack ≤ defense: defender loses floor(attack/2), keeping at least 1, and the path halts", () => {
    const s = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        { q: 1, r: 0, owner: 0, biomass: 9 },
        { q: 2, r: 0, owner: 1, biomass: 12, core: true },
      ],
    });
    const { state, events } = run(s, { 0: [grow([1, 0], [2, 0], [3, 0])] });
    expect(cellAt(state, 2, 0)).toMatchObject({ owner: 1, biomass: 8, core: true });
    expect(cellAt(state, 3, 0)).toBeNull();
    expect(ofType(events, "PathHalted")).toMatchObject([{ reason: "repelled" }]);

    const floor = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        { q: 1, r: 0, owner: 0, biomass: 9 },
        { q: 2, r: 0, owner: 1, biomass: 1 },
        { q: 3, r: 0, owner: 1, biomass: 5, core: true },
      ],
      rules: { defenseSupport: 10 },
    });
    expect(cellAt(run(floor, { 0: [grow([1, 0], [2, 0])] }).state, 2, 0)).toMatchObject({
      owner: 1,
      biomass: 1,
    });
  });

  it("capturing a core destroys it; a player with no cores is eliminated and the other wins", () => {
    const s = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        { q: 1, r: 0, owner: 0, biomass: 9 },
        { q: 2, r: 0, owner: 1, biomass: 5, core: true },
        { q: 3, r: 0, owner: 1, biomass: 3 },
      ],
    });
    const { state, events } = run(s, { 0: [grow([1, 0], [2, 0])] });
    expect(ofType(events, "CoreDestroyed")).toMatchObject([{ player: 1, by: 0 }]);
    expect(cellAt(state, 2, 0)).toMatchObject({ owner: 0, core: false });
    expect(state.players[1]).toMatchObject({ eliminated: true, eliminatedOnTurn: 1 });
    expect(state.result).toEqual({ winner: 0, reason: "lastStanding", turn: 1 });
    // The eliminated player's leftover cell is disconnected and starves.
    expect(cellAt(state, 3, 0)).toMatchObject({ owner: 1, biomass: 2, connected: false });
  });

  it("several attackers on one enemy cell: only the strongest is compared; ties capture nothing", () => {
    // A third player is added by hand: Single Rock itself is a two-player mode.
    const three = (p2Feeder: number): GameState => {
      const s = scenario({
        cells: [
          { q: 0, r: 0, owner: 0, biomass: 3 },
          { q: -5, r: -3, owner: 0, biomass: 5, core: true },
          { q: 1, r: 0, owner: 1, biomass: 6 },
          { q: 2, r: 0, owner: 1, biomass: 5, core: true },
          { q: -1, r: 0, owner: 2, biomass: p2Feeder },
          { q: -2, r: 0, owner: 2, biomass: 5, core: true },
        ],
      });
      const p2 = { ...s.players[1]!, id: 2, home: { body: 0, cell: { q: -2, r: 0 } } };
      return { ...s, players: [...s.players, p2] };
    };
    const orders = { 1: [grow([1, 0], [0, 0])], 2: [grow([-1, 0], [0, 0])] };
    const won = run(three(5), orders);
    expect(cellAt(won.state, 0, 0)).toMatchObject({ owner: 1, biomass: 3 });
    expect(ofType(won.events, "PathHalted")).toMatchObject([{ player: 2, reason: "lost" }]);
    const tied = run(three(6), orders);
    expect(cellAt(tied.state, 0, 0)).toMatchObject({ owner: 0, biomass: 2 }); // untouched, then starves
    expect(ofType(tied.events, "CellStalemate")).toMatchObject([{ players: [1, 2], attack: 6 }]);
  });

  it("pressure uses the board at the start of each step: simultaneous claims all see the same board", () => {
    const s = scenario({
      cells: [
        { q: 1, r: 0, owner: 0, biomass: 5, core: true },
        { q: 2, r: 0, owner: 0, biomass: 9 },
        { q: 3, r: 0, owner: 1, biomass: 2 },
        { q: 4, r: 0, owner: 1, biomass: 5, core: true },
      ],
    });
    // P0 captures (3,0) in step 1 while P1 grows out of it in the same step.
    const { state, events } = run(s, { 0: [grow([2, 0], [3, 0])], 1: [grow([3, 0], [3, 1])] });
    expect(cellAt(state, 3, 0)).toMatchObject({ owner: 0 });
    expect(ofType(events, "CellClaimed")).toMatchObject([
      { player: 1, attack: 3, cell: { q: 3, r: 1 } },
    ]);
  });

  it("a path halts when a cell it passes through is lost mid-turn", () => {
    const s = scenario({
      cells: [
        { q: 1, r: 0, owner: 0, biomass: 5, core: true },
        { q: 2, r: 0, owner: 0, biomass: 9 },
        { q: 4, r: -2, owner: 1, biomass: 5, core: true },
        { q: 3, r: -2, owner: 1, biomass: 3 },
        { q: 3, r: 0, owner: 1, biomass: 2 },
      ],
    });
    const { state, events } = run(s, {
      0: [grow([2, 0], [3, 0])],
      1: [grow([3, -2], [3, -1], [3, 0], [3, 1])],
    });
    expect(cellAt(state, 3, -1)).toMatchObject({ owner: 1 });
    expect(cellAt(state, 3, 1)).toBeNull();
    expect(ofType(events, "PathHalted")).toMatchObject([
      { player: 1, step: 2, reason: "brokenPath" },
    ]);
  });
});

describe("SPEC §5.3 phases 8–10: connectivity, starvation, income", () => {
  it("cells cut off from every core starve by 1 per turn and are removed at 0; cores never starve", () => {
    const s = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        { q: 1, r: 0, owner: 0, biomass: 1 },
        { q: 2, r: 0, owner: 0, biomass: 2 },
        { q: 3, r: 0, owner: 0, biomass: 1 },
        P1_CORE,
      ],
    });
    const { state, events } = run(s, { 0: [retract(1, 0)] });
    expect(cellAt(state, 2, 0)).toMatchObject({ biomass: 1, connected: false });
    expect(cellAt(state, 3, 0)).toBeNull();
    expect(cellAt(state, 0, 0)).toMatchObject({ biomass: 5, connected: true });
    expect(ofType(events, "Starved").map((e) => [e.cell.q, e.biomass])).toEqual([
      [2, 1],
      [3, 0],
    ]);
  });

  it("multiple cores on one body all anchor supply", () => {
    const s = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        { q: 1, r: 0, owner: 0, biomass: 1 },
        { q: 2, r: 0, owner: 0, biomass: 2 },
        { q: 3, r: 0, owner: 0, biomass: 5, core: true },
        P1_CORE,
      ],
    });
    const { state } = run(s, { 0: [retract(1, 0)] });
    expect(cellAt(state, 2, 0)).toMatchObject({ biomass: 2, connected: true });
  });

  it("income is 2 N per core plus the yield of every connected deposit cell", () => {
    const s = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        { q: 1, r: 0, owner: 0, biomass: 2 },
        { q: 0, r: 1, owner: 0, biomass: 2 },
        { q: 1, r: -1, owner: 0, biomass: 2 },
        { q: 5, r: 0, owner: 0, biomass: 2 },
        P1_CORE,
      ],
      deposits: [
        { q: 1, r: 0, kind: "organic" },
        { q: 0, r: 1, kind: "ice" },
        { q: 1, r: -1, kind: "mineral" },
        { q: 5, r: 0, kind: "organic" },
      ],
      nutrients: [0, 0],
    });
    const { state, events } = run(s, {});
    expect(ofType(events, "Income")).toMatchObject([
      { player: 0, amount: 2 + 3 + 2 + 1 },
      { player: 1, amount: 2 },
    ]);
    expect(state.players[0]!.nutrients).toBe(8);
  });
});

describe("SPEC §3 victory", () => {
  // Player 0 fills every cell within distance 7 of the centre: 169 of 271 cells (62%).
  const dominant = () => {
    const cells: CellSpec[] = [];
    for (let q = -7; q <= 7; q++)
      for (let r = -7; r <= 7; r++)
        if (Math.abs(q) + Math.abs(r) + Math.abs(q + r) <= 14)
          cells.push({ q, r, owner: 0, biomass: 2, core: q === 0 && r === 0 });
    cells.push({ q: -9, r: 0, owner: 1, biomass: 5, core: true });
    // These tests reason about the spec's 60% threshold (M6 ships 50%, DECISIONS).
    return scenario({ cells, rules: { dominanceWinPermille: 600 } });
  };

  it("dominance ≥ 60% at the end of 2 consecutive turns wins", () => {
    const t1 = run(dominant(), {});
    expect(t1.state.result).toBeNull();
    expect(t1.state.players[0]!.dominanceStreak).toBe(1);
    const t2 = run(t1.state, {});
    expect(t2.state.result).toEqual({ winner: 0, reason: "dominance", turn: 2 });
    expect(t2.state.turn).toBe(3);
  });

  it("dropping below the threshold resets the streak", () => {
    const t1 = run(dominant(), {});
    const s = t1.state;
    const body = s.bodies[0]!;
    // Retract 7 cells: 162/271 is below 60%.
    const ring = [
      [7, 0],
      [7, -1],
      [7, -2],
      [7, -3],
      [7, -4],
      [7, -5],
      [7, -6],
    ];
    const t2 = run(s, { 0: ring.map(([q, r]) => retract(q!, r!)) });
    expect(body.colony.length).toBe(271);
    expect(t2.state.players[0]!.dominanceStreak).toBe(0);
    expect(t2.state.result).toBeNull();
  });

  const atLimit = (p0: CellSpec[], p1: CellSpec[], nutrients: [number, number] = [50, 50]) =>
    scenario({ cells: [...p0, ...p1], rules: { turnLimit: 1 }, nutrients });

  it("at the turn limit the highest dominance wins", () => {
    const s = atLimit(
      [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        { q: 1, r: 0, owner: 0, biomass: 1 },
      ],
      [P1_CORE],
    );
    expect(run(s, {}).state.result).toEqual({ winner: 0, reason: "turnLimit", turn: 1 });
  });

  it("turn-limit ties break on total biomass, then nutrients, then draw", () => {
    const p0 = (b: number): CellSpec[] => [{ q: 0, r: 0, owner: 0, biomass: b, core: true }];
    expect(run(atLimit(p0(5), [{ ...P1_CORE, biomass: 6 }]), {}).state.result).toMatchObject({
      winner: 1,
    });
    expect(run(atLimit(p0(5), [P1_CORE], [11, 10]), {}).state.result).toMatchObject({ winner: 0 });
    expect(run(atLimit(p0(5), [P1_CORE], [10, 10]), {}).state.result).toEqual({
      winner: null,
      reason: "draw",
      turn: 1,
    });
  });

  it("if every player is eliminated in the same turn the game is a draw", () => {
    const s = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 12, core: true },
        { q: 1, r: -1, owner: 0, biomass: 1 },
        { q: 2, r: -1, owner: 0, biomass: 1 },
        { q: 1, r: 0, owner: 1, biomass: 12, core: true },
        { q: 0, r: 1, owner: 1, biomass: 1 },
        { q: -1, r: 1, owner: 1, biomass: 1 },
      ],
    });
    const { state } = run(s, { 0: [grow([0, 0], [1, 0])], 1: [grow([1, 0], [0, 0])] });
    expect(state.players.every((p) => p.eliminated)).toBe(true);
    expect(state.result).toEqual({ winner: null, reason: "draw", turn: 1 });
  });

  it("a finished game resolves to itself", () => {
    const s = {
      ...scenario({ cells: [P0_CORE, P1_CORE] }),
      result: { winner: 0, reason: "dominance" as const, turn: 3 },
    };
    const r = run(s, { 0: [] });
    expect(r.state).toBe(s);
    expect(r.events).toEqual([]);
  });
});

describe("SPEC §9.2 purity", () => {
  it("resolveTurn never mutates its input", () => {
    const s = scenario({
      cells: [
        { q: 0, r: 0, owner: 0, biomass: 5, core: true },
        { q: 1, r: 0, owner: 0, biomass: 9 },
        { q: 2, r: 0, owner: 1, biomass: 2 },
        { q: 3, r: 0, owner: 1, biomass: 5, core: true },
      ],
    });
    const before = hashState(s);
    const orders = deepFreeze({ 0: [grow([1, 0], [2, 0]), reinforce(0, 0)], 1: [reinforce(3, 0)] });
    expect(() => run(deepFreeze(s), orders)).not.toThrow();
    expect(hashState(s)).toBe(before);
  });
});
