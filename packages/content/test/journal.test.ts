import { describe, expect, it } from "vitest";
import {
  MUTATION_IDS,
  createGame,
  randomOrderSet,
  resolveTurn,
  type BodyType,
  type OrderSet,
  type PlayerId,
} from "@swarm/sim";
import {
  ACHIEVEMENTS,
  CAMPAIGN,
  JOURNAL,
  LESSONS,
  MUTATION_NOTES,
  STRAIN_NOTES,
  WORLD,
  emptyProgress,
  journalHint,
  journalUnlocked,
  mergeProgress,
  summarizeGame,
} from "../src";

const PHONE = 260;
const BODY_TYPES: readonly BodyType[] = ["carbonaceous", "icy", "metallic", "irradiated"];

describe("Dr. Purr's field journal (docs/plans/tutorial.md, step 6)", () => {
  it("has a field note for every strain, mutation, body type, deposit, flare and comet", () => {
    expect(Object.keys(STRAIN_NOTES).sort()).toEqual(["biofilm", "predator", "sporer", "swarmer"]);
    expect(Object.keys(MUTATION_NOTES).sort()).toEqual([...MUTATION_IDS].sort());
    const ids = WORLD.map((w) => w.id).sort();
    expect(ids).toEqual(
      [
        ...BODY_TYPES.map((b) => `body:${b}`),
        "deposit:ice",
        "deposit:mineral",
        "deposit:organic",
        "event:comet",
        "event:flare",
      ].sort(),
    );
    const notes = [
      ...Object.values(STRAIN_NOTES),
      ...Object.values(MUTATION_NOTES),
      ...WORLD.map((w) => w.note),
    ];
    for (const n of notes) {
      expect(n.length).toBeGreaterThan(10);
      expect(n.length).toBeLessThanOrEqual(PHONE);
    }
  });

  it("opens each Journal entry from a real lesson, node or feat", () => {
    expect(new Set(JOURNAL.map((j) => j.id)).size).toBe(JOURNAL.length);
    for (const j of JOURNAL) {
      const u = j.unlock;
      if (u.kind === "lesson") expect(LESSONS.map((l) => l.id)).toContain(u.id);
      if (u.kind === "node") expect(CAMPAIGN.map((n) => n.id)).toContain(u.id);
      if (u.kind === "achievement") expect(ACHIEVEMENTS.map((a) => a.id)).toContain(u.id);
      expect(j.text.length).toBeGreaterThan(0);
      if (u.kind !== "start") expect(journalHint(u)).not.toMatch(/undefined|\?/);
    }
  });

  it("opens only the first page for a new player, and more as progress grows", () => {
    const fresh = emptyProgress();
    expect(JOURNAL.filter((j) => journalUnlocked(j, fresh)).map((j) => j.id)).toEqual(["j_start"]);
    const some = { ...fresh, completedNodes: ["c12"], completedLessons: ["l1"] };
    const open = JOURNAL.filter((j) => journalUnlocked(j, some)).map((j) => j.id);
    expect(open).toContain("j_bloom");
    expect(open).toContain("j_feeding");
    expect(open).not.toContain("j_assistant");
    const all = { ...fresh, completedLessons: LESSONS.map((l) => l.id) };
    expect(JOURNAL.filter((j) => journalUnlocked(j, all)).map((j) => j.id)).toContain(
      "j_assistant",
    );
  });

  it("records what a game met, and merges it by union (older saves have none)", () => {
    const config = { mode: "system", playerCount: 2 } as const;
    let s = createGame(config, "journal-1");
    const turns: Record<PlayerId, OrderSet>[] = [];
    while (!s.result) {
      const orders = { 0: randomOrderSet(s, 0, "a"), 1: randomOrderSet(s, 1, "b") };
      turns.push(orders);
      s = resolveTurn(s, orders).state;
    }
    const sum = summarizeGame(config, "journal-1", turns, 0, { mode: "skirmish" });
    for (const b of s.bodies) expect(sum.met).toContain(`body:${b.type}`);
    expect(sum.met.some((m) => m.startsWith("deposit:"))).toBe(true);
    if (sum.turns > 12) expect(sum.met).toContain("event:flare");
    const old = { ...emptyProgress(), met: undefined } as unknown as ReturnType<
      typeof emptyProgress
    >;
    expect(mergeProgress(old, { ...emptyProgress(), met: sum.met }).met).toEqual(
      [...sum.met].sort(),
    );
  });
});
