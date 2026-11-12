import { getBoard, type Hex } from "./hex";
import { listLegalOrders } from "./legal";
import { rngStream } from "./rng";
import type { GameState, Order, OrderSet, PlayerId } from "./types";
import { validateOrder } from "./validate";

/**
 * A deterministic random-legal player: the baseline opponent for M1 balance runs, property tests
 * and golden replays. Every order it emits passes `validateOrder`.
 */
export function randomOrderSet(state: GameState, player: PlayerId, seed: string): OrderSet {
  const rng = rngStream(seed, `random:${player}:${state.turn}`);
  const legal = listLegalOrders(state, player);
  const orders: Order[] = [];
  if (legal.growStarts.length === 0) return orders;
  const wanted = rng.range(0, Math.min(legal.maxOrders, 6));
  for (let attempt = 0; attempt < wanted * 4 && orders.length < wanted; attempt++) {
    const roll = rng.int(100);
    let order: Order;
    if (roll < 70) {
      const s = rng.pick(legal.growStarts);
      const body = state.bodies.find((b) => b.id === s.body);
      if (!body) continue;
      const board = getBoard(body.radius);
      const path: Hex[] = [{ q: s.q, r: s.r }];
      const length = rng.range(1, legal.growReach);
      let at = board.indexOf(s.q, s.r);
      for (let k = 0; k < length; k++) {
        const options = (board.neighbours[at] as readonly number[]).filter((n) => {
          const h = board.cells[n] as Hex;
          return body.terrain[n] !== "rock" && !path.some((p) => p.q === h.q && p.r === h.r);
        });
        if (options.length === 0) break;
        at = rng.pick(options);
        const h = board.cells[at] as Hex;
        path.push({ q: h.q, r: h.r });
      }
      order = { type: "grow", body: s.body, path };
    } else if (roll < 92) {
      if (legal.reinforceTargets.length === 0) continue;
      const c = rng.pick(legal.reinforceTargets);
      order = { type: "reinforce", body: c.body, cell: { q: c.q, r: c.r } };
    } else {
      if (legal.retractTargets.length === 0) continue;
      const c = rng.pick(legal.retractTargets);
      order = { type: "retract", body: c.body, cell: { q: c.q, r: c.r } };
    }
    if (validateOrder(state, player, order, orders).ok) orders.push(order);
  }
  return orders;
}
