import { Graphics } from "pixi.js";
import type { PLAYER_PATTERNS } from "./palette";

/**
 * Colourblind pattern glyphs (SPEC §10.4): one per seat, drawn white on a 32 px tile and tinted
 * dark over each cell, so seats differ by shape as well as colour.
 */
export function drawPattern(kind: (typeof PLAYER_PATTERNS)[number]): Graphics {
  const g = new Graphics();
  const stroke = { width: 3.5, color: 0xffffff, cap: "round" as const };
  // A transparent square fixes the texture's bounds so every glyph centres the same way.
  g.rect(0, 0, 32, 32).fill({ color: 0xffffff, alpha: 0.001 });
  switch (kind) {
    case "stripes":
      g.moveTo(4, 18).lineTo(18, 4).moveTo(6, 26).lineTo(26, 6).moveTo(14, 28).lineTo(28, 14);
      g.stroke(stroke);
      break;
    case "dots":
      for (const [x, y] of [
        [10, 10],
        [22, 10],
        [16, 21],
      ] as const)
        g.circle(x, y, 3.6);
      g.fill(0xffffff);
      break;
    case "rings":
      g.circle(16, 16, 10).stroke(stroke).circle(16, 16, 4).stroke(stroke);
      break;
    case "crosshatch":
      g.moveTo(7, 7).lineTo(25, 25).moveTo(25, 7).lineTo(7, 25).stroke(stroke);
      g.moveTo(16, 4).lineTo(16, 28).moveTo(4, 16).lineTo(28, 16).stroke(stroke);
      break;
  }
  return g;
}
