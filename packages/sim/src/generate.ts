import { resolveRules, type DepositKind, type Rules } from "./config";
import { refreshConnectivity } from "./connectivity";
import { getBoard, hexDistance, HEX_DIRECTIONS, type Board, type Hex } from "./hex";
import { permille } from "./math";
import { rngStream, type Rng } from "./rng";
import type { Body, Colony, GameConfig, GameState, PlayerState, Terrain } from "./types";

const DEPOSIT_KINDS: readonly DepositKind[] = ["ice", "mineral", "organic"];

/**
 * createGame (SPEC §9.2). M1 implements the "Single Rock" test mode (SPEC §4.1): one Large body
 * with two players on opposite edges, no other bodies, no launches and no orbits.
 */
export function createGame(config: GameConfig, seed: string): GameState {
  const rules = resolveRules(config.rules);
  switch (config.mode) {
    case "singleRock":
      return createSingleRock(config, rules, seed);
    default: {
      const mode: never = config.mode;
      throw new Error(`Unsupported game mode: ${String(mode)}`);
    }
  }
}

/** Point reflection through the centre. `0 - x` avoids producing -0. */
function mirror(h: Hex): Hex {
  return { q: 0 - h.q, r: 0 - h.r };
}

function createSingleRock(config: GameConfig, rules: Rules, seed: string): GameState {
  if (config.playerCount !== 2) {
    throw new Error(`Single Rock supports exactly 2 players, got ${config.playerCount}`);
  }
  const rng = rngStream(seed, "system");
  const radius = rules.bodyRadius.large;
  const board = getBoard(radius);
  const n = board.cells.length;
  const terrain: Terrain[] = new Array<Terrain>(n).fill("regolith");
  const deposits: (DepositKind | null)[] = new Array<DepositKind | null>(n).fill(null);
  const colony: (Colony | null)[] = new Array<Colony | null>(n).fill(null);
  const idx = (h: Hex): number => board.indexOf(h.q, h.r);

  // The map is point-symmetric through the centre so both players get the same position
  // (see docs/DECISIONS.md). Player 1 always gets the mirror of player 0's cells.
  const axis = HEX_DIRECTIONS[rng.int(3)] as Hex;
  const startDist = radius - 1;
  const start0: Hex = { q: axis.q * startDist, r: axis.r * startDist };
  const starts: Hex[] = [start0, mirror(start0)];

  // Starting colony cells adjacent to the core: prefer the neighbours nearest the centre.
  const inward = HEX_DIRECTIONS.map((d) => ({ q: start0.q + d.q, r: start0.r + d.r }))
    .filter((h) => idx(h) >= 0)
    .sort(
      (a, b) =>
        hexDistance(a, { q: 0, r: 0 }) - hexDistance(b, { q: 0, r: 0 }) || a.r - b.r || a.q - b.q,
    );
  const adjacent0 = rng.shuffle(inward.slice(0, 3)).slice(0, rules.startAdjacentCells);

  const protectedRange = 2;
  const nearStart = (i: number): boolean =>
    starts.some((s) => hexDistance(board.cells[i] as Hex, s) <= protectedRange);

  // Guaranteed home deposits (SPEC §4.2): one Organic and one Ice within range of the core,
  // never on the starting colony cells.
  const startCells = new Set<number>([start0, ...adjacent0].map(idx));
  const homeCandidates = board.cells
    .map((_, i) => i)
    .filter((i) => {
      const d = hexDistance(board.cells[i] as Hex, start0);
      return d >= 2 && d <= rules.homeGuaranteedDepositRange && !startCells.has(i);
    });
  const homePicks = rng.shuffle(homeCandidates).slice(0, 2);
  const placeMirrored = (i: number, set: (j: number) => void): void => {
    set(i);
    set(idx(mirror(board.cells[i] as Hex)));
  };
  placeMirrored(homePicks[0] as number, (j) => (deposits[j] = "organic"));
  placeMirrored(homePicks[1] as number, (j) => (deposits[j] = "ice"));

  placeRock(board, rng, rules, terrain, (i) => !nearStart(i) && deposits[i] === null);

  // Remaining deposits, by the body type's mix.
  const bodyType = "carbonaceous" as const;
  const mix = rules.depositMix[bodyType];
  const weights = DEPOSIT_KINDS.map((k) => mix[k]);
  const target = permille(n, rules.depositPermille);
  let placed = deposits.filter((d) => d !== null).length;
  const pool = rng.shuffle(board.cells.map((_, i) => i));
  for (const i of pool) {
    if (placed >= target) break;
    if (terrain[i] !== "regolith" || deposits[i] !== null || nearStart(i)) continue;
    const kind = DEPOSIT_KINDS[rng.weighted(weights)] as DepositKind;
    placeMirrored(i, (j) => {
      if (deposits[j] === null) placed++;
      deposits[j] = kind;
    });
  }

  const players: PlayerState[] = [];
  for (let p = 0; p < 2; p++) {
    const flip = p === 1 ? mirror : (h: Hex) => h;
    const core = flip(start0);
    colony[idx(core)] = { owner: p, biomass: rules.startCoreBiomass, core: true, connected: true };
    for (const a of adjacent0) {
      colony[idx(flip(a))] = {
        owner: p,
        biomass: rules.startAdjacentBiomass,
        core: false,
        connected: true,
      };
    }
    players.push({
      id: p,
      nutrients: rules.startNutrients,
      eliminated: false,
      eliminatedOnTurn: null,
      dominanceStreak: 0,
      home: { body: 0, cell: core },
    });
  }

  const body: Body = { id: 0, size: "large", type: bodyType, radius, terrain, deposits, colony };
  refreshConnectivity(body);
  return {
    version: 1,
    seed,
    mode: "singleRock",
    rules,
    turn: 1,
    bodies: [body],
    players,
    result: null,
  };
}

/**
 * Rock: about rockPermille of the cells, in small mirrored clusters. A cluster is rejected if it
 * would split the body into separate regions (checked with a flood fill, SPEC §4.2).
 */
function placeRock(
  board: Board,
  rng: Rng,
  rules: Rules,
  terrain: Terrain[],
  eligible: (i: number) => boolean,
): void {
  const n = board.cells.length;
  const target = permille(n, rules.rockPermille);
  let count = 0;
  const canRock = (i: number): boolean =>
    i >= 0 &&
    terrain[i] === "regolith" &&
    eligible(i) &&
    eligible(board.indexOf(-(board.cells[i] as Hex).q, -(board.cells[i] as Hex).r));
  for (let attempt = 0; attempt < 400 && count < target; attempt++) {
    const seedCell = rng.int(n);
    if (!canRock(seedCell)) continue;
    const size = rng.range(rules.rockClusterMin, rules.rockClusterMax);
    const cluster = [seedCell];
    for (let tries = 0; cluster.length < size && tries < 20; tries++) {
      const from = rng.pick(cluster);
      const next = rng.pick(board.neighbours[from] as readonly number[]);
      if (!cluster.includes(next) && canRock(next)) cluster.push(next);
    }
    const cells = new Set<number>();
    for (const i of cluster) {
      cells.add(i);
      const h = board.cells[i] as Hex;
      cells.add(board.indexOf(-h.q, -h.r));
    }
    if (count + cells.size > target + 1) continue;
    for (const i of cells) terrain[i] = "rock";
    if (isOneRegion(board, terrain)) {
      count += cells.size;
    } else {
      for (const i of cells) terrain[i] = "regolith";
    }
  }
}

export function isOneRegion(board: Board, terrain: readonly Terrain[]): boolean {
  const open = terrain.reduce((acc, t) => acc + (t === "rock" ? 0 : 1), 0);
  const first = terrain.findIndex((t) => t !== "rock");
  if (first < 0) return true;
  const seen = new Uint8Array(terrain.length);
  seen[first] = 1;
  const queue = [first];
  for (let head = 0; head < queue.length; head++) {
    for (const nb of board.neighbours[queue[head] as number] as readonly number[]) {
      if (!seen[nb] && terrain[nb] !== "rock") {
        seen[nb] = 1;
        queue.push(nb);
      }
    }
  }
  return queue.length === open;
}
