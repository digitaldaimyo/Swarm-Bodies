import { resolveRules, type BodySize, type BodyType, type DepositKind, type Rules } from "./config";
import { refreshConnectivity } from "./connectivity";
import { getBoard, hexDistance, HEX_DIRECTIONS, type Board, type Hex } from "./hex";
import { idiv, permille } from "./math";
import { distanceScaled, distanceSquared } from "./orbit";
import { TRIG_SCALE } from "./trig";
import { rngStream, type Rng } from "./rng";
import type {
  Body,
  Colony,
  GameConfig,
  GameState,
  Orbit,
  PlayerState,
  ScheduledEvent,
  Terrain,
} from "./types";

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
    case "system":
      return createSystem(config, rules, seed);
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
    colony[idx(core)] = {
      owner: p,
      biomass: rules.startCoreBiomass,
      core: true,
      connected: true,
      fruiting: null,
      cut: 0,
    };
    for (const a of adjacent0) {
      colony[idx(flip(a))] = {
        owner: p,
        biomass: rules.startAdjacentBiomass,
        core: false,
        connected: true,
        fruiting: null,
        cut: 0,
      };
    }
    players.push({
      id: p,
      strain: config.strains?.[p] ?? "base",
      nutrients: rules.startNutrients,
      eliminated: false,
      eliminatedOnTurn: null,
      dominanceStreak: 0,
      home: { body: 0, cell: core },
      mutations: [],
      draft: null,
      draftsOffered: 0,
    });
  }

  const body: Body = {
    id: 0,
    size: "large",
    type: bodyType,
    radius,
    terrain,
    deposits,
    colony,
    orbit: null,
    home: null,
    comets: [],
  };
  refreshConnectivity(body);
  return {
    version: 1,
    seed,
    mode: "singleRock",
    rules,
    turn: 1,
    bodies: [body],
    players,
    spores: [],
    nextSporeId: 1,
    schedule: [],
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
  mirrored = true,
): void {
  const n = board.cells.length;
  const target = permille(n, rules.rockPermille);
  let count = 0;
  const canRock = (i: number): boolean =>
    i >= 0 &&
    terrain[i] === "regolith" &&
    eligible(i) &&
    (!mirrored || eligible(board.indexOf(-(board.cells[i] as Hex).q, -(board.cells[i] as Hex).r)));
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
      if (mirrored) cells.add(board.indexOf(-h.q, -h.r));
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

// ------------------------------------------------------------------------------------------
// Star systems (SPEC §4.1–4.5)

const SIZES: readonly BodySize[] = ["small", "medium", "large"];
const HOME_TYPES: readonly BodyType[] = ["carbonaceous", "icy"];

function createSystem(config: GameConfig, rules: Rules, seed: string): GameState {
  const players = config.playerCount;
  if (!Number.isInteger(players) || players < 2 || players > 4) {
    throw new Error(`A system supports 2–4 players, got ${players}`);
  }
  const rng = rngStream(seed, "system");
  // Normally at least one neutral body (homes are placed by their distance to the nearest one).
  const count = Math.max(
    players + rules.systemMinNeutrals,
    Math.min(
      rules.systemMaxBodies,
      Math.max(rules.systemMinBodies, players + rules.systemExtraBodies),
    ),
  );

  // Orbits: distinct radii, inner bodies first; wider orbits have longer periods. Layouts are
  // drawn until every home has early and regular launch windows to a neutral body (DECISIONS),
  // keeping the best one if none qualifies.
  const drawOrbits = (): Orbit[] => {
    const radii: number[] = [];
    for (let r = rules.orbitRadiusMin; r <= rules.orbitRadiusMax; r++) radii.push(r);
    const chosen = rng
      .shuffle(radii)
      .slice(0, count)
      .sort((a, b) => a - b);
    return chosen.map((radius) => {
      const span = rules.orbitPeriodMax - rules.orbitPeriodMin;
      const base =
        rules.orbitPeriodMin +
        idiv((radius - rules.orbitRadiusMin) * span, rules.orbitRadiusMax - rules.orbitRadiusMin);
      const period = Math.min(
        rules.orbitPeriodMax,
        Math.max(rules.orbitPeriodMin, base + rng.range(-1, 1)),
      );
      return { radius, period, phase: rng.int(360) };
    });
  };
  let orbits: Orbit[] = [];
  let homes: number[] = [];
  let bestScore = -Infinity;
  for (let attempt = 0; attempt < rules.orbitAttempts; attempt++) {
    const candidate = drawOrbits();
    const candidateHomes = chooseHomes(candidate, players);
    const { ok, score } = reachability(candidate, candidateHomes, rules);
    if (score > bestScore) {
      bestScore = score;
      orbits = candidate;
      homes = candidateHomes;
    }
    if (ok) break;
  }
  const bodies: Body[] = orbits.map((orbit, id) => {
    const owner = homes.indexOf(id);
    const isHome = owner >= 0;
    const size: BodySize = isHome ? "medium" : (SIZES[rng.int(SIZES.length)] as BodySize);
    const type: BodyType = isHome
      ? (HOME_TYPES[rng.int(HOME_TYPES.length)] as BodyType)
      : (rules.neutralBodyTypes[rng.int(rules.neutralBodyTypes.length)] as BodyType);
    return buildBody(seed, rules, id, size, type, orbit, isHome ? owner : null);
  });

  const playerStates: PlayerState[] = homes.map((bodyId, p) => ({
    id: p,
    strain: config.strains?.[p] ?? "base",
    nutrients: rules.startNutrients,
    eliminated: false,
    eliminatedOnTurn: null,
    dominanceStreak: 0,
    home: { body: bodyId, cell: { q: 0, r: 0 } },
    mutations: [],
    draft: null,
    draftsOffered: 0,
  }));

  return {
    version: 1,
    seed,
    mode: "system",
    rules,
    turn: 1,
    bodies,
    players: playerStates,
    spores: [],
    nextSporeId: 1,
    schedule: scheduleEvents(seed, rules, bodies.length),
    result: null,
  };
}

/**
 * How reachable the neutral bodies are from each home over the opening turns: a layout is
 * acceptable when every home has a window to some neutral body by `homeFirstWindowMax` and on
 * at least `homeWindowTurnsMin` of the first `windowHorizon` turns. The score is the worst
 * home's window count, so the best fallback layout is the fairest one.
 */
function reachability(
  orbits: readonly Orbit[],
  homes: readonly number[],
  rules: Rules,
): { ok: boolean; score: number } {
  const probe = orbits.map(probeBody);
  const range = rules.launchRange * TRIG_SCALE;
  let ok = true;
  let worst = Infinity;
  let latest = 0;
  for (const h of homes) {
    let first = Infinity;
    let turns = 0;
    for (let t = 1; t <= rules.windowHorizon; t++) {
      // Windows to a neutral body; with no neutrals (all homes), to any other body.
      const allHomes = homes.length === probe.length;
      const open = probe.some(
        (b) =>
          b.id !== h &&
          (allHomes || !homes.includes(b.id)) &&
          distanceSquared(probe[h] as Body, b, t) <= range * range,
      );
      if (open) {
        turns++;
        if (first === Infinity) first = t;
      }
    }
    if (first > rules.homeFirstWindowMax || turns < rules.homeWindowTurnsMin) ok = false;
    worst = Math.min(worst, turns);
    latest = Math.max(latest, first);
  }
  // Fairest fallback first: the home that waits longest for a window, then the scarcest windows.
  return { ok, score: -Math.min(latest, rules.windowHorizon + 1) * 100 + worst };
}

function probeBody(orbit: Orbit, id: number): Body {
  return {
    id,
    size: "small",
    type: "carbonaceous",
    radius: 0,
    terrain: [],
    deposits: [],
    colony: [],
    orbit,
    home: null,
    comets: [],
  };
}

/**
 * Picks the home bodies so each player's distance (at turn 1) to its nearest neutral body is as
 * equal as possible (SPEC §4.1). Every combination is tried; ties go to the first found.
 */
function chooseHomes(orbits: readonly Orbit[], players: number): number[] {
  // Every body a home (a tutorial two-body system): nothing to balance.
  if (orbits.length === players) return orbits.map((_, i) => i);
  const probe = orbits.map(probeBody);
  let best: number[] = [];
  let bestSpread = Infinity;
  const pick = (start: number, chosen: number[]): void => {
    if (chosen.length === players) {
      const nearest = chosen.map((h) => {
        let d = Infinity;
        for (const b of probe)
          if (!chosen.includes(b.id)) d = Math.min(d, distanceScaled(probe[h] as Body, b, 1));
        return d;
      });
      const spread = Math.max(...nearest) - Math.min(...nearest);
      if (spread < bestSpread) {
        bestSpread = spread;
        best = chosen.slice();
      }
      return;
    }
    for (let i = start; i < probe.length; i++) pick(i + 1, [...chosen, i]);
  };
  pick(0, []);
  return best;
}

/** One body's surface: rock clusters, deposits by type and, for a home, the start colony. */
function buildBody(
  seed: string,
  rules: Rules,
  id: number,
  size: BodySize,
  type: BodyType,
  orbit: Orbit,
  home: number | null,
): Body {
  const rng = rngStream(seed, `body:${id}`);
  const radius = rules.bodyRadius[size];
  const board = getBoard(radius);
  const n = board.cells.length;
  const terrain: Terrain[] = new Array<Terrain>(n).fill("regolith");
  const deposits: (DepositKind | null)[] = new Array<DepositKind | null>(n).fill(null);
  const colony: (Colony | null)[] = new Array<Colony | null>(n).fill(null);
  const idx = (h: Hex): number => board.indexOf(h.q, h.r);
  const origin: Hex = { q: 0, r: 0 };

  let startCells = new Set<number>();
  let protectedCell: (i: number) => boolean = () => false;
  if (home !== null) {
    const adjacent = rng
      .shuffle(HEX_DIRECTIONS.map((d) => ({ q: d.q, r: d.r })))
      .slice(0, rules.startAdjacentCells);
    startCells = new Set([origin, ...adjacent].map(idx));
    protectedCell = (i: number) => hexDistance(board.cells[i] as Hex, origin) <= 2;
    const candidates = board.cells
      .map((_, i) => i)
      .filter((i) => {
        const d = hexDistance(board.cells[i] as Hex, origin);
        return d >= 2 && d <= rules.homeGuaranteedDepositRange && !startCells.has(i);
      });
    const [organic, ice] = rng.shuffle(candidates);
    deposits[organic as number] = "organic";
    deposits[ice as number] = "ice";
    colony[idx(origin)] = {
      owner: home,
      biomass: rules.startCoreBiomass,
      core: true,
      connected: true,
      fruiting: null,
      cut: 0,
    };
    for (const a of adjacent) {
      colony[idx(a)] = {
        owner: home,
        biomass: rules.startAdjacentBiomass,
        core: false,
        connected: true,
        fruiting: null,
        cut: 0,
      };
    }
  }

  placeRock(board, rng, rules, terrain, (i) => !protectedCell(i) && deposits[i] === null, false);

  const mix = rules.depositMix[type];
  const weights = DEPOSIT_KINDS.map((k) => mix[k]);
  let target = permille(n, rules.depositPermille);
  if (type === "irradiated") target += permille(target, rules.irradiatedDepositBonusPermille);
  let placed = deposits.filter((d) => d !== null).length;
  for (const i of rng.shuffle(board.cells.map((_, i) => i))) {
    if (placed >= target) break;
    if (terrain[i] !== "regolith" || deposits[i] !== null || protectedCell(i)) continue;
    deposits[i] = DEPOSIT_KINDS[rng.weighted(weights)] as DepositKind;
    placed++;
  }

  const body: Body = { id, size, type, radius, terrain, deposits, colony, orbit, home, comets: [] };
  refreshConnectivity(body);
  return body;
}

/** Flares every 7–10 turns and comets every 10–14, through the turn limit (SPEC §8). */
function scheduleEvents(seed: string, rules: Rules, bodies: number): ScheduledEvent[] {
  const rng = rngStream(seed, "events");
  const out: ScheduledEvent[] = [];
  for (
    let t = rng.range(rules.flareEveryMin, rules.flareEveryMax);
    t <= rules.turnLimit;
    t += rng.range(rules.flareEveryMin, rules.flareEveryMax)
  ) {
    out.push({ kind: "flare", turn: t });
  }
  for (
    let t = rng.range(rules.cometEveryMin, rules.cometEveryMax);
    t <= rules.turnLimit;
    t += rng.range(rules.cometEveryMin, rules.cometEveryMax)
  ) {
    out.push({ kind: "comet", turn: t, body: rng.int(bodies) });
  }
  return out.sort((a, b) => a.turn - b.turn || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
}
