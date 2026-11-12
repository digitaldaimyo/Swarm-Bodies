import {
  cellYield,
  defenseOf,
  fruitingCount,
  getBoard,
  hexDistance,
  inLaunchRange,
  playerRules,
  forecast,
  type Body,
  type Colony,
  type Hex,
} from "@swarm/sim";
import type { Analysis } from "./analysis";
import type { Candidate, GenerateOptions } from "./candidates";

/**
 * Spore play (SPEC §13.2): launch mature fruiting bodies toward bodies with a high unclaimed share
 * in range, and grow fruiting bodies when nutrients and biomass allow and a launch window is coming.
 */

/** Launch windows this far ahead make growing a fruiting body worthwhile now. */
const FORECAST_TURNS = 12;
/** A window k turns after maturity is worth this much less per turn of waiting. */
const WINDOW_DECAY = 0.9;

/** Hex offsets at distance 1–4, with their distance. */
const NEAR: readonly (readonly [number, number, number])[] = (() => {
  const out: [number, number, number][] = [];
  for (let dq = -4; dq <= 4; dq++)
    for (let dr = -4; dr <= 4; dr++) {
      const d = hexDistance({ q: 0, r: 0 }, { q: dq, r: dr });
      if (d >= 1 && d <= 4) out.push([dq, dr, d]);
    }
  return out;
})();

interface Landing {
  cell: Hex;
  value: number;
}

/** What a new core on `target` is worth to `me`, and the best cell to land it on. */
function bestLanding(a: Analysis, target: Body): Landing | null {
  const { state, me, weights: w } = a;
  const board = getBoard(target.radius);
  const mineRules = playerRules(state, me);
  const landing = mineRules.landingBiomass;
  const flags = target.colony.map((c) => !!c?.connected);
  let open = 0;
  let mine = 0;
  for (let i = 0; i < target.colony.length; i++) {
    if (target.terrain[i] === "rock") continue;
    const c = target.colony[i];
    if (!c) open++;
    else if (c.owner === me) mine++;
  }
  const playable = target.terrain.filter((t) => t !== "rock").length || 1;
  // Expansion value: unclaimed room, worth much less where we already have a foothold.
  const room = Math.min(open, 40) * w.expansion * (mine > 0 ? 0.25 : 1) * (open / playable + 0.5);
  const horizon = Math.max(1, Math.min(w.incomeHorizon, state.rules.turnLimit - state.turn));
  const incomeValue = mineRules.incomePerCore * horizon;

  let best: Landing | null = null;
  const yieldOf = (i: number) => {
    return cellYield(state, target, i, me);
  };
  for (let i = 0; i < target.colony.length; i++) {
    if (target.terrain[i] === "rock") continue;
    const c = target.colony[i] ?? null;
    const h = board.cells[i] as Hex;
    let enemyNear = 0;
    let depositNear = yieldOf(i) * 2;
    // Only cells within distance 4 matter: walk those offsets instead of the whole board.
    for (const [dq, dr, d] of NEAR) {
      const j = board.indexOf(h.q + dq, h.r + dr);
      if (j < 0) continue;
      const o = target.colony[j];
      if (o && o.owner !== me) enemyNear += d <= 2 ? 3 : 1;
      if (d <= 2 && !o) depositNear += yieldOf(j) * (d === 1 ? 1 : 0.5);
    }
    let value: number;
    if (!c) {
      value = incomeValue + room + depositNear * horizon * 0.3 - enemyNear * 4;
    } else if (c.owner === me) {
      continue; // Reinforcing our own cell by spore is rarely worth a launch.
    } else {
      // Capture: only when the landing beats the defense (no support from cut-off cells counted).
      const defense = defenseOf(state, target, target.colony, flags, i);
      if (landing <= defense) continue;
      value =
        incomeValue +
        room * 0.5 +
        w.capture +
        (c.core ? w.coreKill * ((a.cores.get(c.owner) ?? 0) <= 1 ? 10 : 1) : 0) -
        enemyNear * 2;
    }
    if (
      !best ||
      value > best.value ||
      (value === best.value && i < board.indexOf(best.cell.q, best.cell.r))
    ) {
      best = { cell: { q: h.q, r: h.r }, value };
    }
  }
  return best && best.value > 0 ? best : null;
}

export function generateSporeCandidates(
  a: Analysis,
  opts: GenerateOptions,
  out: Candidate[],
): void {
  const { state, me, weights: w } = a;
  if (state.bodies.filter((b) => b.orbit).length < 2) return;
  const landingCache = new Map<number, Landing | null>();
  const landingOn = (b: Body) => {
    if (!landingCache.has(b.id)) landingCache.set(b.id, bestLanding(a, b));
    return landingCache.get(b.id) ?? null;
  };

  // Launches: each mature fruiting body fires at the best body in range now.
  for (const body of state.bodies) {
    const board = getBoard(body.radius);
    body.colony.forEach((c, i) => {
      if (!c || c.owner !== me || c.fruiting !== 0) return;
      const h = board.cells[i] as Hex;
      for (const target of state.bodies) {
        if (!inLaunchRange(state, body, target, state.turn, me)) continue;
        const land = landingOn(target);
        if (!land) continue;
        out.push({
          kind: "launch",
          orders: [
            {
              type: "launch",
              body: body.id,
              cell: { q: h.q, r: h.r },
              targetBody: target.id,
              targetCell: land.cell,
            },
          ],
          value: land.value,
          cost: 0,
          claims: [`land:${target.id}:${land.cell.q},${land.cell.r}`],
          start: `launch:${body.id}:${i}`,
          reinforces: null,
          key: `l:${body.id}:${i}:${target.id}`,
        });
      }
    });
  }

  // Fruit: worth a share of the best launch the forecast says will open from that body soon.
  const ps = state.players.find((p) => p.id === me);
  const pr = playerRules(state, me);
  if (!ps || ps.nutrients < pr.fruitCost || fruitingCount(state, me) >= pr.maxFruiting) return;
  const windows = forecast(state, FORECAST_TURNS, me);
  const matureBy = state.turn + pr.fruitMatureTurns;
  for (const body of state.bodies) {
    // The best launch the forecast opens from this body once a launcher here could be ready,
    // discounted by how long it would wait.
    let prospect = 0;
    for (const f of windows) {
      if (f.turn < matureBy) continue;
      const wait = WINDOW_DECAY ** (f.turn - matureBy);
      for (const win of f.windows) {
        if (win.from !== body.id) continue;
        const land = landingOn(state.bodies.find((b) => b.id === win.to) as Body);
        prospect = Math.max(prospect, (land?.value ?? 0) * wait);
      }
    }
    if (prospect <= 0) continue;
    const ba = a.bodies.find((x) => x.body.id === body.id);
    const board = getBoard(body.radius);
    if (body.type === "irradiated") continue; // The launcher would burn away at biomass 1.
    // The sturdiest safe cell: not threatened, not on a deposit (it drops to biomass 1 on launch).
    // When none is strong enough yet, reinforce the best site toward fruitMinBiomass first.
    let pick: { i: number; score: number; ready: boolean } | null = null;
    const add = playerRules(state, me).reinforceAmount;
    body.colony.forEach((c: Colony | null, i) => {
      if (!c || c.owner !== me || c.core || !c.connected || c.fruiting !== null) return;
      if (c.biomass + add * 2 < state.rules.fruitMinBiomass) return;
      const ready = c.biomass >= state.rules.fruitMinBiomass;
      const threat = ba ? (ba.threat[i] as number) : 0;
      const score =
        (ready ? 100 : 0) + c.biomass - threat * 2 - (body.deposits[i] ? 3 : 0) - i / 1000;
      if (!pick || score > pick.score) pick = { i, score, ready };
    });
    if (!pick) continue;
    const site = pick as { i: number; score: number; ready: boolean };
    if (!site.ready) {
      const ph = board.cells[site.i] as Hex;
      out.push({
        kind: "reinforce",
        orders: [{ type: "reinforce", body: body.id, cell: { q: ph.q, r: ph.r } }],
        value: prospect * w.fruitFaith * 0.5,
        cost: state.rules.reinforceCost,
        claims: [],
        start: null,
        reinforces: `${body.id}:${site.i}`,
        key: `rf:${body.id}:${site.i}`,
      });
      continue;
    }
    const chosen = site;
    const h = board.cells[chosen.i] as Hex;
    out.push({
      kind: "fruit",
      orders: [{ type: "fruit", body: body.id, cell: { q: h.q, r: h.r } }],
      value: prospect * w.fruitFaith * (opts.ignoreThreats ? 0.8 : 1),
      cost: pr.fruitCost,
      claims: [],
      start: `fruit:${body.id}:${chosen.i}`,
      reinforces: null,
      key: `f:${body.id}:${chosen.i}`,
    });
  }
}
