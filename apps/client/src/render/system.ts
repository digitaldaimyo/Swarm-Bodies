import { Container, Graphics, Text } from "pixi.js";
import {
  bodyPosition,
  inLaunchRange,
  launchRangeFor,
  TRIG_SCALE,
  type Body,
  type GameState,
  type PlayerId,
} from "@swarm/sim";
import type { Point } from "../game/layout";
import { BODY_TINT, lighten, playerColor, trailColor } from "./palette";

/**
 * System view (SPEC §10.2): the star, orbits, bodies with ownership rings, launch range and
 * spores in flight. Drawn in screen space and refitted on resize; tap a body to open it.
 */

export interface SystemOptions {
  viewer: PlayerId;
  /** The body Body view shows; drawn with a selection ring. */
  selected: number;
  /** Launch flow (SPEC §10.2): only bodies in range of this one can be picked. */
  launchFrom: number | null;
  /** Bodies with off-screen action this turn, for alert dots. */
  alerts: ReadonlySet<number>;
}

export interface BodyShare {
  /** Cells per player on the body. */
  owners: Map<PlayerId, number>;
  playable: number;
}

export function bodyShares(body: Body): BodyShare {
  const owners = new Map<PlayerId, number>();
  let playable = 0;
  body.colony.forEach((c, i) => {
    if (body.terrain[i] !== "rock") playable++;
    if (c) owners.set(c.owner, (owners.get(c.owner) ?? 0) + 1);
  });
  return { owners, playable };
}

/** Contested: two or more players hold cells there (SPEC §10.2 alert dots). */
export function contested(body: Body): boolean {
  return bodyShares(body).owners.size >= 2;
}

const BODY_PX = { small: 11, medium: 15, large: 19 } as const;
const TAU = Math.PI * 2;

export class SystemLayer {
  readonly root = new Container();
  private readonly orbits = new Graphics();
  private readonly star = new Graphics();
  private readonly range = new Graphics();
  private readonly bodiesG = new Graphics();
  private readonly spores = new Graphics();
  private readonly labels = new Container();
  private state: GameState | null = null;
  private opts: SystemOptions | null = null;
  private centre: Point = { x: 0, y: 0 };
  private scale = 10;
  private screenPos = new Map<number, Point>();
  private time = 0;
  /** Spore motes and pickable rings are animated; the rest is redrawn on change only. */
  private motes: { from: Point; ctrl: Point; to: Point; t0: number; t1: number; color: number }[] =
    [];

  constructor() {
    this.root.addChild(this.orbits, this.star, this.range, this.spores, this.bodiesG, this.labels);
  }

  /** Lays out for a viewport, leaving `inset` px at the top and bottom for the HUD. */
  layout(w: number, h: number, inset: { top: number; bottom: number }): void {
    const usable = h - inset.top - inset.bottom;
    this.centre = { x: w / 2, y: inset.top + usable / 2 };
    const maxR = Math.max(4, ...(this.state?.bodies.map((b) => b.orbit?.radius ?? 0) ?? [12]));
    this.scale = (Math.min(w, usable) / 2 - 26) / (maxR + 0.6);
    this.redraw();
  }

  set(state: GameState, opts: SystemOptions): void {
    this.state = state;
    this.opts = opts;
    this.redraw();
  }

  position(body: Body, turn: number): Point {
    const p = bodyPosition(body, turn);
    return {
      x: this.centre.x + (p.x / TRIG_SCALE) * this.scale,
      y: this.centre.y + (p.y / TRIG_SCALE) * this.scale,
    };
  }

  /** The body under a screen point, if it is pickable. */
  bodyAt(p: Point): number | null {
    let best: { id: number; d: number } | null = null;
    for (const [id, q] of this.screenPos) {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < 30 && (!best || d < best.d) && this.pickable(id)) best = { id, d };
    }
    return best?.id ?? null;
  }

  pickable(id: number): boolean {
    const s = this.state;
    const o = this.opts;
    if (!s || !o) return false;
    if (o.launchFrom === null) return true;
    const from = s.bodies[o.launchFrom];
    const to = s.bodies[id];
    return !!from && !!to && inLaunchRange(s, from, to, s.turn, o.viewer);
  }

  private redraw(): void {
    const s = this.state;
    const o = this.opts;
    if (!s || !o) return;
    this.screenPos.clear();
    this.labels.removeChildren().forEach((c) => c.destroy());

    // Star: layered glow.
    this.star.clear();
    for (let k = 6; k >= 1; k--)
      this.star.circle(this.centre.x, this.centre.y, 6 + k * 5).fill({
        color: 0xffd27a,
        alpha: 0.05 + 0.02 * (6 - k),
      });
    this.star.circle(this.centre.x, this.centre.y, 10).fill(0xfff4d6);

    this.orbits.clear();
    for (const b of s.bodies) {
      if (!b.orbit) continue;
      this.orbits
        .circle(this.centre.x, this.centre.y, b.orbit.radius * this.scale)
        .stroke({ width: 1, color: 0x8ea2c8, alpha: 0.18 });
    }

    // Launch range around the launching body.
    this.range.clear();
    if (o.launchFrom !== null) {
      const from = s.bodies[o.launchFrom];
      if (from) {
        const p = this.position(from, s.turn);
        const r = launchRangeFor(s, o.viewer) * this.scale;
        this.range
          .circle(p.x, p.y, r)
          .fill({ color: playerColor(o.viewer), alpha: 0.07 })
          .stroke({ width: 1.5, color: playerColor(o.viewer), alpha: 0.5 });
      }
    }

    // Spores in flight: curved arcs from launch point to landing point (SPEC §10.4).
    this.motes = [];
    for (const sp of s.spores) {
      const from = s.bodies[sp.sourceBody];
      const to = s.bodies[sp.targetBody];
      if (!from || !to) continue;
      const a = this.position(from, sp.launchedTurn);
      const b = this.position(to, sp.arrivalTurn);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // Bulge away from the star so arcs read as trajectories, not chords.
      const out = { x: mid.x - this.centre.x, y: mid.y - this.centre.y };
      const len = Math.hypot(out.x, out.y) || 1;
      const bend = Math.hypot(b.x - a.x, b.y - a.y) * 0.25;
      const ctrl = { x: mid.x + (out.x / len) * bend, y: mid.y + (out.y / len) * bend };
      this.motes.push({
        from: a,
        ctrl,
        to: b,
        t0: sp.launchedTurn,
        t1: sp.arrivalTurn,
        color: trailColor(sp.owner),
      });
    }

    const g = this.bodiesG;
    g.clear();
    for (const b of s.bodies) {
      if (!b.orbit) continue;
      const p = this.position(b, s.turn);
      this.screenPos.set(b.id, p);
      const r = BODY_PX[b.size];
      const tint = BODY_TINT[b.type];
      const dim = !this.pickable(b.id);
      const alpha = dim ? 0.3 : 1;
      if (tint.glow !== null)
        g.circle(p.x, p.y, r + 5).fill({ color: tint.glow, alpha: 0.18 * alpha });
      g.circle(p.x, p.y, r).fill({ color: tint.base, alpha });
      g.circle(p.x - r * 0.25, p.y - r * 0.25, r * 0.45).fill({
        color: tint.rim,
        alpha: 0.35 * alpha,
      });
      // Ownership ring: one arc per player, by share of the body's cells.
      const { owners, playable } = bodyShares(b);
      let start = -Math.PI / 2;
      for (const [player, n] of [...owners].sort((x, y) => x[0] - y[0])) {
        const sweep = (TAU * n) / Math.max(1, playable);
        // arc() continues the current path: start a fresh one at the arc's first point.
        g.moveTo(p.x + Math.cos(start) * (r + 4), p.y + Math.sin(start) * (r + 4));
        g.arc(p.x, p.y, r + 4, start, start + Math.max(0.12, sweep)).stroke({
          width: 4,
          color: playerColor(player),
          alpha,
        });
        start += sweep;
      }
      if (b.id === o.selected)
        g.circle(p.x, p.y, r + 9).stroke({ width: 2, color: 0xffffff, alpha: 0.85 });
      if (o.alerts.has(b.id) || owners.size >= 2)
        g.circle(p.x + r + 4, p.y - r - 4, 4.5)
          .fill(0xff5a5a)
          .stroke({ width: 1.5, color: 0x070b1a });
      if (b.comets.length > 0) g.star(p.x - r - 6, p.y - r - 4, 5, 4, 2).fill(0xcdefff);
      const t = new Text({
        text: String(b.id + 1),
        style: {
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 12,
          fontWeight: "700",
          fill: dim ? 0x5d6782 : 0xdfe7ff,
        },
        resolution: 2,
      });
      t.anchor.set(0.5, 0);
      t.position.set(p.x, p.y + r + 7);
      this.labels.addChild(t);
    }
    this.drawSpores();
  }

  private drawSpores(): void {
    const s = this.state;
    if (!s) return;
    const g = this.spores;
    g.clear();
    const at = (m: (typeof this.motes)[number], t: number): Point => {
      const u = 1 - t;
      return {
        x: u * u * m.from.x + 2 * u * t * m.ctrl.x + t * t * m.to.x,
        y: u * u * m.from.y + 2 * u * t * m.ctrl.y + t * t * m.to.y,
      };
    };
    for (const m of this.motes) {
      // Dashed path ahead, glowing mote where the spore is now, short trail behind it.
      for (let k = 0; k <= 20; k++) {
        const q = at(m, k / 20);
        g.circle(q.x, q.y, 1.2).fill({ color: m.color, alpha: 0.35 });
      }
      const now = Math.min(1, Math.max(0, (s.turn - m.t0) / Math.max(1, m.t1 - m.t0)));
      const wobble = 0.03 * Math.sin(this.time * 2);
      for (let k = 6; k >= 0; k--) {
        const q = at(m, Math.max(0, now - k * 0.025 + wobble));
        g.circle(q.x, q.y, 4 - k * 0.45).fill({
          color: lighten(m.color, 0.5),
          alpha: 0.9 - k * 0.12,
        });
      }
    }
  }

  tick(dt: number): void {
    this.time += dt / 1000;
    if (this.motes.length > 0) this.drawSpores();
  }
}
