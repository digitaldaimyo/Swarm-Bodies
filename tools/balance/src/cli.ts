/**
 * Headless batch runner (SPEC §12.4), two-player, on Single Rock or a generated system.
 *
 *   pnpm balance -- --games 200 [--players normal,random] [--seed prefix] [--strains a,b]
 *                   [--map singleRock|system] [--rules JSON] [--json]
 *   pnpm balance -- --matrix --games 200 --map system [--gate] [--jobs 4] [--rules JSON]
 *
 * `--matrix` plays every pair of playable strains (Normal vs Normal) and checks the SPEC §12.4
 * targets; `--gate` exits non-zero if any pair leaves 30–70% (the CI gate). `--jobs N` splits
 * the pairs over N processes. `--rules` overrides tunables for experiments.
 *
 * Seats alternate every game so neither policy always moves as player 0. `--strains a,b` gives
 * side A strain a and side B strain b; each strain follows its side when seats swap.
 */
import {
  MUTATION_IDS,
  STRAIN_IDS,
  type GameMode,
  type MutationId,
  type Rules,
  type StrainId,
} from "@swarm/sim";
import { execFile } from "node:child_process";
import { checkTargets, formatMatrix, mergeMatrices, runMatrix, type MatrixReport } from "./matrix";
import { isPolicyName, playGame, policyByName, type PlayedGame, type PolicyName } from "./play";

interface Options {
  games: number;
  seed: string;
  players: [PolicyName, PolicyName];
  strains: [StrainId, StrainId];
  map: GameMode;
  json: boolean;
  matrix: boolean;
  gate: boolean;
  jobs: number;
  shard: { index: number; of: number } | null;
  rules: Partial<Rules> | null;
}

export function parseArgs(argv: readonly string[]): Options {
  const opts: Options = {
    games: 200,
    seed: "balance",
    players: ["normal", "normal"],
    strains: ["base", "base"],
    map: "singleRock",
    json: false,
    matrix: false,
    gate: false,
    jobs: 1,
    shard: null,
    rules: null,
  };
  const args = argv.filter((a) => a !== "--");
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const value = (): string => {
      const v = args[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--games": {
        const n = Number(value());
        if (!Number.isInteger(n) || n < 1) throw new Error("--games must be a positive integer");
        opts.games = n;
        break;
      }
      case "--seed":
        opts.seed = value();
        break;
      case "--players": {
        const names = value()
          .split(",")
          .map((s) => s.trim());
        if (names.length !== 2 || !names.every(isPolicyName)) {
          throw new Error("--players takes two of random, easy, normal, hard (e.g. normal,random)");
        }
        opts.players = names as [PolicyName, PolicyName];
        break;
      }
      case "--strains": {
        const names = value()
          .split(",")
          .map((s) => s.trim());
        if (
          names.length !== 2 ||
          !names.every((n) => (STRAIN_IDS as readonly string[]).includes(n))
        ) {
          throw new Error(`--strains takes two of ${STRAIN_IDS.join(", ")} (e.g. swarmer,biofilm)`);
        }
        opts.strains = names as [StrainId, StrainId];
        break;
      }
      case "--map": {
        const m = value();
        if (m !== "singleRock" && m !== "system") {
          throw new Error("--map takes singleRock or system");
        }
        opts.map = m;
        break;
      }
      case "--json":
        opts.json = true;
        break;
      case "--matrix":
        opts.matrix = true;
        break;
      case "--gate":
        opts.gate = true;
        break;
      case "--jobs": {
        const n = Number(value());
        if (!Number.isInteger(n) || n < 1) throw new Error("--jobs must be a positive integer");
        opts.jobs = n;
        break;
      }
      case "--shard": {
        const m = /^(\d+)\/(\d+)$/.exec(value());
        if (!m || Number(m[1]) >= Number(m[2])) throw new Error("--shard takes k/n with k < n");
        opts.shard = { index: Number(m[1]), of: Number(m[2]) };
        break;
      }
      case "--rules": {
        const v: unknown = JSON.parse(value());
        if (typeof v !== "object" || v === null || Array.isArray(v))
          throw new Error("--rules takes a JSON object of rule overrides");
        opts.rules = v as Partial<Rules>;
        break;
      }
      case "--help":
      case "-h":
        console.log(
          "Usage: pnpm balance -- --games N [--players a,b] [--seed PREFIX] [--strains a,b] [--map singleRock|system] [--rules JSON] [--json]\n       pnpm balance -- --matrix --games N [--map system] [--gate] [--jobs N] [--rules JSON] [--json]",
        );
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  return opts;
}

export interface SideReport {
  policy: PolicyName;
  strain: StrainId;
  wins: number;
  /** Slowest single turn and mean turn time for this side, in ms. */
  maxTurnMs: number;
  meanTurnMs: number;
}

export interface Report {
  games: number;
  sides: [SideReport, SideReport];
  draws: number;
  reasons: Record<string, number>;
  averageTurns: number;
  turnLimitBelow40Pct: number;
  rejectedOrders: number;
  /** Spore launches across all games (system maps only). */
  launches: number;
  /** Per mutation: how often a player ended the game with it, and how often that player won. */
  mutations: Record<MutationId, { picks: number; wins: number }>;
  /** Mean dominance (per-mille) per side at each turn, over the games still running then. */
  curves: [number[], number[]];
  errors: { seed: string; message: string }[];
}

export function runBatch(
  opts: Pick<Options, "games" | "seed" | "players"> & {
    strains?: [StrainId, StrainId];
    map?: GameMode;
    /** Rule overrides for tuning experiments (SPEC §12.4). */
    rules?: Partial<Rules>;
  },
): Report {
  const strains = opts.strains ?? ["base", "base"];
  const sides = opts.players.map((policy, i) => ({
    policy,
    strain: strains[i] as StrainId,
    wins: 0,
    maxTurnMs: 0,
    meanTurnMs: 0,
  })) as [SideReport, SideReport];
  const timeSum = [0, 0];
  const timeCount = [0, 0];
  const report: Report = {
    games: opts.games,
    sides,
    draws: 0,
    reasons: {},
    averageTurns: 0,
    turnLimitBelow40Pct: 0,
    rejectedOrders: 0,
    launches: 0,
    mutations: Object.fromEntries(
      MUTATION_IDS.map((m) => [m, { picks: 0, wins: 0 }]),
    ) as Report["mutations"],
    curves: [[], []],
    errors: [],
  };
  const curveSum: [number[], number[]] = [[], []];
  const curveCount: number[] = [];
  let turnSum = 0;
  let finished = 0;
  for (let g = 0; g < opts.games; g++) {
    const seed = `${opts.seed}-${g}`;
    // Side A sits in seat 0 on even games and seat 1 on odd games.
    const sideOfSeat = g % 2 === 0 ? [0, 1] : [1, 0];
    const policies = sideOfSeat.map((side) => policyByName(opts.players[side] as PolicyName, seed));
    let game: PlayedGame;
    try {
      const seatStrains = sideOfSeat.map((side) => strains[side] as StrainId);
      game = playGame(
        {
          mode: opts.map ?? "singleRock",
          playerCount: 2,
          strains: seatStrains,
          ...(opts.rules ? { rules: opts.rules } : {}),
        },
        seed,
        policies,
        (seat, ms) => {
          const side = sideOfSeat[seat] as number;
          const s = sides[side as 0 | 1];
          s.maxTurnMs = Math.max(s.maxTurnMs, ms);
          timeSum[side] = (timeSum[side] as number) + ms;
          timeCount[side] = (timeCount[side] as number) + 1;
        },
      );
    } catch (err) {
      report.errors.push({
        seed,
        message: err instanceof Error ? (err.stack ?? err.message) : String(err),
      });
      continue;
    }
    finished++;
    const { result } = game;
    turnSum += result.turn;
    report.reasons[result.reason] = (report.reasons[result.reason] ?? 0) + 1;
    if (result.winner === null) report.draws++;
    else sides[sideOfSeat[result.winner] as 0 | 1].wins++;
    const last = game.dominance.at(-1) ?? [];
    if (result.reason === "turnLimit" || result.reason === "draw") {
      if (Math.max(...last) < 400) report.turnLimitBelow40Pct++;
    }
    report.rejectedOrders += game.rejected;
    for (const p of game.final.players) {
      for (const m of p.mutations) {
        const stat = report.mutations[m];
        stat.picks++;
        if (result.winner === p.id) stat.wins++;
      }
    }
    game.dominance.forEach((byPlayer, t) => {
      curveCount[t] = (curveCount[t] ?? 0) + 1;
      sideOfSeat.forEach((side, seat) => {
        const curve = curveSum[side as 0 | 1];
        curve[t] = (curve[t] ?? 0) + (byPlayer[seat] ?? 0);
      });
    });
    for (const t of game.turns) {
      for (const set of Object.values(t))
        report.launches += set.filter((o) => o.type === "launch").length;
    }
  }
  sides.forEach(
    (s, i) =>
      (s.meanTurnMs =
        (timeCount[i] as number) === 0 ? 0 : (timeSum[i] as number) / (timeCount[i] as number)),
  );
  report.averageTurns = finished === 0 ? 0 : Math.round((turnSum / finished) * 10) / 10;
  report.curves = curveSum.map((c) =>
    c.map((v, t) => Math.round(v / Math.max(1, curveCount[t] ?? 1))),
  ) as [number[], number[]];
  return report;
}

function matrixMain(opts: Options): void {
  const started = performance.now();

  if (opts.jobs > 1 && !opts.shard) {
    // Fan the pairs out to child processes and merge their JSON reports.
    const base = process.argv
      .slice(2)
      .filter((a, i, all) => a !== "--jobs" && all[i - 1] !== "--jobs");
    const parts = Array.from({ length: opts.jobs }, (_, k) =>
      execFileAsync(process.execPath, [
        ...process.execArgv,
        process.argv[1] as string,
        ...base,
        "--shard",
        `${k}/${opts.jobs}`,
        "--json",
      ]),
    );
    void Promise.all(parts).then((outs) => {
      finish(mergeMatrices(outs.map((o) => JSON.parse(o) as MatrixReport)));
    });
    return;
  }
  const report = runMatrix({
    games: opts.games,
    seed: opts.seed,
    map: opts.map,
    policy: opts.players[0],
    ...(opts.rules ? { rules: opts.rules } : {}),
    ...(opts.shard ? { shard: opts.shard } : {}),
  });
  finish(report);

  function finish(m: MatrixReport): void {
    if (opts.json) console.log(JSON.stringify(m));
    else console.log(`${formatMatrix(m)}\n  ${Math.round(performance.now() - started)} ms`);
    if (m.errors > 0) process.exitCode = 1;
    if (opts.gate && !opts.shard && !checkTargets(m).gate.ok) {
      console.error("Balance gate failed: a strain pair is outside 30–70%.");
      process.exitCode = 1;
    }
  }
}

function execFileAsync(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.matrix) return matrixMain(opts);
  const started = performance.now();
  const report = runBatch({
    games: opts.games,
    seed: opts.seed,
    players: opts.players,
    strains: opts.strains,
    map: opts.map,
    ...(opts.rules ? { rules: opts.rules } : {}),
  });
  const ms = Math.round(performance.now() - started);
  if (opts.json) {
    console.log(JSON.stringify({ ...report, ms }, null, 2));
  } else {
    const pct = (n: number) => `${((100 * n) / report.games).toFixed(1)}%`;
    const [a, b] = report.sides;
    console.log(
      `${opts.map === "system" ? "System" : "Single Rock"}, ${a.policy}/${a.strain} vs ${b.policy}/${b.strain} — ${report.games} games in ${ms} ms (seats alternate)`,
    );
    for (const [label, s] of [
      ["A", a],
      ["B", b],
    ] as const) {
      console.log(
        `  ${label} ${(s.strain === "base" ? s.policy : `${s.policy}/${s.strain}`).padEnd(15)} wins: ${s.wins} (${pct(s.wins)})  turn time mean ${s.meanTurnMs.toFixed(2)} ms, max ${s.maxTurnMs.toFixed(1)} ms`,
      );
    }
    console.log(`  draws: ${report.draws} (${pct(report.draws)})`);
    const endings = Object.entries(report.reasons)
      .map(([r, n]) => `${r} ${n}`)
      .join(", ");
    console.log(`  endings: ${endings}`);
    console.log(`  average length: ${report.averageTurns} turns`);
    console.log(
      `  turn limit with nobody above 40%: ${report.turnLimitBelow40Pct} (${pct(report.turnLimitBelow40Pct)})`,
    );
    console.log(`  orders rejected at resolution: ${report.rejectedOrders}`);
    if (opts.map === "system") console.log(`  spore launches: ${report.launches}`);
    console.log(`  errors: ${report.errors.length}`);
  }
  for (const e of report.errors) console.error(`\n[${e.seed}] ${e.message}`);
  if (report.errors.length > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
