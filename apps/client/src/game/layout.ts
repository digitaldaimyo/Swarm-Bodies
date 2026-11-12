import type { Hex } from "@swarm/sim";

/** Pointy-top hex layout (SPEC §10.3: a cell is at least 32 px wide at default zoom). */
export const HEX_SIZE = 22; // centre-to-corner, in world px; width = √3 × 22 ≈ 38 px
const SQRT3 = Math.sqrt(3);

export interface Point {
  x: number;
  y: number;
}

export function hexToPixel(h: Hex, size = HEX_SIZE): Point {
  return { x: size * SQRT3 * (h.q + h.r / 2), y: size * 1.5 * h.r };
}

export function pixelToHex(p: Point, size = HEX_SIZE): Hex {
  const q = ((SQRT3 / 3) * p.x - p.y / 3) / size;
  const r = ((2 / 3) * p.y) / size;
  return cubeRound(q, r);
}

function cubeRound(fq: number, fr: number): Hex {
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q: q + 0, r: r + 0 };
}

/** The six corners of a hex, for outlines. */
export function hexCorners(center: Point, size = HEX_SIZE): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    out.push({ x: center.x + size * Math.cos(a), y: center.y + size * Math.sin(a) });
  }
  return out;
}

export const hexKey = (h: Hex): string => `${h.q},${h.r}`;
