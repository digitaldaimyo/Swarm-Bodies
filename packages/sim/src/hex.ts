/** Axial hex grid helpers (SPEC §4.2). */

export interface Hex {
  readonly q: number;
  readonly r: number;
}

/** The six axial neighbour offsets, in a fixed order. */
export const HEX_DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function hexLength(h: Hex): number {
  return (Math.abs(h.q) + Math.abs(h.r) + Math.abs(h.q + h.r)) / 2;
}

export function hexEquals(a: Hex, b: Hex): boolean {
  return a.q === b.q && a.r === b.r;
}

export function areAdjacent(a: Hex, b: Hex): boolean {
  return hexDistance(a, b) === 1;
}

/**
 * The static layout of a hex disk of radius R: every cell with distance <= R from the centre,
 * in canonical order (by r, then q), plus precomputed neighbour indices.
 */
export interface Board {
  readonly radius: number;
  readonly cells: readonly Hex[];
  /** neighbours[i] lists indices of in-board neighbours of cell i, in HEX_DIRECTIONS order. */
  readonly neighbours: readonly (readonly number[])[];
  indexOf(q: number, r: number): number;
}

const boardCache = new Map<number, Board>();

export function getBoard(radius: number): Board {
  const cached = boardCache.get(radius);
  if (cached) return cached;
  const cells: Hex[] = [];
  for (let r = -radius; r <= radius; r++) {
    for (let q = -radius; q <= radius; q++) {
      if (hexLength({ q, r }) <= radius) cells.push({ q, r });
    }
  }
  const side = 2 * radius + 1;
  const lookup = new Int32Array(side * side).fill(-1);
  cells.forEach((c, i) => {
    lookup[(c.r + radius) * side + (c.q + radius)] = i;
  });
  const indexOf = (q: number, r: number): number => {
    if (q < -radius || q > radius || r < -radius || r > radius) return -1;
    return lookup[(r + radius) * side + (q + radius)] ?? -1;
  };
  const neighbours = cells.map((c) =>
    HEX_DIRECTIONS.map((d) => indexOf(c.q + d.q, c.r + d.r)).filter((i) => i >= 0),
  );
  const board: Board = { radius, cells, neighbours, indexOf };
  boardCache.set(radius, board);
  return board;
}

/** Number of cells in a hex disk of radius R: 3R(R+1) + 1. */
export function diskCellCount(radius: number): number {
  return 3 * radius * (radius + 1) + 1;
}
