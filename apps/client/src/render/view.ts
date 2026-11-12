import {
  Application,
  BitmapFont,
  BitmapText,
  Container,
  Graphics,
  Sprite,
  Text,
  type Texture,
} from "pixi.js";
import {
  getBoard,
  HEX_DIRECTIONS as HEX_DIRS,
  type Colony,
  type GameState,
  type Hex,
  type Order,
  type PlayerId,
} from "@swarm/sim";
import { HEX_SIZE, hexCorners, hexToPixel, pixelToHex, type Point } from "../game/layout";
import { PathPainter } from "../game/painter";
import type { StepPreview } from "../game/planner";
import type { Effect, Frame } from "../game/timeline";
import { drawAsteroid, drawGrid, drawStars, drawTerrain } from "./art";
import { desaturate, lighten, playerColor, SPACE } from "./palette";
import { SpritePool } from "./pool";

export interface ViewCallbacks {
  /** True if a drag starting on this cell should paint a Grow path. */
  canPaintFrom(h: Hex): boolean;
  passable(h: Hex): boolean;
  reach: number;
  onPaintStart(start: Hex): void;
  /** The painted path changed (cells added or trimmed). */
  onPaintChange(path: Hex[], added: number): void;
  onPaintEnd(path: Hex[] | null): void;
  onTap(h: Hex | null, screen: Point): void;
  onCamera?(): void;
}

export interface PaintOverlay {
  path: Hex[];
  preview: StepPreview[];
  valid: boolean;
  cost: number;
  player: PlayerId;
}

export interface ReplayControl {
  speed(): number;
  paused(): boolean;
  skipped(): boolean;
  reduceMotion: boolean;
}

const MIN_DRAG_PX = 8;
const NUMBERS_ZOOM = 1.45;

/** The match's Body view (SPEC §10.2): one asteroid, drawn and driven with PixiJS. */
export class MatchView {
  readonly app = new Application();
  private readonly stars: Graphics[] = [];
  private readonly world = new Container();
  private readonly goo = new Container();
  private readonly gooG = new Graphics();
  private readonly glowLayer = new Container();
  private readonly blobLayer = new Container();
  private readonly sheenLayer = new Container();
  private glowPool!: SpritePool;
  private blobPool!: SpritePool;
  private sheenPool!: SpritePool;
  private readonly flow = new Container();
  private readonly cores = new Container();
  private readonly numbers = new Container();
  private readonly planG = new Graphics();
  private readonly paintG = new Graphics();
  private readonly labels = new Container();
  private readonly fx = new Graphics();
  private readonly fxLabels = new Container();
  private readonly cursor = new Graphics();
  private grid: Graphics | null = null;
  private dot: Texture | null = null;

  private state!: GameState;
  private colony: (Colony | null)[] = [];
  private flowSprites: { sprite: Sprite; dist: number; connected: boolean }[] = [];
  private coreSprites: Graphics[] = [];
  private zoom = 1;
  private minZoom = 0.4;
  private readonly maxZoom = 2.6;
  private showNumbers = false;
  private longPress: ReturnType<typeof setTimeout> | null = null;
  private time = 0;
  private resizeObserver: ResizeObserver | null = null;
  private inputEnabled = true;
  private paintCancelled = false;
  private numbersDirty = true;
  reduceMotion = false;

  private constructor(private readonly cb: ViewCallbacks) {}

  /** Cached layers are rendered a little above screen density so zooming in stays crisp. */
  private get cacheResolution(): number {
    return Math.min(window.devicePixelRatio || 1, 2);
  }

  static async create(
    parent: HTMLElement,
    state: GameState,
    cb: ViewCallbacks,
  ): Promise<MatchView> {
    const v = new MatchView(cb);
    await v.app.init({
      resizeTo: parent,
      background: SPACE,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      preference: "webgl",
      powerPreference: "high-performance",
    });
    parent.appendChild(v.app.canvas);
    v.app.canvas.style.touchAction = "none";
    v.app.canvas.setAttribute("aria-label", "Asteroid surface. Drag from your colony to grow.");
    v.build(state);
    v.bindInput();
    v.resizeObserver = new ResizeObserver(() => v.fit(false));
    v.resizeObserver.observe(parent);
    v.app.ticker.add((t) => v.tick(t.deltaMS));
    return v;
  }

  private build(state: GameState): void {
    this.state = state;
    const body = state.bodies[0] as GameState["bodies"][number];
    for (const layer of [0, 1]) {
      const s = drawStars(state.seed, layer, 1400);
      this.stars.push(s);
      this.app.stage.addChild(s);
    }
    this.app.stage.addChild(this.world);
    // Static art is rendered once to a texture: each frame then draws one quad instead of
    // re-rasterising thousands of vertices (SPEC §10.7, 60 fps on mid-range phones).
    const ground = new Container();
    ground.addChild(drawAsteroid(body, state.seed), drawTerrain(body, state.seed));
    this.world.addChild(ground);
    ground.cacheAsTexture({ resolution: this.cacheResolution });
    this.grid = drawGrid(body);
    this.grid.alpha = 0;
    this.grid.visible = false;
    this.world.addChild(this.grid);
    this.grid.cacheAsTexture({ resolution: this.cacheResolution });

    // Colonies: thick round-capped veins and overlapping blobs merge into organic shapes
    // without a blur filter, which keeps phones at 60 fps (SPEC §10.4, §10.7).
    this.goo.addChild(this.glowLayer, this.gooG, this.blobLayer, this.sheenLayer);
    this.world.addChild(
      this.goo,
      this.flow,
      this.cores,
      this.planG,
      this.paintG,
      this.fx,
      this.numbers,
      this.labels,
      this.fxLabels,
      this.cursor,
    );

    const g = new Graphics()
      .circle(16, 16, 16)
      .fill({ color: 0xffffff, alpha: 0.25 })
      .circle(16, 16, 9)
      .fill(0xffffff);
    this.dot = this.app.renderer.generateTexture({ target: g, resolution: 2 });
    // Per-cell discs are sprites from pre-rendered textures, not tessellated circles.
    const disc = this.app.renderer.generateTexture({
      target: new Graphics().circle(32, 32, 32).fill(0xffffff),
      resolution: 2,
    });
    const halo = new Graphics();
    for (let k = 8; k >= 1; k--)
      halo.circle(32, 32, 32 * (k / 8)).fill({ color: 0xffffff, alpha: 0.09 });
    const soft = this.app.renderer.generateTexture({ target: halo, resolution: 2 });
    this.glowPool = new SpritePool(this.glowLayer, soft);
    this.blobPool = new SpritePool(this.blobLayer, disc);
    this.sheenPool = new SpritePool(this.sheenLayer, soft);
    BitmapFont.install({
      name: "swarm-numbers",
      style: {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 28,
        fontWeight: "700",
        fill: 0xffffff,
        stroke: { color: 0x000000, width: 5 },
      },
      chars: [["0", "9"], "+-N? "],
      resolution: 2,
    });
    this.setBoard(body.colony, state);
    this.fit(true);
  }

  // ---------------------------------------------------------------------------------------
  // Camera

  private get screen(): { w: number; h: number } {
    return { w: this.app.screen.width, h: this.app.screen.height };
  }

  /** Recomputes the zoom range; on first fit, centres on the viewer's home core. */
  private fit(initial: boolean, home?: Hex): void {
    const body = this.state.bodies[0] as GameState["bodies"][number];
    const span = (body.radius + 1.2) * HEX_SIZE * Math.sqrt(3) * 2;
    const { w, h } = this.screen;
    this.minZoom = Math.min(1, Math.min(w, h) / span);
    if (initial) {
      this.zoom = 1;
      const me = this.state.players[0]?.home.cell ?? home ?? { q: 0, r: 0 };
      const p = hexToPixel(me);
      // Frame the home core, nudged toward the centre of the body.
      this.centerWorld({ x: p.x * 0.55, y: p.y * 0.55 });
    }
    this.clampCamera();
  }

  private centerWorld(p: Point): void {
    const { w, h } = this.screen;
    this.world.scale.set(this.zoom);
    this.world.position.set(w / 2 - p.x * this.zoom, h / 2 - p.y * this.zoom);
    this.clampCamera();
  }

  private clampCamera(): void {
    const body = this.state.bodies[0] as GameState["bodies"][number];
    const extent = (body.radius + 1) * HEX_SIZE * Math.sqrt(3) * this.zoom;
    const { w, h } = this.screen;
    const clamp = (v: number, c: number) => Math.min(c + extent, Math.max(c - extent, v));
    this.world.position.set(
      clamp(this.world.position.x, w / 2),
      clamp(this.world.position.y, h / 2),
    );
    this.world.scale.set(this.zoom);
    for (const [i, s] of this.stars.entries()) {
      const f = i === 0 ? 0.08 : 0.2;
      s.position.set(
        w / 2 + (this.world.position.x - w / 2) * f,
        h / 2 + (this.world.position.y - h / 2) * f,
      );
    }
    if (this.grid) {
      this.grid.alpha = Math.max(0, Math.min(0.9, (this.zoom - 1.15) / 0.6));
      this.grid.visible = this.grid.alpha > 0;
    }
    const numbers = this.zoom >= NUMBERS_ZOOM || this.showNumbers;
    this.numbers.visible = numbers;
    if (numbers) this.rebuildNumbers();
    this.cb.onCamera?.();
  }

  private zoomAt(factor: number, screenPt: Point): void {
    const before = this.screenToWorld(screenPt);
    this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
    this.world.scale.set(this.zoom);
    this.world.position.set(screenPt.x - before.x * this.zoom, screenPt.y - before.y * this.zoom);
    this.clampCamera();
  }

  zoomBy(factor: number): void {
    const { w, h } = this.screen;
    this.zoomAt(factor, { x: w / 2, y: h / 2 });
  }

  /** Zoom out to the whole body (pinch-out equivalent). */
  showWholeBody(): void {
    this.zoom = this.minZoom;
    this.centerWorld({ x: 0, y: 0 });
  }

  centerOn(h: Hex): void {
    this.centerWorld(hexToPixel(h));
  }

  screenToWorld(p: Point): Point {
    return {
      x: (p.x - this.world.position.x) / this.zoom,
      y: (p.y - this.world.position.y) / this.zoom,
    };
  }

  worldToScreen(h: Hex): Point {
    const p = hexToPixel(h);
    return {
      x: p.x * this.zoom + this.world.position.x,
      y: p.y * this.zoom + this.world.position.y,
    };
  }

  hexAt(screen: Point): Hex | null {
    const h = pixelToHex(this.screenToWorld(screen));
    const body = this.state.bodies[0] as GameState["bodies"][number];
    return getBoard(body.radius).indexOf(h.q, h.r) >= 0 ? h : null;
  }

  get cameraZoom(): number {
    return this.zoom;
  }

  // ---------------------------------------------------------------------------------------
  // Input (SPEC §10.3): one finger paints from own cells or pans; two fingers pinch and pan.

  setInputEnabled(on: boolean): void {
    this.inputEnabled = on;
    if (!on) this.cursor.clear();
  }

  private bindInput(): void {
    const canvas = this.app.canvas;
    const pointers = new Map<number, Point>();
    let mode: "none" | "pending" | "paint" | "pan" | "pinch" = "none";
    let downAt: Point = { x: 0, y: 0 };
    let downHex: Hex | null = null;
    let lastPan: Point = { x: 0, y: 0 };
    let pinch: { dist: number; mid: Point } | null = null;
    let painter: PathPainter | null = null;

    const local = (e: PointerEvent): Point => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const cancelLongPress = () => {
      if (this.longPress) clearTimeout(this.longPress);
      this.longPress = null;
      if (this.showNumbers) {
        this.showNumbers = false;
        this.clampCamera();
      }
    };
    const endPaint = (commit: boolean) => {
      if (painter) {
        const keep = commit && !this.paintCancelled && painter.length > 0;
        this.cb.onPaintEnd(keep ? painter.path.slice() : null);
      }
      painter = null;
    };

    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) {
        endPaint(false);
        cancelLongPress();
        const [a, b] = [...pointers.values()] as [Point, Point];
        pinch = {
          dist: Math.hypot(a.x - b.x, a.y - b.y),
          mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        };
        mode = "pinch";
        return;
      }
      downAt = p;
      lastPan = p;
      downHex = this.hexAt(p);
      mode = e.button === 2 ? "pan" : "pending";
      if (mode === "pending") {
        this.longPress = setTimeout(() => {
          if (mode === "pending") {
            this.showNumbers = true;
            this.clampCamera();
          }
        }, 450);
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      const p = local(e);
      if (e.pointerType === "mouse" && pointers.size === 0) {
        this.drawCursor(this.inputEnabled ? this.hexAt(p) : null);
        return;
      }
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, p);
      if (mode === "pinch" && pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()] as [Point, Point];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this.world.position.set(
          this.world.position.x + mid.x - pinch.mid.x,
          this.world.position.y + mid.y - pinch.mid.y,
        );
        this.zoomAt(dist / Math.max(1, pinch.dist), mid);
        pinch = { dist, mid };
        return;
      }
      if (mode === "pending" && Math.hypot(p.x - downAt.x, p.y - downAt.y) > MIN_DRAG_PX) {
        cancelLongPress();
        if (this.inputEnabled && downHex && this.cb.canPaintFrom(downHex)) {
          mode = "paint";
          this.paintCancelled = false;
          painter = new PathPainter(downHex, (h) => this.cb.passable(h), this.cb.reach);
          this.cb.onPaintStart(downHex);
        } else {
          mode = "pan";
        }
      }
      if (mode === "paint" && painter && !this.paintCancelled) {
        this.drawCursor(this.hexAt(p));
        const target = this.hexAt(p);
        if (target) {
          const before = painter.path.length;
          const added = painter.update(target, this.screenToWorld(p));
          if (added > 0 || painter.path.length !== before)
            this.cb.onPaintChange(painter.path.slice(), added);
        }
      } else if (mode === "pan") {
        this.world.position.set(
          this.world.position.x + p.x - lastPan.x,
          this.world.position.y + p.y - lastPan.y,
        );
        lastPan = p;
        this.clampCamera();
      }
    });
    const up = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      cancelLongPress();
      if (mode === "pinch") {
        if (pointers.size === 0) mode = "none";
        else {
          // Continue as a pan with the remaining finger.
          mode = "pan";
          lastPan = [...pointers.values()][0] as Point;
        }
        pinch = null;
        return;
      }
      if (mode === "pending" && e.type === "pointerup") {
        this.cb.onTap(this.inputEnabled ? downHex : null, local(e));
      }
      if (mode === "paint") endPaint(e.type === "pointerup");
      if (e.pointerType !== "mouse") this.cursor.clear();
      mode = "none";
    };
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        this.zoomAt(Math.exp(-e.deltaY * 0.0015), { x: e.clientX - r.left, y: e.clientY - r.top });
      },
      { passive: false },
    );
  }

  /** Cancels an in-progress paint from outside (Esc); the lift that follows commits nothing. */
  cancelPaint(): void {
    this.paintCancelled = true;
    this.paintG.clear();
    this.labels.removeChildren().forEach((c) => c.destroy());
  }

  private drawCursor(h: Hex | null): void {
    this.cursor.clear();
    if (!h) return;
    this.cursor
      .poly(hexCorners(hexToPixel(h), HEX_SIZE - 1))
      .stroke({ width: 2, color: 0xffffff, alpha: 0.5 });
  }

  // ---------------------------------------------------------------------------------------
  // Board

  setState(state: GameState): void {
    this.state = state;
    this.setBoard((state.bodies[0] as GameState["bodies"][number]).colony, state);
  }

  /** Redraws colonies from a colony array (the live state or a replay frame). */
  setBoard(colony: readonly (Colony | null)[], state = this.state): void {
    this.colony = colony.slice();
    const body = state.bodies[0] as GameState["bodies"][number];
    const board = getBoard(body.radius);
    const g = this.gooG;
    g.clear();
    // Pin the cached texture's bounds to the whole body, so redrawing a growing colony
    // re-renders into the same texture instead of reallocating one on every board swap.
    const extent = (body.radius + 2) * HEX_SIZE * Math.sqrt(3);
    g.rect(-extent, -extent, extent * 2, extent * 2).fill({ color: 0x000000, alpha: 0.001 });
    this.glowPool.begin();
    this.blobPool.begin();
    this.sheenPool.begin();
    const colorOf = (c: Colony) =>
      c.connected ? playerColor(c.owner) : desaturate(playerColor(c.owner), 0.65);
    const radiusOf = (c: Colony) => (c.core ? 13 : 9) + 1.1 * c.biomass;

    // Solid mass: fill the triangle between any three mutually adjacent same-owner cells, so
    // a cluster reads as one slime body instead of a lattice.
    colony.forEach((c, i) => {
      if (!c) return;
      const nbs = board.neighbours[i] as readonly number[];
      const h = board.cells[i] as Hex;
      // Only two of the six triangles around each cell, so each is drawn once.
      for (const [a, b] of [
        [0, 5],
        [5, 4],
      ] as const) {
        const ha = { q: h.q + (HEX_DIRS[a] as Hex).q, r: h.r + (HEX_DIRS[a] as Hex).r };
        const hb = { q: h.q + (HEX_DIRS[b] as Hex).q, r: h.r + (HEX_DIRS[b] as Hex).r };
        const ia = board.indexOf(ha.q, ha.r);
        const ib = board.indexOf(hb.q, hb.r);
        if (ia < 0 || ib < 0 || !nbs.includes(ia)) continue;
        const ca = colony[ia];
        const cb = colony[ib];
        if (!ca || !cb || ca.owner !== c.owner || cb.owner !== c.owner) continue;
        const pts = [h, ha, hb].map((h) => hexToPixel(h));
        const color = colorOf(c.connected ? c : ca.connected ? ca : cb);
        g.poly(pts.flatMap((pt) => [pt.x, pt.y])).fill(color);
      }
    });

    // Veins between adjacent same-owner cells, thickness by biomass.
    colony.forEach((c, i) => {
      if (!c) return;
      const p = hexToPixel(board.cells[i] as Hex);
      for (const n of board.neighbours[i] as readonly number[]) {
        if (n < i) continue;
        const o = colony[n];
        if (!o || o.owner !== c.owner) continue;
        const q = hexToPixel(board.cells[n] as Hex);
        const width = 12 + 1.6 * Math.min(c.biomass, o.biomass);
        // A straight band: the blobs at both ends round it off, and it tessellates in a
        // fraction of the time of a capped curve (replay frames redraw the whole colony).
        const color = colorOf(c.connected ? c : o);
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * (width / 2);
        const ny = (dx / len) * (width / 2);
        g.poly([
          p.x + nx,
          p.y + ny,
          q.x + nx,
          q.y + ny,
          q.x - nx,
          q.y - ny,
          p.x - nx,
          p.y - ny,
        ]).fill(color);
      }
    });
    colony.forEach((c, i) => {
      if (!c) return;
      const p = hexToPixel(board.cells[i] as Hex);
      const r = radiusOf(c);
      this.glowPool.take(p.x, p.y, r + 14, colorOf(c), 0.55);
      this.blobPool.take(p.x, p.y, r, colorOf(c));
      // Glow intensity by biomass (SPEC §10.2).
      const shine = 0.25 + (0.6 * c.biomass) / (c.core ? 12 : 9);
      this.sheenPool.take(
        p.x - r * 0.15,
        p.y - r * 0.2,
        r * 0.6,
        lighten(colorOf(c), 0.7),
        c.connected ? shine : shine * 0.4,
      );
    });
    this.glowPool.end();
    this.blobPool.end();
    this.sheenPool.end();

    if (this.goo.isCachedAsTexture) this.goo.updateCacheTexture();
    else this.goo.cacheAsTexture({ resolution: this.cacheResolution, antialias: true });

    this.rebuildFlow(colony, board);
    this.rebuildCores(colony, board);
    this.numbersDirty = true;
    if (this.numbers.visible) this.rebuildNumbers();
  }

  /** Flow motes: a pulse that travels along connected veins toward cores (SPEC §10.4). */
  private rebuildFlow(
    colony: readonly (Colony | null)[],
    board: ReturnType<typeof getBoard>,
  ): void {
    // Sprites are pooled: replays redraw the board several times per turn.
    const pool = this.flowSprites.map((f) => f.sprite);
    this.flowSprites = [];
    const dist = new Array<number>(colony.length).fill(-1);
    const queue: number[] = [];
    colony.forEach((c, i) => {
      if (c?.core) {
        dist[i] = 0;
        queue.push(i);
      }
    });
    for (let h = 0; h < queue.length; h++) {
      const i = queue[h] as number;
      for (const n of board.neighbours[i] as readonly number[]) {
        if (dist[n] !== -1 || colony[n]?.owner !== colony[i]?.owner) continue;
        dist[n] = (dist[i] as number) + 1;
        queue.push(n);
      }
    }
    let used = 0;
    colony.forEach((c, i) => {
      if (!c || !this.dot) return;
      let s = pool[used++];
      if (!s) {
        s = new Sprite(this.dot);
        s.anchor.set(0.5);
        s.blendMode = "add";
        this.flow.addChild(s);
      }
      s.visible = true;
      const p = hexToPixel(board.cells[i] as Hex);
      s.position.set(p.x, p.y);
      s.scale.set(0.35 + c.biomass * 0.02);
      s.tint = c.connected ? lighten(playerColor(c.owner), 0.5) : 0x9aa3ad;
      this.flowSprites.push({ sprite: s, dist: dist[i] ?? 0, connected: c.connected });
    });
    for (let k = used; k < pool.length; k++) {
      const spare = pool[k] as Sprite;
      spare.visible = false;
      this.flowSprites.push({ sprite: spare, dist: 0, connected: false });
    }
  }

  private rebuildCores(
    colony: readonly (Colony | null)[],
    board: ReturnType<typeof getBoard>,
  ): void {
    this.cores.removeChildren().forEach((c) => c.destroy());
    this.coreSprites = [];
    colony.forEach((c, i) => {
      if (!c?.core) return;
      const p = hexToPixel(board.cells[i] as Hex);
      const color = playerColor(c.owner);
      const n = new Graphics()
        .circle(0, 0, 15)
        .fill({ color: lighten(color, 0.2), alpha: 0.35 })
        .circle(0, 0, 9)
        .fill(lighten(color, 0.55))
        .circle(-2.5, -2.5, 3.5)
        .fill({ color: 0xffffff, alpha: 0.8 })
        .circle(0, 0, 15)
        .stroke({ width: 2, color: lighten(color, 0.7), alpha: 0.8 });
      n.position.set(p.x, p.y);
      this.cores.addChild(n);
      this.coreSprites.push(n);
    });
  }

  /** Biomass labels are only built while visible (zoomed in or long-press). */
  private rebuildNumbers(): void {
    if (!this.numbersDirty) return;
    this.numbersDirty = false;
    const colony = this.colony;
    const board = getBoard((this.state.bodies[0] as GameState["bodies"][number]).radius);
    this.numbers.removeChildren().forEach((c) => c.destroy());
    colony.forEach((c, i) => {
      if (!c) return;
      const p = hexToPixel(board.cells[i] as Hex);
      const t = new BitmapText({
        text: String(c.biomass),
        style: { fontFamily: "swarm-numbers", fontSize: 13 },
      });
      t.anchor.set(0.5);
      t.position.set(p.x, p.y + (c.core ? 18 : 0));
      this.numbers.addChild(t);
    });
  }

  private tick(dt: number): void {
    this.time += dt / 1000;
    const t = this.time;
    if (this.reduceMotion) {
      for (const f of this.flowSprites) f.sprite.alpha = f.connected ? 0.35 : 0.2;
      return;
    }
    for (const f of this.flowSprites) {
      if (f.connected) {
        // Peaks travel inward: distance increases phase, so the wave moves toward the core.
        const wave = Math.sin(t * 2.4 + f.dist * 0.9);
        f.sprite.alpha = 0.12 + 0.45 * Math.max(0, wave) ** 3;
      } else {
        f.sprite.alpha = 0.12 + 0.18 * (0.5 + 0.5 * Math.sin(t * 1.2));
      }
    }
    const s = 1 + 0.07 * Math.sin(t * 3);
    for (const c of this.coreSprites) c.scale.set(s);
  }

  // ---------------------------------------------------------------------------------------
  // Planning overlays

  /** Queued orders: ghost paths, reinforce rings and retract crosses. */
  setPlan(orders: readonly Order[], player: PlayerId, previews: StepPreview[][]): void {
    const g = this.planG;
    g.clear();
    const color = playerColor(player);
    orders.forEach((o, k) => {
      if (o.type === "grow") {
        this.drawPath(g, o.path, previews[k] ?? [], color, 0.55);
      } else if (o.type === "reinforce") {
        const p = hexToPixel(o.cell);
        g.circle(p.x, p.y, HEX_SIZE * 0.78).stroke({
          width: 3,
          color: lighten(color, 0.4),
          alpha: 0.9,
        });
        g.moveTo(p.x - 5, p.y - HEX_SIZE * 0.78)
          .lineTo(p.x + 5, p.y - HEX_SIZE * 0.78)
          .stroke({ width: 3, color: 0xffffff });
        g.moveTo(p.x, p.y - HEX_SIZE * 0.78 - 5)
          .lineTo(p.x, p.y - HEX_SIZE * 0.78 + 5)
          .stroke({ width: 3, color: 0xffffff });
      } else {
        const p = hexToPixel(o.cell);
        const d = HEX_SIZE * 0.45;
        g.moveTo(p.x - d, p.y - d)
          .lineTo(p.x + d, p.y + d)
          .moveTo(p.x + d, p.y - d)
          .lineTo(p.x - d, p.y + d)
          .stroke({
            width: 4,
            color: 0xff7a7a,
            alpha: 0.9,
          });
      }
    });
  }

  private drawPath(
    g: Graphics,
    path: readonly Hex[],
    preview: readonly StepPreview[],
    color: number,
    alpha: number,
  ): void {
    if (path.length < 2) return;
    const pts = path.map((h) => hexToPixel(h));
    // One stroke per segment: a single round-joined polyline left stray triangles in Pixi.
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1] as Point;
      const b = pts[i] as Point;
      g.moveTo(a.x, a.y)
        .lineTo(b.x, b.y)
        .stroke({ width: 6, color, alpha: alpha * 0.8, cap: "round" });
    }
    path.slice(1).forEach((h) => {
      const step = preview.find((s) => s.cell.q === h.q && s.cell.r === h.r);
      const p = hexToPixel(h);
      if (!step) {
        g.circle(p.x, p.y, 6).fill({ color, alpha: alpha * 0.6 });
        return;
      }
      const ring = step.outcome === "fail" ? 0xff5a5a : step.kind === "assault" ? 0x6cff8f : color;
      g.poly(hexCorners(p, HEX_SIZE - 3))
        .fill({ color, alpha: alpha * 0.28 })
        .stroke({ width: 2.5, color: ring, alpha });
    });
  }

  /** The path under the finger, with cost and assault previews (SPEC §10.2). */
  setPaint(p: PaintOverlay | null): void {
    this.paintG.clear();
    this.labels.removeChildren().forEach((c) => c.destroy());
    if (!p || p.path.length < 2) return;
    const color = playerColor(p.player);
    this.drawPath(this.paintG, p.path, p.preview, p.valid ? color : 0xff5a5a, 0.95);
    const tip = hexToPixel(p.path[p.path.length - 1] as Hex);
    this.addLabel(
      this.labels,
      `${p.cost} N`,
      tip.x,
      tip.y - HEX_SIZE * 1.15,
      p.valid ? 0xffffff : 0xff8080,
    );
    for (const s of p.preview) {
      if (s.kind !== "assault") continue;
      const at = hexToPixel(s.cell);
      const text = `${s.attack} vs ${s.defense}${s.uncertain ? "?" : ""}`;
      this.addLabel(
        this.labels,
        text,
        at.x,
        at.y + HEX_SIZE * 1.1,
        s.outcome === "capture" ? 0x6cff8f : 0xff6b6b,
      );
    }
  }

  private addLabel(into: Container, text: string, x: number, y: number, fill: number): Text {
    const t = new Text({
      text,
      style: {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 15,
        fontWeight: "700",
        fill,
        stroke: { color: 0x02040c, width: 4 },
      },
      resolution: 2,
    });
    t.anchor.set(0.5);
    t.position.set(x, y);
    t.scale.set(1 / Math.max(0.8, this.zoom));
    into.addChild(t);
    return t;
  }

  // ---------------------------------------------------------------------------------------
  // Replay (SPEC §10.5)

  /** Frames the cells an action touches, zooming out only as far as needed. */
  frameCells(cells: readonly Hex[]): void {
    if (cells.length === 0) return;
    const pts = cells.map((h) => hexToPixel(h));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const { w, h } = this.screen;
    const need = Math.min(
      (w * 0.8) / Math.max(1, maxX - minX + HEX_SIZE * 4),
      (h * 0.6) / Math.max(1, maxY - minY + HEX_SIZE * 4),
    );
    this.zoom = Math.max(this.minZoom, Math.min(this.zoom, need));
    this.centerWorld({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
  }

  async playTimeline(
    frames: readonly Frame[],
    ctl: ReplayControl,
    onFrame?: (f: Frame) => void,
  ): Promise<void> {
    const cells = frames.flatMap((f) => f.effects.flatMap(effectCells));
    if (cells.length > 0 && !ctl.skipped()) this.frameCells(cells);
    for (const frame of frames) {
      if (ctl.skipped()) break;
      onFrame?.(frame);
      if (ctl.reduceMotion || frame.effects.length === 0) {
        await this.wait(ctl.reduceMotion ? frame.duration * 0.6 : frame.duration * 0.4, ctl);
        this.setBoard(frame.colony.get(0) ?? this.colony);
        continue;
      }
      await this.animateFrame(frame, ctl);
      this.setBoard(frame.colony.get(0) ?? this.colony);
    }
    this.fx.clear();
    this.fxLabels.removeChildren().forEach((c) => c.destroy());
    const last = frames[frames.length - 1];
    if (last) this.setBoard(last.colony.get(0) ?? this.colony);
  }

  private wait(ms: number, ctl: ReplayControl): Promise<void> {
    return new Promise((resolve) => {
      let left = ms;
      const step = (t: { deltaMS: number }) => {
        if (!ctl.paused()) left -= t.deltaMS * ctl.speed();
        if (left <= 0 || ctl.skipped()) {
          this.app.ticker.remove(step);
          resolve();
        }
      };
      this.app.ticker.add(step);
    });
  }

  private animateFrame(frame: Frame, ctl: ReplayControl): Promise<void> {
    return new Promise((resolve) => {
      let elapsed = 0;
      let swapped = false;
      const labels = new Map<Effect, Text>();
      const step = (t: { deltaMS: number }) => {
        if (!ctl.paused()) elapsed += t.deltaMS * ctl.speed();
        const p = Math.min(1, elapsed / frame.duration);
        this.drawEffects(frame.effects, p, labels);
        // Switch the board to this frame once tendrils have mostly arrived.
        if (!swapped && p >= 0.6) {
          swapped = true;
          this.setBoard(frame.colony.get(0) ?? this.colony);
        }
        if (p >= 1 || ctl.skipped()) {
          this.app.ticker.remove(step);
          for (const l of labels.values()) l.destroy();
          this.fx.clear();
          resolve();
        }
      };
      this.app.ticker.add(step);
    });
  }

  private drawEffects(effects: readonly Effect[], p: number, labels: Map<Effect, Text>): void {
    const g = this.fx;
    g.clear();
    const ease = 1 - (1 - p) ** 3;
    for (const e of effects) {
      switch (e.kind) {
        case "tendril": {
          const a = hexToPixel(e.from);
          const b = hexToPixel(e.to);
          const color = playerColor(e.player);
          const reach = e.outcome === "claim" || e.outcome === "capture" ? 1 : 0.55;
          const k = Math.min(1, ease / 0.6) * reach;
          const back =
            e.outcome === "lost" || e.outcome === "repelled" || e.outcome === "stalemate"
              ? Math.max(0, (p - 0.6) / 0.4)
              : 0;
          const len = k * (1 - back);
          g.moveTo(a.x, a.y)
            .lineTo(a.x + (b.x - a.x) * len, a.y + (b.y - a.y) * len)
            .stroke({ width: 7, color: lighten(color, 0.25), alpha: 0.95, cap: "round" });
          g.circle(a.x + (b.x - a.x) * len, a.y + (b.y - a.y) * len, 6).fill(lighten(color, 0.6));
          break;
        }
        case "splash": {
          const c = hexToPixel(e.cell);
          if (p > 0.45) {
            const q = (p - 0.45) / 0.55;
            g.circle(c.x, c.y, HEX_SIZE * (0.4 + q)).stroke({
              width: 4 * (1 - q),
              color: 0xffffff,
              alpha: 1 - q,
            });
            for (let i = 0; i < 6; i++) {
              const ang = (i / 6) * Math.PI * 2 + 0.3;
              g.circle(
                c.x + Math.cos(ang) * HEX_SIZE * q,
                c.y + Math.sin(ang) * HEX_SIZE * q,
                3 * (1 - q),
              ).fill(0xffffff);
            }
          }
          break;
        }
        case "flip": {
          if (p > 0.5) {
            const c = hexToPixel(e.cell);
            const q = (p - 0.5) / 0.5;
            g.circle(c.x, c.y, HEX_SIZE * (0.3 + 1.4 * q)).stroke({
              width: 6 * (1 - q),
              color: playerColor(e.to),
              alpha: 1 - q,
            });
          }
          break;
        }
        case "coreLost": {
          if (p > 0.55) {
            const c = hexToPixel(e.cell);
            const q = (p - 0.55) / 0.45;
            g.circle(c.x, c.y, HEX_SIZE * (0.5 + 2.5 * q)).stroke({
              width: 10 * (1 - q),
              color: 0xffffff,
              alpha: 1 - q,
            });
          }
          break;
        }
        case "pulse": {
          const c = hexToPixel(e.cell);
          g.circle(c.x, c.y, HEX_SIZE * (0.5 + 0.6 * ease)).stroke({
            width: 5 * (1 - p),
            color: lighten(playerColor(e.player), 0.5),
            alpha: 1 - p,
          });
          break;
        }
        case "retract": {
          const c = hexToPixel(e.cell);
          g.circle(c.x, c.y, HEX_SIZE * 0.6 * (1 - ease)).fill({
            color: playerColor(e.player),
            alpha: 0.8 * (1 - p),
          });
          break;
        }
        case "fade": {
          const c = hexToPixel(e.cell);
          g.circle(c.x, c.y, HEX_SIZE * 0.55).fill({ color: 0x0a0d14, alpha: 0.6 * ease });
          break;
        }
        case "income": {
          let t = labels.get(e);
          if (!t) {
            const c = hexToPixel(e.cell);
            t = this.addLabel(
              this.fxLabels,
              `+${e.amount} N`,
              c.x,
              c.y - HEX_SIZE,
              lighten(playerColor(e.player), 0.5),
            );
            labels.set(e, t);
          }
          const c = hexToPixel(e.cell);
          t.position.y = c.y - HEX_SIZE - 26 * ease;
          t.alpha = p < 0.8 ? 1 : (1 - p) / 0.2;
          break;
        }
      }
    }
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    if (this.longPress) clearTimeout(this.longPress);
    this.app.destroy(true, { children: true, texture: true });
  }
}

function effectCells(e: Effect): Hex[] {
  switch (e.kind) {
    case "tendril":
      return [e.from, e.to];
    case "income":
      return [];
    default:
      return [e.cell];
  }
}
