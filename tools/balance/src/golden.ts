/**
 * Regenerates the golden replays (SPEC §9.3, §15 M1, M5): 50 seeds of scripted random-legal play,
 * stored as seed + config + orders, with the state hash after every turn. The first 20 are
 * Single Rock (from M1); the other 30 are star systems with 2–4 players and mixed strains, so
 * orbits, fruiting, launches, landings, flares and comets are all covered.
 *
 * Only run this when a sim change is meant to change outcomes, and say why in the commit
 * message (CLAUDE.md). The orders are stored, not regenerated at test time, so changes to the
 * random player never move the golden hashes.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createGame,
  hashState,
  resolveTurn,
  type GameConfig,
  type OrderSet,
  type PlayerId,
  type StrainId,
} from "@swarm/sim";
import { playGame, randomPolicy } from "./play";

export const SINGLE_ROCK_COUNT = 20;
export const SYSTEM_COUNT = 30;
const out = fileURLToPath(
  new URL("../../../packages/sim/test/golden/replays.json", import.meta.url),
);
const STRAINS: StrainId[] = ["base", "swarmer", "biofilm", "predator", "sporer"];
const cases: { seed: string; config: GameConfig; script: string }[] = [
  ...Array.from({ length: SINGLE_ROCK_COUNT }, (_, i) => ({
    seed: `golden-${String(i).padStart(2, "0")}`,
    config: { mode: "singleRock", playerCount: 2 } as GameConfig,
    script: `script-${i}`,
  })),
  ...Array.from({ length: SYSTEM_COUNT }, (_, i) => {
    const players = 2 + (i % 3);
    return {
      seed: `golden-sys-${String(i).padStart(2, "0")}`,
      config: {
        mode: "system",
        playerCount: players,
        strains: Array.from(
          { length: players },
          (_, p) => STRAINS[(i + p) % STRAINS.length] as StrainId,
        ),
      } as GameConfig,
      script: `script-sys-${i}`,
    };
  }),
];

const replays = cases.map(({ seed, config, script }) => {
  const game = playGame(config, seed, randomPolicy(script));
  let state = createGame(config, seed);
  const initialHash = hashState(state);
  const hashes = game.turns.map((turn) => {
    const byPlayer: Record<PlayerId, OrderSet> = {};
    turn.forEach((orders, p) => (byPlayer[p] = orders));
    state = resolveTurn(state, byPlayer).state;
    return hashState(state);
  });
  return { seed, config, initialHash, orders: game.turns, hashes, result: game.result };
});

writeFileSync(
  out,
  `${JSON.stringify({ version: 1, generatedBy: "pnpm golden:update", replays })}\n`,
);
console.log(`Wrote ${replays.length} golden replays to ${out}`);
