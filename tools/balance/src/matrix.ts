/**
 * Strain matrix (SPEC §12.4): every pair of playable strains, Normal vs Normal by default, with
 * the balance targets checked:
 *
 * - every strain pair within 40–60% (CI gate: 30–70%, wider to absorb noise),
 * - average 1v1 game length 18–28 turns,
 * - under 5% of games reach the turn limit with no player above 40% dominance,
 * - no mutation's pick win rate above 58% (judged once it has enough picks).
 */
import {
  MUTATION_IDS,
  PLAYABLE_STRAINS,
  type GameMode,
  type MutationId,
  type Rules,
  type StrainId,
} from "@swarm/sim";
import { runBatch, type Report } from "./cli";
import type { PolicyName } from "./play";

export const TARGETS = {
  pairLow: 400,
  pairHigh: 600,
  gateLow: 300,
  gateHigh: 700,
  lengthMin: 18,
  lengthMax: 28,
  stallMaxPermille: 50,
  mutationMaxPermille: 580,
  /** Picks needed before a mutation's win rate is judged. */
  mutationMinPicks: 30,
  /** Games per strain pair below which the target lines are only indicative. */
  judgeGamesPerPair: 100,
} as const;

export interface PairResult {
  a: StrainId;
  b: StrainId;
  games: number;
  winsA: number;
  winsB: number;
  draws: number;
  /** A's score in per-mille, draws counting half. */
  scoreA: number;
  averageTurns: number;
  stalls: number;
}

export interface MatrixReport {
  map: GameMode;
  games: number;
  pairs: PairResult[];
  averageTurns: number;
  stallPermille: number;
  mutations: Record<MutationId, { picks: number; wins: number }>;
  reasons: Record<string, number>;
  errors: number;
  rejectedOrders: number;
}

export interface MatrixOptions {
  games: number;
  seed: string;
  map: GameMode;
  policy?: PolicyName;
  strains?: readonly StrainId[];
  rules?: Partial<Rules>;
  /** Run only pairs whose index % of === index (for parallel shards). */
  shard?: { index: number; of: number };
}

export function strainPairs(
  strains: readonly StrainId[] = PLAYABLE_STRAINS,
): [StrainId, StrainId][] {
  const out: [StrainId, StrainId][] = [];
  for (let i = 0; i < strains.length; i++)
    for (let j = i + 1; j < strains.length; j++)
      out.push([strains[i] as StrainId, strains[j] as StrainId]);
  return out;
}

/** Games per pair: the batch split evenly, rounded up to an even number so seats alternate. */
export function gamesPerPair(total: number, pairs: number): number {
  const n = Math.ceil(total / Math.max(1, pairs));
  return n + (n % 2);
}

export function runMatrix(opts: MatrixOptions): MatrixReport {
  const pairs = strainPairs(opts.strains);
  const per = gamesPerPair(opts.games, pairs.length);
  const policy = opts.policy ?? "normal";
  const reports: { pair: [StrainId, StrainId]; report: Report }[] = [];
  pairs.forEach((pair, i) => {
    if (opts.shard && i % opts.shard.of !== opts.shard.index) return;
    const report = runBatch({
      games: per,
      seed: `${opts.seed}-${pair[0]}-${pair[1]}`,
      players: [policy, policy],
      strains: pair,
      map: opts.map,
      ...(opts.rules ? { rules: opts.rules } : {}),
    });
    reports.push({ pair, report });
  });
  return combine(opts.map, reports);
}

export function combine(
  map: GameMode,
  reports: readonly { pair: [StrainId, StrainId]; report: Report }[],
): MatrixReport {
  const out: MatrixReport = {
    map,
    games: 0,
    pairs: [],
    averageTurns: 0,
    stallPermille: 0,
    mutations: Object.fromEntries(
      MUTATION_IDS.map((m) => [m, { picks: 0, wins: 0 }]),
    ) as MatrixReport["mutations"],
    reasons: {},
    errors: 0,
    rejectedOrders: 0,
  };
  let turns = 0;
  let stalls = 0;
  for (const { pair, report: r } of reports) {
    const [a, b] = r.sides;
    out.pairs.push({
      a: pair[0],
      b: pair[1],
      games: r.games,
      winsA: a.wins,
      winsB: b.wins,
      draws: r.draws,
      scoreA: Math.round(((a.wins + r.draws / 2) * 1000) / Math.max(1, r.games)),
      averageTurns: r.averageTurns,
      stalls: r.turnLimitBelow40Pct,
    });
    out.games += r.games;
    turns += r.averageTurns * r.games;
    stalls += r.turnLimitBelow40Pct;
    out.errors += r.errors.length;
    out.rejectedOrders += r.rejectedOrders;
    for (const [k, v] of Object.entries(r.reasons)) out.reasons[k] = (out.reasons[k] ?? 0) + v;
    for (const m of MUTATION_IDS) {
      out.mutations[m].picks += r.mutations[m].picks;
      out.mutations[m].wins += r.mutations[m].wins;
    }
  }
  out.averageTurns = out.games === 0 ? 0 : Math.round((turns / out.games) * 10) / 10;
  out.stallPermille = out.games === 0 ? 0 : Math.round((stalls * 1000) / out.games);
  return out;
}

/** Merges shard reports (from parallel runs) into one. */
export function mergeMatrices(parts: readonly MatrixReport[]): MatrixReport {
  const first = parts[0];
  if (!first) throw new Error("nothing to merge");
  const out: MatrixReport = {
    ...first,
    pairs: parts.flatMap((p) => p.pairs),
    games: 0,
    reasons: {},
    errors: 0,
    rejectedOrders: 0,
    mutations: Object.fromEntries(
      MUTATION_IDS.map((m) => [m, { picks: 0, wins: 0 }]),
    ) as MatrixReport["mutations"],
  };
  let turns = 0;
  let stalls = 0;
  for (const p of parts) {
    out.games += p.games;
    turns += p.averageTurns * p.games;
    stalls += (p.stallPermille * p.games) / 1000;
    out.errors += p.errors;
    out.rejectedOrders += p.rejectedOrders;
    for (const [k, v] of Object.entries(p.reasons)) out.reasons[k] = (out.reasons[k] ?? 0) + v;
    for (const m of MUTATION_IDS) {
      out.mutations[m].picks += p.mutations[m].picks;
      out.mutations[m].wins += p.mutations[m].wins;
    }
  }
  out.pairs.sort((x, y) => (x.a + x.b < y.a + y.b ? -1 : 1));
  out.averageTurns = out.games === 0 ? 0 : Math.round((turns / out.games) * 10) / 10;
  out.stallPermille = out.games === 0 ? 0 : Math.round((stalls * 1000) / out.games);
  return out;
}

export interface TargetCheck {
  name: string;
  ok: boolean;
  detail: string;
}

/** The §12.4 targets, and the looser CI gate on strain pairs. */
export function checkTargets(m: MatrixReport): { targets: TargetCheck[]; gate: TargetCheck } {
  const pct = (p: number) => `${(p / 10).toFixed(1)}%`;
  const scores = m.pairs.map((p) => p.scoreA);
  const lo = Math.min(...scores);
  const hi = Math.max(...scores);
  // A pair's balance is symmetric: A at 35% is B at 65%.
  const worst = m.pairs.reduce((w, p) => Math.max(w, Math.abs(p.scoreA - 500)), 0);
  const judged = MUTATION_IDS.filter((id) => m.mutations[id].picks >= TARGETS.mutationMinPicks);
  const rates = judged.map((id) => ({
    id,
    rate: Math.round((m.mutations[id].wins * 1000) / m.mutations[id].picks),
  }));
  const top = rates.reduce((b, r) => (r.rate > b.rate ? r : b), { id: "-", rate: 0 });
  return {
    targets: [
      {
        name: "strain pairs 40–60%",
        ok: worst <= 100,
        detail: `side A scores ${pct(lo)}–${pct(hi)} (worst pair ${pct(500 + worst)}/${pct(500 - worst)})`,
      },
      {
        name: "1v1 length 18–28 turns",
        ok: m.averageTurns >= TARGETS.lengthMin && m.averageTurns <= TARGETS.lengthMax,
        detail: `${m.averageTurns} turns`,
      },
      {
        name: "turn-limit stalls under 5%",
        ok: m.stallPermille < TARGETS.stallMaxPermille,
        detail: pct(m.stallPermille),
      },
      {
        name: "mutation pick win rate ≤ 58%",
        ok: top.rate <= TARGETS.mutationMaxPermille,
        detail: `highest ${top.id} ${pct(top.rate)} (${judged.length}/12 with ${TARGETS.mutationMinPicks}+ picks)`,
      },
    ],
    gate: {
      name: "CI gate: every strain pair within 30–70%",
      ok: worst <= 200,
      detail: `worst pair ${pct(500 + worst)}/${pct(500 - worst)}`,
    },
  };
}

export function formatMatrix(m: MatrixReport): string {
  const pct = (p: number) => `${(p / 10).toFixed(1)}%`.padStart(6);
  const lines = [
    `Strain matrix (${m.map}), ${m.games} games`,
    ...m.pairs.map(
      (p) =>
        `  ${p.a.padEnd(9)} vs ${p.b.padEnd(9)} ${pct(p.scoreA)}  (${p.winsA}-${p.winsB}${p.draws ? `-${p.draws}` : ""} of ${p.games}, ${p.averageTurns} turns, ${p.stalls} stalls)`,
    ),
    `  endings: ${Object.entries(m.reasons)
      .map(([r, n]) => `${r} ${n}`)
      .join(", ")}`,
    "  mutations (picks, pick win rate):",
    ...MUTATION_IDS.map((id) => {
      const s = m.mutations[id];
      return `    ${id.padEnd(16)} ${String(s.picks).padStart(4)}  ${s.picks ? pct(Math.round((s.wins * 1000) / s.picks)) : "     -"}`;
    }),
  ];
  const { targets, gate } = checkTargets(m);
  // Below ~100 games a pair, one pair's rate moves several points between seed sets: the
  // targets are judged on large batches (DECISIONS #70); the CI gate is the enforced check.
  const perPair = m.pairs.length === 0 ? 0 : m.games / m.pairs.length;
  lines.push(
    perPair >= TARGETS.judgeGamesPerPair
      ? "  targets (SPEC §12.4):"
      : `  targets (SPEC §12.4), indicative only at ${Math.round(perPair)} games a pair (judge on ${TARGETS.judgeGamesPerPair}+):`,
  );
  for (const t of [...targets, gate]) lines.push(`    ${t.ok ? "✓" : "✗"} ${t.name}: ${t.detail}`);
  lines.push(`  errors: ${m.errors}, orders rejected at resolution: ${m.rejectedOrders}`);
  return lines.join("\n");
}
