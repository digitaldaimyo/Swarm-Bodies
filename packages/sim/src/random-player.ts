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
  // Pick from a pending draft three times in four; otherwise let the first option be assigned.
  // A separate stream keeps the rest of the player's choices independent of drafts.
  const draft = state.players.find((p) => p.id === player)?.draft;
  if (draft) {
    const d = rngStream(seed, `random-draft:${player}:${state.turn}`);
    if (d.int(4) > 0) orders.push({ type: "draft", mutation: d.pick(draft.options) });
  }
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
    } else if (roll < 75 && legal.launchers.length > 0) {
      // Launch a mature fruiting body at a random cell of a body in range, if any.
      const l = rng.pick(legal.launchers);
      if (l.targets.length === 0) continue;
      const target = state.bodies.find((b) => b.id === rng.pick(l.targets));
      if (!target) continue;
      const cell = getBoard(target.radius).cells[
        rng.int(getBoard(target.radius).cells.length)
      ] as Hex;
      order = {
        type: "launch",
        body: l.from.body,
        cell: { q: l.from.q, r: l.from.r },
        targetBody: target.id,
        targetCell: { q: cell.q, r: cell.r },
      };
    } else if (roll < 80 && legal.fruitTargets.length > 0) {
      const c = rng.pick(legal.fruitTargets);
      order = { type: "fruit", body: c.body, cell: { q: c.q, r: c.r } };
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
