import { Container, Graphics } from "pixi.js";
import { getBoard, rngStream, type Body, type Hex } from "@swarm/sim";
import { HEX_SIZE, hexCorners, hexToPixel, type Point } from "../game/layout";
import { BODY_TINT, DEPOSIT_COLORS } from "./palette";

/**
 * Procedural, seeded art (SPEC §10.4). No bitmaps: every shape is generated from the game seed,
 * so the same system always looks the same. The client may use floating point and trig freely;
 * only the sim is restricted.
 */

const TAU = Math.PI * 2;

/** Smooth closed noise around a circle: a few seeded sine harmonics. */
function edgeNoise(seed: string, name: string): (angle: number) => number {
  const rng = rngStream(seed, `art:${name}`);
  const harmonics = Array.from({ length: 5 }, (_, i) => ({
    k: i + 2 + rng.int(3),
    amp: (rng.int(1000) / 1000) * (0.5 / (i + 1)),
    phase: (rng.int(10000) / 10000) * TAU,
  }));
  return (a) => harmonics.reduce((s, h) => s + h.amp * Math.sin(h.k * a + h.phase), 0);
}

/** The body's rough outline, a little outside the hex disk so edge cells sit on rock. */
export function asteroidOutline(body: Body, seed: string): Point[] {
  const outer = (body.radius + 0.9) * HEX_SIZE * Math.sqrt(3);
  const noise = edgeNoise(seed, `edge:${body.id}`);
  const pts: Point[] = [];
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * TAU;
    const r = outer * (1 + 0.06 * noise(a));
    pts.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
  }
  return pts;
}

export function drawAsteroid(body: Body, seed: string): Container {
  const tint = BODY_TINT[body.type];
  const c = new Container();
  const outline = asteroidOutline(body, seed);
  const flat = outline.flatMap((p) => [p.x, p.y]);

  if (tint.glow !== null) {
    const glow = new Graphics();
    for (let i = 3; i >= 1; i--) {
      glow
        .poly(outline.map((p) => ({ x: p.x * (1 + i * 0.025), y: p.y * (1 + i * 0.025) })))
        .fill({ color: tint.glow, alpha: 0.06 });
    }
    c.addChild(glow);
  }

  const g = new Graphics();
  // Shadowed rim, body, and a lit face offset toward the star (top left).
  g.poly(flat).fill(tint.dark);
  g.poly(outline.map((p) => ({ x: p.x * 0.97 - 6, y: p.y * 0.97 - 6 }))).fill(tint.base);
  g.poly(outline.map((p) => ({ x: p.x * 0.7 - 30, y: p.y * 0.7 - 30 }))).fill({
    color: tint.rim,
    alpha: 0.08,
  });
  g.poly(flat).stroke({ width: 3, color: tint.rim, alpha: 0.35 });

  // Craters: darker bowls with a lit lower-right lip.
  const rng = rngStream(seed, `art:craters:${body.id}`);
  const outer = (body.radius + 0.5) * HEX_SIZE * Math.sqrt(3);
  for (let i = 0; i < 14 + body.radius; i++) {
    const a = (rng.int(10000) / 10000) * TAU;
    const d = Math.sqrt(rng.int(10000) / 10000) * outer * 0.9;
    const r = 6 + rng.int(28);
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    g.circle(x + r * 0.12, y + r * 0.12, r).fill({ color: tint.rim, alpha: 0.1 });
    g.circle(x, y, r).fill({ color: tint.dark, alpha: 0.45 });
  }
  // Grit.
  for (let i = 0; i < 260; i++) {
    const a = (rng.int(10000) / 10000) * TAU;
    const d = Math.sqrt(rng.int(10000) / 10000) * outer;
    g.circle(Math.cos(a) * d, Math.sin(a) * d, 0.8 + rng.int(20) / 10).fill({
      color: rng.int(2) ? tint.rim : tint.dark,
      alpha: 0.25,
    });
  }
  c.addChild(g);
  return c;
}

/** Hex outlines for every non-rock cell (faded in when zoomed, SPEC §10.4). */
export function drawGrid(body: Body): Graphics {
  const g = new Graphics();
  const board = getBoard(body.radius);
  board.cells.forEach((h, i) => {
    if (body.terrain[i] === "rock") return;
    g.poly(hexCorners(hexToPixel(h), HEX_SIZE - 0.5)).stroke({
      width: 1,
      color: 0xffffff,
      alpha: 0.18,
    });
  });
  return g;
}

export function drawTerrain(body: Body, seed: string): Graphics {
  const g = new Graphics();
  const board = getBoard(body.radius);
  const rng = rngStream(seed, `art:terrain:${body.id}`);
  const tint = BODY_TINT[body.type];
  board.cells.forEach((h, i) => {
    const p = hexToPixel(h);
    if (body.terrain[i] === "rock") {
      // A boulder: an irregular polygon with a lit top face.
      const pts: Point[] = [];
      const n = 7;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + rng.int(100) / 200;
        const r = HEX_SIZE * (0.72 + rng.int(25) / 100);
        pts.push({ x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r });
      }
      g.poly(pts).fill(0x1b1715).stroke({ width: 2, color: 0x0d0b0a });
      g.poly(
        pts.map((q) => ({ x: p.x + (q.x - p.x) * 0.6 - 3, y: p.y + (q.y - p.y) * 0.6 - 4 })),
      ).fill({
        color: tint.rim,
        alpha: 0.35,
      });
      return;
    }
    const d = body.deposits[i];
    if (!d) return;
    const color = DEPOSIT_COLORS[d];
    if (d === "ice") {
      // Crystal shards.
      for (let k = 0; k < 3; k++) {
        const a = -Math.PI / 2 + (k - 1) * 0.55;
        const len = HEX_SIZE * (0.55 + k * 0.1 - (k === 2 ? 0.25 : 0));
        const base = { x: p.x + (k - 1) * 5, y: p.y + 7 };
        const tip = { x: base.x + Math.cos(a) * len, y: base.y + Math.sin(a) * len };
        const nx = Math.cos(a + Math.PI / 2) * 3.5;
        const ny = Math.sin(a + Math.PI / 2) * 3.5;
        g.poly([base.x - nx, base.y - ny, tip.x, tip.y, base.x + nx, base.y + ny]).fill({
          color,
          alpha: 0.9,
        });
        g.poly([base.x, base.y, tip.x, tip.y, base.x + nx, base.y + ny]).fill({
          color: 0x8fd3f5,
          alpha: 0.7,
        });
      }
    } else if (d === "organic") {
      // Dark pods with a faint glow.
      g.circle(p.x, p.y, HEX_SIZE * 0.62).fill({ color, alpha: 0.18 });
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * TAU + 0.4;
        g.ellipse(p.x + Math.cos(a) * 6, p.y + Math.sin(a) * 6, 6, 4.5)
          .fill(0x1f3d22)
          .stroke({ width: 1.5, color, alpha: 0.9 });
      }
    } else {
      // Metallic flecks.
      for (let k = 0; k < 7; k++) {
        const x = p.x + (rng.int(200) / 10 - 10);
        const y = p.y + (rng.int(200) / 10 - 10);
        g.rect(x - 1.8, y - 1.8, 3.6, 3.6).fill({ color, alpha: 0.95 });
        g.rect(x - 0.6, y - 1.8, 1.2, 1.2).fill({ color: 0xffffff, alpha: 0.6 });
      }
    }
  });
  return g;
}

/** Parallax starfield (SPEC §10.4): two layers drawn once, moved with the camera. */
export function drawStars(seed: string, layer: number, extent: number): Graphics {
  const g = new Graphics();
  const rng = rngStream(seed, `art:stars:${layer}`);
  const count = layer === 0 ? 700 : 220;
  for (let i = 0; i < count; i++) {
    const x = rng.int(extent * 2) - extent;
    const y = rng.int(extent * 2) - extent;
    const r = layer === 0 ? 0.6 + rng.int(8) / 10 : 1 + rng.int(12) / 10;
    const tint = [0xffffff, 0xbcd4ff, 0xffe3c2][rng.int(3)] as number;
    g.circle(x, y, r).fill({ color: tint, alpha: 0.35 + rng.int(60) / 100 });
  }
  return g;
}

export function cellCenter(h: Hex): Point {
  return hexToPixel(h);
}
