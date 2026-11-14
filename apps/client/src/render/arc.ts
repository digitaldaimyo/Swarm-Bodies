/**
 * Points along a circular arc, for stroking as one open polyline.
 *
 * Pixi's `moveTo(start).arc(...)` puts the move point and the arc's own first point on top of
 * each other (equal up to float noise), so the stroke begins with a near-zero-length segment.
 * Its direction is noise, and the round cap or join built on it can stick out as a stray line
 * on some GPUs (playtest). These points have no duplicates, so every segment has a real
 * direction.
 */
export function arcPoints(
  cx: number,
  cy: number,
  r: number,
  start: number,
  end: number,
  /** Longest segment in px: short enough to look round at any zoom we use. */
  step = 3,
): number[] {
  const sweep = end - start;
  if (!(Math.abs(sweep) > 1e-6) || !(r > 0)) return [];
  const n = Math.max(2, Math.ceil((Math.abs(sweep) * r) / step));
  const pts: number[] = [];
  for (let k = 0; k <= n; k++) {
    const a = start + (sweep * k) / n;
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return pts;
}
