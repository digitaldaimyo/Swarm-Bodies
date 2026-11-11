import { getBoard } from "./hex";
import type { Body, Colony } from "./types";

/**
 * Connectivity (SPEC §5.3 phase 8): a colony cell is connected if a path through same-owner
 * colony cells reaches a core of that owner on the same body. Cores are always connected.
 * Returns one flag per board cell (false for empty cells).
 */
export function connectivityOf(radius: number, colony: readonly (Colony | null)[]): boolean[] {
  const board = getBoard(radius);
  const connected = new Array<boolean>(colony.length).fill(false);
  const queue: number[] = [];
  for (let i = 0; i < colony.length; i++) {
    if (colony[i]?.core) {
      connected[i] = true;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] as number;
    const owner = (colony[i] as Colony).owner;
    for (const n of board.neighbours[i] as readonly number[]) {
      if (connected[n]) continue;
      const c = colony[n];
      if (c && c.owner === owner) {
        connected[n] = true;
        queue.push(n);
      }
    }
  }
  return connected;
}

/** Writes fresh `connected` flags into a body's colony cells (copy-on-write per cell). */
export function refreshConnectivity(body: Body): void {
  const flags = connectivityOf(body.radius, body.colony);
  for (let i = 0; i < body.colony.length; i++) {
    const c = body.colony[i];
    if (c && c.connected !== flags[i]) body.colony[i] = { ...c, connected: flags[i] as boolean };
  }
}
