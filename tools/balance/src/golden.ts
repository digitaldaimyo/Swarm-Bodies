/**
 * Regenerates the golden replays (SPEC §9.3, §15 M1): 20 seeds of scripted random-legal play,
 * stored as seed + orders, with the state hash after every turn.
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
} from "@swarm/sim";
import { playGame, randomPolicy } from "./play";

export const GOLDEN_COUNT = 20;
const out = fileURLToPath(
  new URL("../../../packages/sim/test/golden/replays.json", import.meta.url),
);
const config: GameConfig = { mode: "singleRock", playerCount: 2 };

const replays = Array.from({ length: GOLDEN_COUNT }, (_, i) => {
  const seed = `golden-${String(i).padStart(2, "0")}`;
  const game = playGame(config, seed, randomPolicy(`script-${i}`));
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
