import { describe, expect, it } from "vitest";
import { createGame, randomOrderSet, resolveTurn, type OrderSet, type PlayerId } from "@swarm/sim";
import {
  ACHIEVEMENTS,
  CAMPAIGN,
  CAMPAIGN_MUTATIONS,
  COSMETICS,
  MODIFIERS,
  SECTORS,
  dailyDate,
  dailyScore,
  dailySetup,
  earnedAchievements,
  earnedCosmetics,
  emptyProgress,
  isDailyDate,
  mergeProgress,
  nodeCompleted,
  nodeConfig,
  nodeOpen,
  seasonAt,
  sectorFor,
  strainUnlockNode,
  summarizeGame,
  unlockedMutations,
  unlockedStrains,
  type GameSummary,
} from "../src/index";

/** Plays a random-legal game and returns its turns. */
function randomGame(seed: string) {
  const config = { mode: "system", playerCount: 2 } as const;
  let s = createGame(config, seed);
  const turns: Record<PlayerId, OrderSet>[] = [];
  while (!s.result) {
    const orders = { 0: randomOrderSet(s, 0, "a"), 1: randomOrderSet(s, 1, "b") };
    turns.push(orders);
    s = resolveTurn(s, orders).state;
  }
  return { config, turns, final: s };
}

describe("SPEC §11.3 game summaries", () => {
  it("replays a game from its seed and orders and agrees with the result", () => {
    const { config, turns, final } = randomGame("summary-1");
    const s = summarizeGame(config, "summary-1", turns, 0, { mode: "skirmish" });
    expect(s.turns).toBe(final.result!.turn);
    expect(s.outcome).toBe(
      final.result!.winner === null ? "draw" : final.result!.winner === 0 ? "win" : "loss",
    );
    const launched = turns.flatMap((t) => t[0] ?? []).filter((o) => o.type === "launch").length;
    expect(s.launches).toBeLessThanOrEqual(launched);
    expect(s.maxBodiesHeld).toBeGreaterThanOrEqual(1);
    expect(s.bodiesTouched).toBeGreaterThanOrEqual(s.maxBodiesHeld);
    // Deterministic.
    expect(summarizeGame(config, "summary-1", turns, 0, { mode: "skirmish" })).toEqual(s);
  });
});

const base = (over: Partial<GameSummary>): GameSummary => ({
  player: 0,
  context: { mode: "skirmish" },
  map: "system",
  players: 2,
  strain: "swarmer",
  mutations: [],
  outcome: "win",
  reason: "dominance",
  turns: 25,
  finalDominance: 520,
  peakDominance: 520,
  lowestCellsAfterTurn3: 12,
  cellsClaimed: 100,
  captures: 3,
  coresDestroyed: 0,
  coresLost: 0,
  launches: 2,
  sporeNewCores: 2,
  sporeCoreCaptures: 0,
  stalemates: 0,
  reinforces: 4,
  retracts: 1,
  fruits: 2,
  maxBodiesHeld: 2,
  bodiesTouched: 2,
  starvedCells: 0,
  flareHits: 3,
  cometIncomeTurns: 0,
  nutrientsFromCaptures: 0,
  maxNutrients: 40,
  ordersIssued: 80,
  ...over,
});

describe("SPEC §11.3 achievements", () => {
  it("has about 30 achievements with unique ids", () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(28);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });

  it("evaluates predicates over summaries, including the spec's examples", () => {
    expect(earnedAchievements(base({}))).toEqual(
      expect.arrayContaining(["first_win", "dominance_win", "untouched", "swarmer_win"]),
    );
    expect(earnedAchievements(base({ launches: 0 }))).toContain("no_launch_win");
    expect(earnedAchievements(base({ bodiesTouched: 1, maxBodiesHeld: 1 }))).toContain(
      "single_asteroid",
    );
    expect(earnedAchievements(base({ outcome: "loss", sporeCoreCaptures: 1 }))).toContain(
      "spore_core",
    );
    expect(earnedAchievements(base({ stalemates: 5 }))).toContain("stalemates_5");
    expect(earnedAchievements(base({ context: { mode: "daily", dailyStreak: 7 } }))).toEqual(
      expect.arrayContaining(["daily_streak_7", "daily_first"]),
    );
    expect(earnedAchievements(base({ outcome: "loss" }))).not.toContain("first_win");
  });

  it("every achievement-sourced cosmetic names a real achievement", () => {
    for (const c of COSMETICS)
      if (c.source.kind === "achievement")
        expect(ACHIEVEMENTS.some((a) => a.id === (c.source as { id: string }).id)).toBe(true);
  });
});

describe("SPEC §11.1 campaign data", () => {
  it("has 12 nodes in a connected graph that branches", () => {
    expect(CAMPAIGN).toHaveLength(12);
    const ids = new Set(CAMPAIGN.map((n) => n.id));
    for (const n of CAMPAIGN) for (const a of n.after) expect(ids.has(a)).toBe(true);
    expect(CAMPAIGN.filter((n) => n.after.length === 0)).toHaveLength(1);
    // Branches: some node opens two others, and some node joins two.
    const children = (id: string) => CAMPAIGN.filter((n) => n.after.includes(id)).length;
    expect(CAMPAIGN.some((n) => children(n.id) >= 2)).toBe(true);
    expect(CAMPAIGN.some((n) => n.after.length >= 2)).toBe(true);
  });

  it("nodes 1–3 are the tutorial on Single Rock and a two-body system", () => {
    const [a, b, c] = CAMPAIGN;
    expect(a!.map.mode).toBe("singleRock");
    expect(b!.map.mode).toBe("singleRock");
    expect(createGame(nodeConfig(c!, "swarmer"), c!.seed).bodies).toHaveLength(2);
    for (const n of [a!, b!, c!]) expect(n.tutorial.length).toBeGreaterThan(0);
  });

  it("unlocks Predator at node 4, Sporer at node 7, and 4 mutations", () => {
    expect(strainUnlockNode("predator")).toBe(4);
    expect(strainUnlockNode("sporer")).toBe(7);
    expect(CAMPAIGN_MUTATIONS).toHaveLength(4);
    const fresh = emptyProgress();
    expect(unlockedStrains(fresh).sort()).toEqual(["biofilm", "swarmer"]);
    expect(unlockedMutations(fresh)).toHaveLength(8);
    const all = { ...fresh, completedNodes: CAMPAIGN.map((n) => n.id) };
    expect(unlockedMutations(all)).toHaveLength(12);
  });

  it("applies modifiers and checks twists", () => {
    const storm = CAMPAIGN.find((n) => n.modifier === "flare_storm")!;
    expect(nodeConfig(storm, "biofilm").rules).toMatchObject(MODIFIERS.flare_storm.rules);
    const twisted = CAMPAIGN.find((n) => n.twist === "keep_cores")!;
    expect(nodeCompleted(twisted, base({}))).toBe(true);
    expect(nodeCompleted(twisted, base({ coresLost: 1 }))).toBe(false);
    expect(nodeCompleted(twisted, base({ outcome: "loss" }))).toBe(false);
    expect(nodeOpen(CAMPAIGN[1]!, new Set())).toBe(false);
    expect(nodeOpen(CAMPAIGN[1]!, new Set(["c01"]))).toBe(true);
  });
});

describe("progress", () => {
  it("merges as a union, so no copy can roll another back", () => {
    const a = { ...emptyProgress(), completedNodes: ["c01"], achievements: ["first_win"] };
    const b = { ...emptyProgress(), completedNodes: ["c02"], drafted: ["quorum" as const] };
    const m = mergeProgress(a, b);
    expect(m.completedNodes).toEqual(["c01", "c02"]);
    expect(m.drafted).toEqual(["quorum"]);
    expect(mergeProgress(m, a)).toEqual(m);
    expect(earnedCosmetics(m)).toContain("ember");
  });
});

describe("Daily Seed and seasons", () => {
  it("gives everyone the same setup for a UTC day", () => {
    expect(dailyDate(Date.UTC(2026, 10, 12, 23, 59))).toBe("2026-11-12");
    expect(isDailyDate("2026-11-12")).toBe(true);
    expect(isDailyDate("2026-13-01")).toBe(false);
    expect(dailySetup("2026-11-12")).toEqual(dailySetup("2026-11-12"));
    expect(dailySetup("2026-11-12").seed).not.toBe(dailySetup("2026-11-13").seed);
    expect(dailyScore(base({ turns: 20, finalDominance: 600 }), 40)).toBe(1000 + 400 + 300);
    expect(dailyScore(base({ outcome: "loss", finalDominance: 300 }), 40)).toBe(150);
  });

  it("runs 6-week seasons with a rotating sector", () => {
    const s0 = seasonAt(Date.UTC(2026, 0, 5));
    expect(s0.season).toBe(0);
    expect(seasonAt(s0.endsMs).season).toBe(1);
    expect(seasonAt(s0.endsMs - 1).season).toBe(0);
    expect(sectorFor(0)).toBe(SECTORS[0]);
    expect(sectorFor(SECTORS.length)).toBe(SECTORS[0]);
  });
});

describe("M8 tutorial pacing", () => {
  it("fruit and launch steps wait until they can be done; contact waits for an enemy", async () => {
    const { CAMPAIGN, nodeConfig, tutorialReady } = await import("../src");
    const { createGame } = await import("@swarm/sim");
    const c03 = CAMPAIGN.find((n) => n.id === "c03")!;
    const s = createGame(nodeConfig(c03, "sporer"), c03.seed);
    expect(tutorialReady(s, 0, undefined)).toBe(true);
    expect(tutorialReady(s, 0, { kind: "canFruit" })).toBe(false);
    expect(tutorialReady(s, 0, { kind: "canLaunch" })).toBe(false);
    expect(tutorialReady(s, 0, { kind: "contact" })).toBe(false);
    const home = s.bodies.find((b) => b.colony.some((c) => c?.owner === 0))!;
    const i = home.colony.findIndex((c) => c?.owner === 0 && !c.core);
    home.colony[i] = { ...home.colony[i]!, biomass: s.rules.fruitMinBiomass };
    expect(tutorialReady(s, 0, { kind: "canFruit" })).toBe(true);
    home.colony[i] = { ...home.colony[i]!, fruiting: 0 };
    expect(tutorialReady(s, 0, { kind: "canLaunch" })).toBe(true);
    // Every step's condition is satisfiable data (no typos): the steps that wait say why.
    for (const n of CAMPAIGN)
      for (const st of n.tutorial)
        if (st.when) expect(["always", "canFruit", "canLaunch", "contact"]).toContain(st.when.kind);
  });
});
