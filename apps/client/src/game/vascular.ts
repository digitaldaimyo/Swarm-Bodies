import { getBoard, type Colony } from "@swarm/sim";

/**
 * The supply tree of every colony on one body (colony life pass, phase 1): how each connected
 * cell is fed from a core. It is a breadth-first tree from the owner's cores through same-owner
 * cells, in board order, so it is deterministic and every cell's route to a core is shortest.
 *
 * Client presentation only: the sim's own connectivity decides the rules; this matches it
 * (a cell is in the tree exactly when the sim calls it connected) and adds shape.
 */
export interface Vascular {
  /** The cell each cell is fed from, or -1 for cores and cells outside the tree. */
  parent: Int32Array;
  /** Steps from the nearest core along the tree; -1 outside it. */
  depth: Int32Array;
  /** The core each cell is fed from (itself for a core); -1 outside the tree. */
  root: Int32Array;
  /** Cells that depend on each cell for supply, itself included (0 outside the tree). */
  load: Int32Array;
  /** Income (deposit and comet yield) that flows through each cell to its core. */
  income: Float64Array;
}

export function vascular(
  radius: number,
  colony: readonly (Colony | null)[],
  yieldOf: (cell: number, owner: number) => number = () => 0,
): Vascular {
  const board = getBoard(radius);
  const n = colony.length;
  const parent = new Int32Array(n).fill(-1);
  const depth = new Int32Array(n).fill(-1);
  const root = new Int32Array(n).fill(-1);
  const load = new Int32Array(n);
  const income = new Float64Array(n);
  const order: number[] = [];
  for (let i = 0; i < n; i++) {
    if (colony[i]?.core) {
      depth[i] = 0;
      root[i] = i;
      order.push(i);
    }
  }
  for (let h = 0; h < order.length; h++) {
    const i = order[h] as number;
    const owner = (colony[i] as Colony).owner;
    for (const j of board.neighbours[i] as readonly number[]) {
      if (depth[j] !== -1 || colony[j]?.owner !== owner) continue;
      depth[j] = (depth[i] as number) + 1;
      parent[j] = i;
      root[j] = root[i] as number;
      order.push(j);
    }
  }
  // Leaves first: each cell passes its load and income up to its parent.
  for (let h = order.length - 1; h >= 0; h--) {
    const i = order[h] as number;
    const c = colony[i] as Colony;
    load[i] = (load[i] as number) + 1;
    income[i] = (income[i] as number) + yieldOf(i, c.owner);
    const p = parent[i] as number;
    if (p >= 0) {
      load[p] = (load[p] as number) + (load[i] as number);
      income[p] = (income[p] as number) + (income[i] as number);
    }
  }
  return { parent, depth, root, load, income };
}

/** Whether the vein between adjacent cells a and b is a supply-tree vein (a trunk). */
export function isTrunk(v: Vascular, a: number, b: number): boolean {
  return v.parent[a] === b || v.parent[b] === a;
}

/** The load a trunk between a and b carries: the cells fed through it. */
export function trunkLoad(v: Vascular, a: number, b: number): number {
  return v.parent[a] === b ? (v.load[a] as number) : (v.load[b] as number);
}

/** Vessel width in world px for a trunk carrying `load` cells: thin at the tips, thick inward. */
export function vesselWidth(load: number): number {
  return Math.min(5.5, 1.2 + 1.1 * Math.log2(1 + load));
}
