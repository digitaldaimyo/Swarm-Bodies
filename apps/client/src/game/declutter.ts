import type { Point } from "./layout";

/** A disc to place: its true centre and the radius it needs clear (ring and label included). */
export interface Disc {
  x: number;
  y: number;
  r: number;
}

/**
 * Display positions for discs so none overlap (System view, playtest: bodies on neighbouring
 * orbits piled on top of each other). Overlapping pairs are pushed apart along the line between
 * them, a little at a time, until every pair clears by `gap`; discs that do not overlap stay
 * exactly where they are. Deterministic: same input, same layout. A pair at the very same point
 * is split along the line from `centre`, the outer one outward.
 */
export function declutter(discs: readonly Disc[], centre: Point, gap = 4, passes = 40): Point[] {
  const p = discs.map((d) => ({ x: d.x, y: d.y }));
  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        const a = p[i] as Point;
        const b = p[j] as Point;
        const need = (discs[i] as Disc).r + (discs[j] as Disc).r + gap;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= need - 1e-6) continue;
        if (d < 1e-6) {
          // Coincident: split radially, keeping the farther-out true orbit outward.
          const ri = Math.hypot((discs[i] as Disc).x - centre.x, (discs[i] as Disc).y - centre.y);
          const rj = Math.hypot((discs[j] as Disc).x - centre.x, (discs[j] as Disc).y - centre.y);
          let ux = a.x - centre.x;
          let uy = a.y - centre.y;
          const ul = Math.hypot(ux, uy);
          if (ul < 1e-6) [ux, uy] = [0, 1];
          else [ux, uy] = [ux / ul, uy / ul];
          const s = rj >= ri ? 1 : -1;
          dx = ux * s;
          dy = uy * s;
          const half = need / 2;
          a.x -= dx * half;
          a.y -= dy * half;
          b.x += dx * half;
          b.y += dy * half;
        } else {
          // Each moves half the overlap, plus a hair so the pass converges.
          const half = (need - d) / 2 + 0.01;
          a.x -= (dx / d) * half;
          a.y -= (dy / d) * half;
          b.x += (dx / d) * half;
          b.y += (dy / d) * half;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  return p;
}
