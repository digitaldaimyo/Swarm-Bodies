/**
 * Headless batch runner (SPEC §12.4). M1 plays random-legal games on Single Rock and reports
 * outcomes; strains, bots and the CI gate arrive in M2–M6.
 *
 *   pnpm balance -- --games 200 [--seed prefix] [--strains swarmer,biofilm] [--json]
 */
import { playGame, randomPolicy, type PlayedGame } from "./play";

interface Options {
  games: number;
  seed: string;
  strains: string[];
  json: boolean;
}

export function parseArgs(argv: readonly string[]): Options {
  const opts: Options = { games: 200, seed: "balance", strains: [], json: false };
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
      case "--strains":
        opts.strains = value()
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case "--json":
        opts.json = true;
        break;
      case "--help":
      case "-h":
        console.log("Usage: pnpm balance -- --games N [--seed PREFIX] [--strains a,b] [--json]");
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  return opts;
}

export interface Report {
  games: number;
  errors: { seed: string; message: string }[];
  wins: Record<string, number>;
  draws: number;
  reasons: Record<string, number>;
  averageTurns: number;
  turnLimitBelow40Pct: number;
  rejectedOrders: number;
}

export function runBatch(opts: Pick<Options, "games" | "seed">): Report {
  const report: Report = {
    games: opts.games,
    errors: [],
    wins: {},
    draws: 0,
    reasons: {},
    averageTurns: 0,
    turnLimitBelow40Pct: 0,
    rejectedOrders: 0,
  };
  let turnSum = 0;
  let finished = 0;
  for (let g = 0; g < opts.games; g++) {
    const seed = `${opts.seed}-${g}`;
    let game: PlayedGame;
    try {
      game = playGame({ mode: "singleRock", playerCount: 2 }, seed, randomPolicy(seed));
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
    else report.wins[`p${result.winner}`] = (report.wins[`p${result.winner}`] ?? 0) + 1;
    const last = game.dominance.at(-1) ?? [];
    if (
      result.reason !== "dominance" &&
      result.reason !== "lastStanding" &&
      Math.max(...last) < 400
    ) {
      report.turnLimitBelow40Pct++;
    }
    report.rejectedOrders += game.rejected;
  }
  report.averageTurns = finished === 0 ? 0 : Math.round((turnSum / finished) * 10) / 10;
  return report;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.strains.length > 0) {
    console.warn(
      `Note: strains (${opts.strains.join(", ")}) are not in the sim until M4/M6; using base rules.`,
    );
  }
  const started = process.hrtime.bigint();
  const report = runBatch(opts);
  const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
  if (opts.json) {
    console.log(JSON.stringify({ ...report, ms }, null, 2));
  } else {
    const pct = (n: number) => `${((100 * n) / report.games).toFixed(1)}%`;
    console.log(`Single Rock, random-legal vs random-legal — ${report.games} games in ${ms} ms`);
    for (const [p, n] of Object.entries(report.wins).sort())
      console.log(`  ${p} wins: ${n} (${pct(n)})`);
    console.log(`  draws:   ${report.draws} (${pct(report.draws)})`);
    console.log(
      `  endings: ${Object.entries(report.reasons)
        .map(([r, n]) => `${r} ${n}`)
        .join(", ")}`,
    );
    console.log(`  average length: ${report.averageTurns} turns`);
    console.log(
      `  turn limit with nobody above 40%: ${report.turnLimitBelow40Pct} (${pct(report.turnLimitBelow40Pct)})`,
    );
    console.log(`  orders rejected at resolution: ${report.rejectedOrders}`);
    console.log(`  errors: ${report.errors.length}`);
  }
  for (const e of report.errors) console.error(`\n[${e.seed}] ${e.message}`);
  if (report.errors.length > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
