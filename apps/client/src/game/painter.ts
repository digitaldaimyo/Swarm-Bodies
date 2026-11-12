import { hexDistance, HEX_DIRECTIONS, type Hex } from "@swarm/sim";
import { hexToPixel, type Point } from "./layout";

/**
 * Turns a finger drag into a Grow path (SPEC §10.2–10.3). The path snaps to hex adjacency and
 * tolerates imprecise fingers: when the finger jumps past the tip, the painter walks toward it
 * one adjacent cell at a time, choosing the neighbour along the drag direction. Moving back
 * over the path trims it.
 */
export class PathPainter {
  readonly path: Hex[];

  constructor(
    start: Hex,
    private readonly passable: (h: Hex) => boolean,
    private readonly reach: number,
  ) {
    this.path = [start];
  }

  get tip(): Hex {
    return this.path[this.path.length - 1] as Hex;
  }

  /** Length in steps, not counting the start cell. */
  get length(): number {
    return this.path.length - 1;
  }

  /** Follows the finger to `target` (the hex under it). Returns the number of cells added. */
  update(target: Hex, pointer?: Point): number {
    const before = this.path.length;
    const back = this.path.findIndex((h) => h.q === target.q && h.r === target.r);
    if (back >= 0) {
      this.path.length = back + 1;
      return 0;
    }
    const tip = this.tip;
    if (tip.q === target.q && tip.r === target.r) return 0;
    const route = this.route(tip, target, pointer ?? hexToPixel(target));
    if (route) {
      this.path.push(...route);
    } else {
      // Out of reach: walk straight toward the finger until the reach runs out.
      while (this.length < this.reach) {
        const at = this.tip;
        const step = this.neighbours(at, pointer ?? hexToPixel(target)).find(
          (n) => hexDistance(n, target) < hexDistance(at, target),
        );
        if (!step) break;
        this.path.push(step);
      }
    }
    return this.path.length - before;
  }

  /** Passable neighbours not already on the path, nearest the finger first. */
  private neighbours(h: Hex, aim: Point, extra: readonly Hex[] = []): Hex[] {
    const taken = (n: Hex) => [...this.path, ...extra].some((x) => x.q === n.q && x.r === n.r);
    return HEX_DIRECTIONS.map((d) => ({ q: h.q + d.q, r: h.r + d.r }))
      .filter((n) => this.passable(n) && !taken(n))
      .map((n) => {
        const p = hexToPixel(n);
        return { n, d: (p.x - aim.x) ** 2 + (p.y - aim.y) ** 2 };
      })
      .sort((a, b) => a.d - b.d)
      .map((x) => x.n);
  }

  /** Shortest route from the tip to `target` within the remaining reach (breadth-first). */
  private route(from: Hex, target: Hex, aim: Point): Hex[] | null {
    const budget = this.reach - this.length;
    let frontier: Hex[][] = [[]];
    for (let depth = 0; depth < budget; depth++) {
      const next: Hex[][] = [];
      for (const trail of frontier) {
        const at = trail[trail.length - 1] ?? from;
        for (const n of this.neighbours(at, aim, trail)) {
          const extended = [...trail, n];
          if (n.q === target.q && n.r === target.r) return extended;
          next.push(extended);
        }
      }
      frontier = next;
    }
    return null;
  }
}
