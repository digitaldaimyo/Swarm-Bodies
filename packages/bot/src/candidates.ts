import {
  defenseOf,
  entryCost,
  maxBiomassFor,
  playerRules,
  reachFor,
  type Colony,
  type Hex,
  type Order,
} from "@swarm/sim";
import type { Analysis, BodyAnalysis } from "./analysis";
import { generateSporeCandidates } from "./spores";

export type CandidateKind = "grow" | "assault" | "reinforce" | "fruit" | "launch";

export interface Candidate {
  kind: CandidateKind;
  orders: Order[];
  value: number;
  cost: number;
  /** Cells this candidate claims as new cells, as `${body}:${index}` (for conflict pre-checks). */
  claims: string[];
  /** Grow start cell key, if any. */
  start: string | null;
  /** Reinforced cell key, if any. */
  reinforces: string | null;
  /** Deterministic tie-break. */
  key: string;
}

export interface GenerateOptions {
  /** Easy ignores threats some turns: no reinforce candidates, no contest risk. */
  ignoreThreats: boolean;
  /** Easy never severs. */
  sever: boolean;
}

/** Chance an attack at this strength takes a cell with this defense, as the bot estimates it. */
function lossChance(threat: number, threatReinforced: number, defense: number): number {
  if (threat > defense) return 0.5;
  if (threatReinforced > defense) return 0.2;
  return 0;
}

/** What losing an own cell would cost us. */
function lossValue(a: Analysis, ba: BodyAnalysis, i: number, c: Colony): number {
  const w = a.weights;
  let v = w.cell * 2 + (ba.depositValue[i] as number) + (ba.myCut[i] as number) * w.sever;
  if (c.core) v += w.coreKill * ((a.cores.get(a.me) ?? 0) <= 1 ? 10 : 1);
  return v;
}

export function generateCandidates(a: Analysis, opts: GenerateOptions): Candidate[] {
  const out: Candidate[] = [];
  for (const ba of a.bodies) {
    generateReinforce(a, ba, opts, out);
    generatePaths(a, ba, opts, out);
  }
  generateSporeCandidates(a, opts, out);
  return out;
}

function generateReinforce(
  a: Analysis,
  ba: BodyAnalysis,
  opts: GenerateOptions,
  out: Candidate[],
): void {
  if (opts.ignoreThreats) return;
  const { state, me, weights } = a;
  const { body, board } = ba;
  const burns = body.type === "irradiated" && !playerRules(state, me).irradiationImmune;
  for (let i = 0; i < body.colony.length; i++) {
    const c = body.colony[i];
    if (!c || c.owner !== me || !c.connected) continue;
    const add = Math.min(
      playerRules(state, me).reinforceAmount,
      maxBiomassFor(state, c, body) - c.biomass,
    );
    if (add <= 0) continue;
    const h0 = board.cells[i] as Hex;
    // Irradiated bodies burn biomass-1 cells at the end of the turn (fresh ones get one turn's
    // grace): reinforcing them now is what keeps the body (SPEC §4.3).
    if (burns && c.biomass === 1 && !c.core) {
      out.push({
        kind: "reinforce",
        orders: [{ type: "reinforce", body: body.id, cell: { q: h0.q, r: h0.r } }],
        value: lossValue(a, ba, i, c) * weights.burn,
        cost: state.rules.reinforceCost,
        claims: [],
        start: null,
        reinforces: `${body.id}:${i}`,
        key: `rb:${body.id}:${i}`,
      });
      continue;
    }
    if ((ba.threatReinforced[i] as number) === 0) continue;
    const def = ba.defense[i] as number;
    const t = ba.threat[i] as number;
    const tr = ba.threatReinforced[i] as number;
    const saved = lossChance(t, tr, def) - lossChance(t, tr, def + add);
    if (saved <= 0) continue;
    const h = board.cells[i] as Hex;
    out.push({
      kind: "reinforce",
      orders: [{ type: "reinforce", body: body.id, cell: { q: h.q, r: h.r } }],
      value: weights.threat * saved * lossValue(a, ba, i, c),
      cost: state.rules.reinforceCost,
      claims: [],
      start: null,
      reinforces: `${body.id}:${i}`,
      key: `r:${body.id}:${i}`,
    });
  }
}

function generatePaths(
  a: Analysis,
  ba: BodyAnalysis,
  opts: GenerateOptions,
  out: Candidate[],
): void {
  const { state, me, weights: w } = a;
  const { body, board } = ba;
  const { colony } = body;
  const { rules } = state;
  const mine = playerRules(state, me);
  // Chemotaxis can stretch a path by its reach bonus when it ends on a deposit; the exact
  // limit is checked per path below.
  const reach =
    mine.growReach + (mine.mutations.includes("chemotaxis") ? rules.mutations.chemotaxisReach : 0);
  const flags = colony.map((c) => !!c?.connected);
  // Per-cell entry cost, reach and defense, computed once (they rebuild player rules each call).
  const costOf = new Array<number>(colony.length).fill(-1);
  const reachTo = new Array<number>(colony.length).fill(-1);
  const defenseAt = new Array<number>(colony.length).fill(-1);
  const cellCost = (t: number) =>
    (costOf[t] as number) >= 0
      ? (costOf[t] as number)
      : (costOf[t] = entryCost(state, body, t, me));
  const cellReach = (t: number) =>
    (reachTo[t] as number) >= 0
      ? (reachTo[t] as number)
      : (reachTo[t] = reachFor(state, body, t, me));
  const cellDefense = (t: number) =>
    (defenseAt[t] as number) >= 0
      ? (defenseAt[t] as number)
      : (defenseAt[t] = defenseOf(state, body, colony, flags, t));
  const enemyOwned = (i: number): Colony | null => {
    const c = colony[i];
    return c && c.owner !== me ? c : null;
  };

  for (let s = 0; s < colony.length; s++) {
    const start = colony[s];
    if (!start || start.owner !== me || !start.connected) continue;
    const nbs = board.neighbours[s] as readonly number[];
    if (!nbs.some((n) => body.terrain[n] !== "rock" && colony[n]?.owner !== me)) continue;

    const touchesEnemy = nbs.some((n) => enemyOwned(n) !== null);
    const boost = Math.min(mine.reinforceAmount, maxBiomassFor(state, start, body) - start.biomass);
    const variants = touchesEnemy && boost > 0 ? [0, boost] : [0];

    for (const extra of variants) {
      const path: number[] = [s];
      const claimed = new Set<number>();
      let hasCapture = false;

      const visit = (feederIdx: number, feederB: number, value: number, cost: number): void => {
        for (const t of board.neighbours[feederIdx] as readonly number[]) {
          if (body.terrain[t] === "rock" || colony[t]?.owner === me || claimed.has(t) || t === s)
            continue;

          let attack = feederB;
          for (const n of board.neighbours[t] as readonly number[]) {
            if (n !== feederIdx && (colony[n]?.owner === me || claimed.has(n))) attack++;
          }
          const defender = colony[t] ?? null;
          let gain: number;
          let newB: number;
          let capture = false;
          if (!defender) {
            let rival = 0;
            if (!opts.ignoreThreats) {
              for (const n of board.neighbours[t] as readonly number[]) {
                const e = enemyOwned(n);
                if (!e || !e.connected) continue;
                let adj = 0;
                for (const m of board.neighbours[t] as readonly number[])
                  if (colony[m]?.owner === e.owner) adj++;
                rival = Math.max(rival, e.biomass + adj - 1);
              }
            }
            const risk = rival >= attack ? w.contestRisk : 1;
            gain = (w.cell + (ba.depositValue[t] as number)) * risk;
            newB = rules.newCellBiomass;
          } else {
            const defense = cellDefense(t);
            attack += mine.assaultBonus;
            if (attack <= defense) continue; // The path would halt here.
            capture = true;
            newB = Math.min(mine.maxBiomass, attack - defense);
            gain = w.cell + w.capture + (ba.depositValue[t] as number) * 1.5;
            // Predator: a capture pays the defender's biomass in N.
            if (mine.captureFeeds) gain += defender.biomass * w.feed;
            if (opts.sever) gain += (ba.enemyCut[t] as number) * w.sever;
            if (defender.core)
              gain += w.coreKill * ((a.cores.get(defender.owner) ?? 0) <= 1 ? 10 : 1);
          }

          path.push(t);
          claimed.add(t);
          const v = value + gain;
          const c = cost + cellCost(t);
          const wasCapture = hasCapture;
          hasCapture = hasCapture || capture;
          // A boosted variant only makes sense if it enables an assault.
          if ((extra === 0 || hasCapture) && path.length - 1 <= cellReach(t))
            out.push(makePath(a, ba, path, v, c, extra, capture || wasCapture));
          if (path.length - 1 < reach) visit(t, newB, v, c);
          hasCapture = wasCapture;
          claimed.delete(t);
          path.pop();
        }
      };
      visit(s, start.biomass + extra, 0, 0);
    }
  }
}

function makePath(
  a: Analysis,
  ba: BodyAnalysis,
  path: readonly number[],
  value: number,
  cost: number,
  boost: number,
  assault: boolean,
): Candidate {
  const { body, board } = ba;
  const s = path[0] as number;
  const end = path[path.length - 1] as number;
  const progress = Math.max(0, (ba.potential[end] as number) - (ba.potential[s] as number));
  const hexes = path.map((i) => {
    const h = board.cells[i] as Hex;
    return { q: h.q, r: h.r };
  });
  const orders: Order[] = [{ type: "grow", body: body.id, path: hexes }];
  let total = value + a.weights.potential * progress;
  let price = cost;
  if (boost > 0) {
    orders.unshift({ type: "reinforce", body: body.id, cell: hexes[0] as Hex });
    price += a.state.rules.reinforceCost;
    total += 0.5 * a.weights.cell; // A thicker frontline cell is worth a little on its own.
  }
  return {
    kind: assault ? "assault" : "grow",
    orders,
    value: total,
    cost: price,
    claims: path.slice(1).map((i) => `${body.id}:${i}`),
    start: `${body.id}:${s}`,
    reinforces: boost > 0 ? `${body.id}:${s}` : null,
    key: `${boost > 0 ? "b" : "g"}:${body.id}:${path.join(",")}`,
  };
}
