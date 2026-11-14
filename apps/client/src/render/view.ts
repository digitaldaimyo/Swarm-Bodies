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
  bodyPosition,
  cellYield,
  defenseOf,
  getBoard,
  maxBiomassFor,
  playerRules,
  HEX_DIRECTIONS as HEX_DIRS,
  type Body,
  type Colony,
  type DepositKind,
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
import {
  DEPOSIT_COLORS,
  desaturate,
  lighten,
  PLAYER_PATTERNS,
  playerColor,
  SPACE,
  trailColor,
  veinScale,
  shade,
} from "./palette";
import { arcPoints } from "./arc";
import { SpritePool } from "./pool";
import { drawPattern } from "./patterns";
import { resourceRoutes, vascular, vesselWidth, type Vascular } from "../game/vascular";
import { beat, pulse, starveTurnsLeft, strength, WAVE_STEP } from "../game/heartbeat";
import { defenseParts, defenseText, fruitableCells, supplyPath } from "../game/readout";
import { frontier, spread, strainStyle, type StrainStyle } from "../game/personality";
import { SystemLayer } from "./system";

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
  /** System view: a pickable body was tapped. */
  onBodyTap?(body: number): void;
  /** Pinch-out past the whole body (SPEC §10.2: switch to System view). */
  onPinchOut?(): void;
}

export type ViewMode = "body" | "system";

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

/**
 * The match view (SPEC §10.2): Body view (one asteroid, drawn and driven with PixiJS) and
 * System view (star, orbits, spores). Only the shown body is rendered (SPEC §10.7).
 */
export class MatchView {
  readonly app = new Application();
  private readonly stars: Graphics[] = [];
  private readonly world = new Container();
  private readonly goo = new Container();
  private readonly gooG = new Graphics();
  private readonly glowLayer = new Container();
  private readonly triLayer = new Container();
  private readonly bandLayer = new Container();
  private triPool!: SpritePool;
  private bandPool!: SpritePool;
  private readonly blobLayer = new Container();
  private readonly sheenLayer = new Container();
  /** Supply-tree vessels over the colony body (colony life, phase 1). */
  private readonly vesselLayer = new Container();
  private vesselPool!: SpritePool;
  /** How many vessels the board shows (tests read this; the canvas cannot be queried). */
  vessels = 0;
  /** Colourblind pattern overlays (SPEC §10.4, §10.8): one pool per seat pattern. */
  private readonly patternLayer = new Container();
  private patternPools: SpritePool[] = [];
  private patterns = false;
  private glowPool!: SpritePool;
  private blobPool!: SpritePool;
  private sheenPool!: SpritePool;
  private readonly flow = new Container();
  private readonly cores = new Container();
  /** Deposit badges on occupied cells, so resources stay readable under a colony (playtest). */
  private readonly depositMarks = new Graphics();
  /** How many deposit badges the board shows (tests read this; the canvas cannot be queried). */
  depositBadges = 0;
  /** Badges slashed because their deposit is cut off from every core (tests read this). */
  cutBadges = 0;
  private readonly numbers = new Container();
  private readonly planG = new Graphics();
  private readonly paintG = new Graphics();
  private readonly labels = new Container();
  private readonly fx = new Graphics();
  private readonly fxLabels = new Container();
  private readonly cursor = new Graphics();
  private grid: Graphics | null = null;
  private ground: Container | null = null;
  private dot: Texture | null = null;
  private moteTex: Texture | null = null;
  private readonly stalks = new Graphics();
  private readonly sun = new Graphics();
  private readonly flash = new Graphics();
  private readonly system = new SystemLayer();
  private bodyId = 0;
  private viewer: PlayerId = 0;
  private mode: ViewMode = "body";
  private readonly stalkGlow = new Graphics();
  private systemInset = { top: 120, bottom: 170 };

  private state!: GameState;
  private colony: (Colony | null)[] = [];
  /**
   * One heartbeat dot per colony cell (colony life, phase 2). A connected cell swells as the
   * beat from its core reaches it (`depth` steps out); `full` cells glow steadily instead.
   */
  private flowSprites: {
    sprite: Sprite;
    depth: number;
    period: number;
    depthAmp: number;
    own: number;
    base: number;
    connected: boolean;
    full: boolean;
  }[] = [];
  private coreSprites: {
    g: Graphics;
    cell: number;
    period: number;
    depthAmp: number;
    /** Brightens as nutrient motes arrive, then fades (colony life, phase 3). */
    fed: number;
  }[] = [];
  /**
   * Nutrient motes (colony life, phase 3): each deposit or comet a colony holds sends motes
   * in its badge colour along its supply route to the core, more often the more it yields. A
   * cut route ends where the supply line broke, and its motes fizzle there. A fixed pool of
   * sprites, animated only for the body on screen.
   */
  private readonly moteLayer = new Container();
  private moteSprites: Sprite[] = [];
  private moteRoutes: MoteRoute[] = [];
  private motesLive: Mote[] = [];
  /** Live motes and routes (tests read these; the canvas cannot be queried). */
  get motes(): number {
    return this.motesLive.length;
  }
  get moteRouteCount(): number {
    return this.moteRoutes.length;
  }
  /**
   * Readouts (colony life, phase 4). Holding a cell traces its supply route to the core and
   * shows its defense; cells that could fruit now carry a faint sparkle while planning.
   */
  private readonly inspectG = new Graphics();
  private readonly inspectLabel = new Container();
  /** The cell held for a readout, or -1, and its text (tests read these). */
  inspected = -1;
  inspectText = "";
  /** Cells on the held cell's supply route, itself and its core included. */
  inspectRoute = 0;
  private vasc: Vascular | null = null;
  private pending: readonly Order[] = [];
  /** Queued orders drawn on the body shown (tests read this). */
  planShown = 0;
  /** The last plan drawn, redrawn when another body is shown. */
  private plan: { orders: readonly Order[]; player: PlayerId; previews: StepPreview[][] } | null =
    null;
  private planHints = false;
  /** Whether the board shows the live state (not a replay frame). */
  private boardLive = false;
  private readonly sparkLayer = new Container();
  private sparkTex: Texture | null = null;
  private sparks: { sprite: Sprite; phase: number }[] = [];
  /** Cells sparkling as able to fruit (tests read this). */
  fruitable = 0;
  /**
   * Personality (colony life, phase 5): each strain's vessels, webbing and heartbeat follow its
   * style; Sporer colonies shed drifting specks; the viewer's frontier cells put out feelers
   * toward the empty cells they could grow into, twitching at their strain's pace.
   */
  private styles = new Map<PlayerId, StrainStyle>();
  private readonly feelerLayer = new Container();
  private feelerTex: Texture | null = null;
  private feelerSprites: { sprite: Sprite; phase: number; len: number; angle: number }[] = [];
  private feelerPace = 1;
  /** Feelers shown (tests read this). */
  feelers = 0;
  private readonly speckLayer = new Container();
  private speckCells: { x: number; y: number; tint: number }[] = [];
  private speckSprites: Sprite[] = [];
  private specksLive: { sprite: Sprite; x: number; y: number; age: number; drift: number }[] = [];
  private speckClock = 0;
  private speckNext = 0;
  /** Spore specks drifting now (tests read this). */
  get specks(): number {
    return this.specksLive.length;
  }
  /** Colony detail "Calm": no motes, feelers or specks. Vessels, badges and rims stay. */
  calm = false;
  /** Draining rims on cut-off cells: the turns each has left before it starves. */
  private readonly starveMarks = new Graphics();
  /** How many starvation rims the board shows (tests read this). */
  starveRims = 0;
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
  /** Board redraws so far: the perf test separates swap frames from typical ones. */
  boardSwaps = 0;

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
    v.resizeObserver = new ResizeObserver(() => {
      v.fit(false);
      v.layoutSystem();
      v.drawSun();
    });
    v.resizeObserver.observe(parent);
    v.app.ticker.add((t) => v.tick(t.deltaMS));
    return v;
  }

  /** The body Body view shows. */
  private get body(): Body {
    return (this.state.bodies[this.bodyId] ?? this.state.bodies[0]) as Body;
  }

  get shownBody(): number {
    return this.bodyId;
  }

  get viewMode(): ViewMode {
    return this.mode;
  }

  /** Static art is rendered once to a texture: each frame then draws one quad instead of
   * re-rasterising thousands of vertices (SPEC §10.7, 60 fps on mid-range phones). */
  private buildGround(): void {
    const body = this.body;
    if (this.ground) this.ground.destroy({ children: true });
    if (this.grid) this.grid.destroy();
    this.ground = new Container();
    this.ground.addChild(
      drawAsteroid(body, `${this.state.seed}:${body.id}`),
      drawTerrain(body, `${this.state.seed}:${body.id}`),
    );
    this.world.addChildAt(this.ground, 0);
    this.ground.cacheAsTexture({ resolution: this.cacheResolution });
    this.grid = drawGrid(body);
    this.grid.alpha = 0;
    this.grid.visible = false;
    this.world.addChildAt(this.grid, 1);
    this.grid.cacheAsTexture({ resolution: this.cacheResolution });
  }

  private build(state: GameState): void {
    this.state = state;
    for (const layer of [0, 1]) {
      const s = drawStars(state.seed, layer, 1400);
      this.stars.push(s);
      this.app.stage.addChild(s);
    }
    this.app.stage.addChild(this.world, this.system.root, this.sun, this.flash);
    this.system.root.visible = false;
    this.buildGround();

    // Colonies: thick round-capped veins and overlapping blobs merge into organic shapes
    // without a blur filter, which keeps phones at 60 fps (SPEC §10.4, §10.7).
    this.goo.addChild(
      this.gooG,
      this.glowLayer,
      this.triLayer,
      this.bandLayer,
      this.blobLayer,
      this.sheenLayer,
      this.vesselLayer,
      this.patternLayer,
    );
    // The colony body, vessels included, is cached as one texture: fading it is even (no
    // triangle mosaic), lets the ground show through, and adds no per-frame cost
    // (colony life, phase 1).
    this.goo.alpha = 0.86;
    this.world.addChild(
      this.goo,
      this.depositMarks,
      this.starveMarks,
      this.feelerLayer,
      this.flow,
      this.moteLayer,
      this.speckLayer,
      this.sparkLayer,
      this.cores,
      this.inspectG,
      this.stalkGlow,
      this.stalks,
      this.planG,
      this.paintG,
      this.fx,
      this.numbers,
      this.labels,
      this.fxLabels,
      this.inspectLabel,
      this.cursor,
    );

    const g = new Graphics()
      .circle(16, 16, 16)
      .fill({ color: 0xffffff, alpha: 0.25 })
      .circle(16, 16, 9)
      .fill(0xffffff);
    this.dot = this.app.renderer.generateTexture({ target: g, resolution: 2 });
    // Nutrient motes: a bright bead with a dark rim (like the deposit badges), so a mote reads
    // on any colony colour. Tinting keeps the rim dark.
    this.moteTex = this.app.renderer.generateTexture({
      target: new Graphics()
        .circle(8, 8, 8)
        .fill({ color: 0x070b1a, alpha: 0.7 })
        .circle(8, 8, 5.5)
        .fill(0xffffff),
      resolution: 2,
    });
    // A feeler: a soft pseudopod, narrowing from its root to a rounded bulb at the tip.
    this.feelerTex = this.app.renderer.generateTexture({
      target: new Graphics()
        .poly([3, 0.5, 19, 2.2, 19, 5.8, 3, 7.5])
        .fill(0xffffff)
        .circle(3, 4, 3.5)
        .fill(0xffffff)
        .circle(20, 4, 2.6)
        .fill(0xffffff),
      resolution: 2,
    });
    // Fruiting hint: a small four-point star.
    const star: number[] = [];
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      const rr = k % 2 === 0 ? 7 : 2;
      star.push(8 + Math.cos(a) * rr, 8 + Math.sin(a) * rr);
    }
    this.sparkTex = this.app.renderer.generateTexture({
      target: new Graphics().poly(star).fill(0xffffff),
      resolution: 2,
    });
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
    // Vein bands and the triangle between three neighbours are sprites too: redrawing a
    // board (several times per replay) then tessellates nothing.
    const bar = this.app.renderer.generateTexture({
      target: new Graphics().rect(0, 0, 8, 8).fill(0xffffff),
      resolution: 1,
    });
    const side = HEX_SIZE * Math.sqrt(3);
    const tri = this.app.renderer.generateTexture({
      target: new Graphics()
        .poly([0, 0, side, 0, side / 2, (side * Math.sqrt(3)) / 2])
        .fill(0xffffff),
      resolution: 2,
    });
    this.bandPool = new SpritePool(this.bandLayer, bar);
    this.triPool = new SpritePool(this.triLayer, tri);
    this.blobPool = new SpritePool(this.blobLayer, disc);
    this.sheenPool = new SpritePool(this.sheenLayer, soft);
    // A capsule, stretched along each vessel: rounded ends make joints read as one vessel.
    this.vesselPool = new SpritePool(
      this.vesselLayer,
      this.app.renderer.generateTexture({
        target: new Graphics().roundRect(0, 0, 32, 8, 4).fill(0xffffff),
        resolution: 2,
      }),
    );
    this.patternPools = PLAYER_PATTERNS.map(
      (p) =>
        new SpritePool(
          this.patternLayer,
          this.app.renderer.generateTexture({ target: drawPattern(p), resolution: 2 }),
        ),
    );
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
    this.setBoard(this.body.colony, state);
    this.fit(true);
  }

  /** Opens another body in Body view (SPEC §10.2). */
  showBody(id: number): void {
    if (!this.state.bodies[id]) return;
    const changed = id !== this.bodyId;
    this.bodyId = id;
    if (changed) {
      this.buildGround();
      // The colony texture is pinned to the body's extent: start it over for the new size.
      if (this.goo.isCachedAsTexture) this.goo.cacheAsTexture(false);
      this.gooG.clear();
      // Queued orders on the newly shown body are drawn again (playtest: they vanished).
      if (this.plan) this.setPlan(this.plan.orders, this.plan.player, this.plan.previews);
      else this.planG.clear();
      this.cancelPaint();
      this.setBoard(this.body.colony);
      this.boardLive = true;
      this.refreshSparks();
      this.fit(true);
    }
    this.setMode("body");
  }

  setMode(mode: ViewMode): void {
    this.mode = mode;
    const body = mode === "body";
    this.world.visible = body;
    this.sun.visible = body;
    this.system.root.visible = !body;
    this.cursor.clear();
    if (!body) this.layoutSystem();
    this.drawSun();
  }

  /** Who is looking: their spore targets are shown, nobody else's (SPEC §6). */
  setViewer(p: PlayerId): void {
    this.viewer = p;
  }

  /** System view options: launch-pick mode limits taps to bodies in range. */
  private launchFrom: number | null = null;
  private alerts: ReadonlySet<number> = new Set();
  setSystemOptions(o: { launchFrom: number | null; alerts: ReadonlySet<number> }): void {
    this.launchFrom = o.launchFrom;
    this.alerts = o.alerts;
    this.updateSystem();
  }

  /** In the Launch flow, only bodies in range can be picked. */
  canPick(id: number): boolean {
    return this.system.pickable(id);
  }

  setSystemInset(inset: { top: number; bottom: number }): void {
    this.systemInset = inset;
    this.layoutSystem();
  }

  private layoutSystem(): void {
    const { w, h } = this.screen;
    this.updateSystem();
    this.system.layout(w, h, this.systemInset);
  }

  private updateSystem(): void {
    this.system.set(this.state, {
      viewer: this.viewer,
      selected: this.bodyId,
      launchFrom: this.launchFrom,
      alerts: this.alerts,
    });
  }

  /** Where the star is, from this body: a sun marker on the screen edge (flare side, SPEC §8). */
  private drawSun(): void {
    const g = this.sun;
    g.clear();
    if (this.mode !== "body" || !this.body.orbit || !this.state) return;
    const p = bodyPosition(this.body, this.state.turn);
    const len = Math.hypot(p.x, p.y) || 1;
    const dx = -p.x / len;
    const dy = -p.y / len;
    const { w, h } = this.screen;
    const top = 118;
    // Clear of the bottom HUD and the body strip.
    const bottom = h - 190;
    const cx = w / 2;
    const cy = (top + bottom) / 2;
    const k = Math.min(
      Math.abs(dx) > 1e-6 ? (w / 2 - 22) / Math.abs(dx) : Infinity,
      Math.abs(dy) > 1e-6 ? (bottom - top) / 2 / Math.abs(dy) : Infinity,
    );
    const x = cx + dx * k;
    const y = cy + dy * k;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.moveTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9)
        .lineTo(x + Math.cos(a) * 14, y + Math.sin(a) * 14)
        .stroke({ width: 2, color: 0xffd27a, alpha: 0.8 });
    }
    g.circle(x, y, 7).fill(0xfff0c2);
    g.circle(x, y, 18).fill({ color: 0xffd27a, alpha: 0.12 });
  }

  // ---------------------------------------------------------------------------------------
  // Camera

  private get screen(): { w: number; h: number } {
    return { w: this.app.screen.width, h: this.app.screen.height };
  }

  /** Recomputes the zoom range; on first fit, centres on the viewer's home core. */
  private fit(initial: boolean, home?: Hex): void {
    const body = this.body;
    const span = (body.radius + 1.2) * HEX_SIZE * Math.sqrt(3) * 2;
    const { w, h } = this.screen;
    this.minZoom = Math.min(1, Math.min(w, h) / span);
    if (initial) {
      this.zoom = 1;
      // Frame the viewer's core on this body if there is one, else the body's centre.
      const board = getBoard(body.radius);
      const ci = body.colony.findIndex((c) => c?.owner === this.viewer && c.core);
      const me = ci >= 0 ? (board.cells[ci] as Hex) : (home ?? { q: 0, r: 0 });
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
    const body = this.body;
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
    const body = this.body;
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
    this.refreshSparks();
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
    let pinchOut = 0;

    const local = (e: PointerEvent): Point => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const cancelLongPress = () => {
      if (this.longPress) clearTimeout(this.longPress);
      this.longPress = null;
      this.clearInspect();
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

    let wheelOut = 0;
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
        pinchOut = 0;
        return;
      }
      downAt = p;
      lastPan = p;
      downHex = this.mode === "body" ? this.hexAt(p) : null;
      mode = e.button === 2 ? "pan" : "pending";
      if (mode === "pending") {
        this.longPress = setTimeout(() => {
          if (mode === "pending") {
            this.showNumbers = true;
            this.clampCamera();
            if (downHex) this.inspect(downHex);
          }
        }, 450);
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      const p = local(e);
      if (e.pointerType === "mouse" && pointers.size === 0) {
        this.drawCursor(this.inputEnabled && this.mode === "body" ? this.hexAt(p) : null);
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
        const factor = dist / Math.max(1, pinch.dist);
        if (this.mode === "body") {
          if (factor < 1 && this.zoom <= this.minZoom * 1.001) pinchOut += 1 - factor;
          if (pinchOut > 0.35) {
            pinchOut = 0;
            this.cb.onPinchOut?.();
          }
          this.zoomAt(factor, mid);
        }
        pinch = { dist, mid };
        return;
      }
      if (mode === "pending" && Math.hypot(p.x - downAt.x, p.y - downAt.y) > MIN_DRAG_PX) {
        cancelLongPress();
        if (this.mode === "system") {
          mode = "none";
        } else if (this.inputEnabled && downHex && this.cb.canPaintFrom(downHex)) {
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
      } else if (mode === "pan" && this.mode === "body") {
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
        if (this.mode === "system") {
          const b = this.system.bodyAt(local(e));
          if (b !== null) this.cb.onBodyTap?.(b);
        } else {
          this.cb.onTap(this.inputEnabled ? downHex : null, local(e));
        }
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
        if (this.mode !== "body") return;
        const r = canvas.getBoundingClientRect();
        if (e.deltaY > 0 && this.zoom <= this.minZoom * 1.001) {
          wheelOut += e.deltaY;
          if (wheelOut > 400) {
            wheelOut = 0;
            this.cb.onPinchOut?.();
          }
        } else wheelOut = 0;
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

  /**
   * A small badge on every deposit or comet cell a colony covers, so resources stay visible once
   * a cell is taken. Ice is a diamond, organic a circle, mineral a square, comets a star, so they
   * read without colour too. Empty deposit cells keep their full terrain art.
   */
  private drawDepositMarks(colony: readonly (Colony | null)[], body: Body): void {
    const g = this.depositMarks;
    g.clear();
    this.depositBadges = 0;
    this.cutBadges = 0;
    const board = getBoard(body.radius);
    const comets = new Set(body.comets.map((c) => c.cell));
    for (let i = 0; i < colony.length; i++) {
      if (!colony[i]) continue;
      const kind = body.deposits[i];
      const comet = comets.has(i);
      if (!kind && !comet) continue;
      this.depositBadges++;
      const p = hexToPixel(board.cells[i] as Hex);
      // Upper right of the cell, clear of the core nucleus and the biomass number.
      const x = p.x + HEX_SIZE * 0.42;
      const y = p.y - HEX_SIZE * 0.42;
      const r = 6;
      g.circle(x, y, r + 3).fill({ color: 0x070b1a, alpha: 0.85 });
      if (comet) {
        const pts: number[] = [];
        for (let k = 0; k < 10; k++) {
          const a = -Math.PI / 2 + (k * Math.PI) / 5;
          const rr = k % 2 === 0 ? r + 1 : r * 0.45;
          pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        g.poly(pts).fill(0xffe28a);
      } else if (kind === "ice") {
        g.poly([x, y - r, x + r, y, x, y + r, x - r, y]).fill(DEPOSIT_COLORS.ice);
      } else if (kind === "organic") {
        g.circle(x, y, r * 0.85).fill(0x5fbf5c);
      } else if (kind === "mineral") {
        g.rect(x - r * 0.75, y - r * 0.75, r * 1.5, r * 1.5).fill(DEPOSIT_COLORS.mineral);
      }
      // Cut off from every core: its income is not reaching the colony. A slash says so
      // without motion or colour (the still form of fizzling motes, colony life phase 3).
      if (!(colony[i] as Colony).connected) {
        g.moveTo(x - r - 1, y + r + 1)
          .lineTo(x + r + 1, y - r - 1)
          .stroke({ width: 4, color: 0x070b1a, alpha: 0.9, cap: "round" })
          .moveTo(x - r - 1, y + r + 1)
          .lineTo(x + r + 1, y - r - 1)
          .stroke({ width: 2, color: 0xff5a4a, cap: "round" });
        this.cutBadges++;
      }
    }
  }

  /**
   * Supply-tree vessels (colony life, phase 1): each connected cell's vein toward its core is
   * drawn as a vessel over the colony body, thicker the more cells it feeds. Other links stay
   * as the body's webbing; cut-off cells carry no vessels. Static: part of the cached texture.
   */
  private drawVessels(
    v: Vascular,
    colony: readonly (Colony | null)[],
    board: ReturnType<typeof getBoard>,
  ): void {
    this.vessels = 0;
    for (let i = 0; i < colony.length; i++) {
      const p = v.parent[i] as number;
      const c = colony[i];
      // Leaf twigs (feeding only themselves) are left to the body's webbing: they were all
      // but invisible, and skipping them halves the sprites drawn every frame.
      if (p < 0 || !c || (v.load[i] as number) < 2) continue;
      const a = hexToPixel(board.cells[i] as Hex);
      const b = hexToPixel(board.cells[p] as Hex);
      const style = this.styles.get(c.owner) ?? strainStyle(undefined);
      const w = vesselWidth(v.load[i] as number) * veinScale(c.owner) * style.vein;

      // Arteries stand out; capillaries toward the edges all but vanish.
      const load = v.load[i] as number;
      const alpha = 0.16 + 0.36 * Math.min(1, Math.log2(load) / 5);
      const tint = shade(playerColor(c.owner), style.shade);
      // A jagged strain kinks each vessel sideways at its middle, alternating by cell.
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      const off = style.jag * len * (i % 2 === 0 ? 1 : -1);
      const mid = {
        x: (a.x + b.x) / 2 + (-(b.y - a.y) / len) * off,
        y: (a.y + b.y) / 2 + ((b.x - a.x) / len) * off,
      };
      const legs: [Point, Point][] =
        style.jag > 0
          ? [
              [a, mid],
              [mid, b],
            ]
          : [[a, b]];
      for (const [from, to] of legs) {
        const s = this.vesselPool.takeRaw(tint, alpha);
        s.anchor.set(0.5);
        s.position.set((from.x + to.x) / 2, (from.y + to.y) / 2);
        s.rotation = Math.atan2(to.y - from.y, to.x - from.x);
        // Overshoot by the width so neighbouring vessels overlap into one continuous line.
        s.width = Math.hypot(to.x - from.x, to.y - from.y) + w;
        s.height = w;
      }
      this.vessels++;
    }
  }

  /** Turns the colourblind pattern overlays on or off (Settings). */
  setPatterns(on: boolean): void {
    if (on === this.patterns) return;
    this.patterns = on;
    if (this.patternPools.length > 0) this.setBoard(this.colony);
  }

  setState(state: GameState): void {
    this.state = state;
    this.setBoard(this.body.colony, state);
    this.boardLive = true;
    this.refreshSparks();
    this.updateSystem();
    this.drawSun();
  }

  /** Redraws colonies from a colony array (the live state or a replay frame). */
  setBoard(colony: readonly (Colony | null)[], state = this.state): void {
    this.boardSwaps++;
    this.boardLive = false;
    this.colony = colony.slice();
    this.styles = new Map(state.players.map((p) => [p.id, strainStyle(p.strain)]));
    const body = (state.bodies[this.bodyId] ?? state.bodies[0]) as Body;
    const board = getBoard(body.radius);
    const g = this.gooG;
    if (g.context.instructions.length === 0) {
      // Pin the cached texture's bounds to the whole body, so redrawing a growing colony
      // re-renders into the same texture instead of reallocating one on every board swap.
      const extent = (body.radius + 2) * HEX_SIZE * Math.sqrt(3);
      g.rect(-extent, -extent, extent * 2, extent * 2).fill({ color: 0x000000, alpha: 0.001 });
    }
    this.glowPool.begin();
    this.triPool.begin();
    this.bandPool.begin();
    this.blobPool.begin();
    this.sheenPool.begin();
    this.vesselPool.begin();
    for (const pool of this.patternPools) pool.begin();
    const colorOf = (c: Colony) =>
      c.connected ? playerColor(c.owner) : desaturate(playerColor(c.owner), 0.65);
    const radiusOf = (c: Colony) => (c.core ? 13 : 9) + 1.1 * c.biomass;

    // Solid mass: fill the triangle between any three mutually adjacent same-owner cells, so
    // a cluster reads as one slime body instead of a lattice. With pointy-top hexes these are
    // equilateral, pointing down (directions 0,5) or up (5,4) from the cell.
    colony.forEach((c, i) => {
      if (!c) return;
      const nbs = board.neighbours[i] as readonly number[];
      const h = board.cells[i] as Hex;
      for (const [a, b, up] of [
        [0, 5, false],
        [5, 4, true],
      ] as const) {
        const ha = { q: h.q + (HEX_DIRS[a] as Hex).q, r: h.r + (HEX_DIRS[a] as Hex).r };
        const hb = { q: h.q + (HEX_DIRS[b] as Hex).q, r: h.r + (HEX_DIRS[b] as Hex).r };
        const ia = board.indexOf(ha.q, ha.r);
        const ib = board.indexOf(hb.q, hb.r);
        if (ia < 0 || ib < 0 || !nbs.includes(ia)) continue;
        const ca = colony[ia];
        const cb = colony[ib];
        if (!ca || !cb || ca.owner !== c.owner || cb.owner !== c.owner) continue;
        const p0 = hexToPixel(h);
        const pa = hexToPixel(ha);
        const pb = hexToPixel(hb);
        const t = this.triPool.takeRaw(colorOf(c.connected ? c : ca.connected ? ca : cb));
        // The texture's anchor is its centroid; an "up" triangle is the "down" one turned 180°.
        t.anchor.set(0.5, 1 / 3);
        t.position.set((p0.x + pa.x + pb.x) / 3, (p0.y + pa.y + pb.y) / 3);
        t.rotation = up ? Math.PI : 0;
        t.scale.set(1);
      }
    });

    // Veins between adjacent same-owner cells, thickness by biomass: one stretched bar each.
    colony.forEach((c, i) => {
      if (!c) return;
      const p = hexToPixel(board.cells[i] as Hex);
      for (const n of board.neighbours[i] as readonly number[]) {
        if (n < i) continue;
        const o = colony[n];
        if (!o || o.owner !== c.owner) continue;
        const q = hexToPixel(board.cells[n] as Hex);
        // Severed veins (both ends cut off) thin out and fade: nothing flows through them.
        const severed = !c.connected && !o.connected;
        const bar = this.bandPool.takeRaw(colorOf(c.connected ? c : o), severed ? 0.5 : 1);
        bar.anchor.set(0.5);
        bar.position.set((p.x + q.x) / 2, (p.y + q.y) / 2);
        bar.rotation = Math.atan2(q.y - p.y, q.x - p.x);
        bar.width = Math.hypot(q.x - p.x, q.y - p.y);
        bar.height =
          (12 + 1.6 * Math.min(c.biomass, o.biomass)) *
          veinScale(c.owner) *
          (1 + ((this.styles.get(c.owner)?.vein ?? 1) - 1) * 0.5) *
          (severed ? 0.55 : 1);
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
      if (this.patterns) {
        const pool = this.patternPools[c.owner % this.patternPools.length] as SpritePool;
        pool.take(p.x, p.y, Math.max(8, r * 0.8), 0x061018, 0.72);
      }
    });
    const v = vascular(body.radius, colony, (i, owner) => cellYield(state, body, i, owner));
    const flags = colony.map((c) => !!c?.connected);
    const defense = colony.map((c, i) => (c ? defenseOf(state, body, colony, flags, i) : 0));
    this.drawVessels(v, colony, board);
    this.vesselPool.end();
    for (const pool of this.patternPools) pool.end();
    this.glowPool.end();
    this.triPool.end();
    this.bandPool.end();
    this.blobPool.end();
    this.sheenPool.end();

    if (this.goo.isCachedAsTexture) this.goo.updateCacheTexture();
    else this.goo.cacheAsTexture({ resolution: this.cacheResolution, antialias: true });

    this.drawDepositMarks(colony, body);
    this.rebuildFlow(v, defense, colony, board, body, state);
    this.rebuildCores(defense, colony, board);
    this.rebuildMotes(v, colony, board, body, state);
    this.rebuildSpecks(colony, board);
    this.vasc = v;
    this.refreshSparks();
    this.drawStarveMarks(colony, board, state);
    this.rebuildStalks(colony, board, body, state);
    this.numbersDirty = true;
    if (this.numbers.visible) this.rebuildNumbers();
  }

  /**
   * Heartbeat dots (colony life, phase 2): one per cell. A connected cell beats with its core's
   * rhythm, delayed by its distance out along the supply tree, so each beat flows outward; how
   * much it swells follows its own defense. Cells at maximum biomass glow steadily.
   */
  private rebuildFlow(
    v: Vascular,
    defense: readonly number[],
    colony: readonly (Colony | null)[],
    board: ReturnType<typeof getBoard>,
    body: Body,
    state: GameState,
  ): void {
    // Sprites are pooled: replays redraw the board several times per turn.
    const pool = this.flowSprites.map((f) => f.sprite);
    this.flowSprites = [];
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
      const base = 0.35 + c.biomass * 0.02;
      s.scale.set(base);
      s.tint = c.connected ? lighten(playerColor(c.owner), 0.5) : 0x9aa3ad;
      const root = v.root[i] as number;
      const b = beat(root >= 0 ? (defense[root] as number) : 0);
      const pace = (this.styles.get(c.owner) ?? strainStyle(undefined)).pace;
      this.flowSprites.push({
        sprite: s,
        depth: Math.max(0, v.depth[i] as number),
        period: b.period * pace,
        depthAmp: b.depth,
        own: strength(defense[i] as number),
        base,
        connected: c.connected,
        full: !c.core && c.biomass >= maxBiomassFor(state, c, body),
      });
    });
    for (let k = used; k < pool.length; k++) {
      const spare = pool[k] as Sprite;
      spare.visible = false;
    }
    this.flowSprites.push(
      ...pool.slice(used).map((sprite) => ({
        sprite,
        depth: 0,
        period: 1,
        depthAmp: 0,
        own: 0,
        base: 0,
        connected: false,
        full: false,
      })),
    );
  }

  private rebuildCores(
    defense: readonly number[],
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
      // A core beats with its own defense: slow and deep when it is hard to take.
      const b = beat(defense[i] as number);
      const period = b.period * (this.styles.get(c.owner) ?? strainStyle(undefined)).pace;
      this.coreSprites.push({ g: n, cell: i, period, depthAmp: b.depth, fed: 0 });
    });
  }

  /**
   * Nutrient routes for the body's deposits and comets. Motes already travelling keep going
   * when their deposit still has a route (replays redraw the board many times a turn); the
   * rest are released.
   */
  private rebuildMotes(
    v: Vascular,
    colony: readonly (Colony | null)[],
    board: ReturnType<typeof getBoard>,
    body: Body,
    state: GameState,
  ): void {
    const comets = new Set(body.comets.map((c) => c.cell));
    const old = new Map(this.moteRoutes.map((r) => [r.from, r]));
    this.moteRoutes = resourceRoutes(body.radius, colony, v, (i, owner) =>
      cellYield(state, body, i, owner),
    ).map((r, k) => {
      const pts = new Float32Array(r.path.length * 2);
      r.path.forEach((cell, j) => {
        const p = hexToPixel(board.cells[cell] as Hex);
        pts[j * 2] = p.x;
        pts[j * 2 + 1] = p.y;
      });
      const end = r.path[r.path.length - 1] as number;
      const prev = old.get(r.from);
      return {
        from: r.from,
        pts,
        len: r.path.length,
        broken: r.broken,
        core: r.broken ? -1 : end,
        color: comets.has(r.from) ? 0xffe28a : depositColor(body.deposits[r.from]),
        every: MOTE.everyPerYield / r.yield,
        // Staggered so a board's deposits do not all fire together.
        wait: prev ? prev.wait : ((k * 0.37) % 1) * (MOTE.everyPerYield / r.yield),
      };
    });
    const byFrom = new Map(this.moteRoutes.map((r) => [r.from, r]));
    this.motesLive = this.motesLive.filter((m) => {
      const r = byFrom.get(m.route.from);
      if (!r || r.broken !== m.route.broken) {
        m.sprite.visible = false;
        this.moteSprites.push(m.sprite);
        return false;
      }
      m.route = r;
      m.at = Math.min(m.at, r.len - 1);
      return true;
    });
  }

  /** Moves the motes along their routes; spawns from the pool as each deposit's timer fires. */
  private tickMotes(dt: number): void {
    const off = this.calm || this.reduceMotion || !this.moteTex;
    this.moteLayer.visible = !off;
    if (off) {
      if (this.motesLive.length) this.rebuildMotesPool();
      for (const c of this.coreSprites) c.fed = 0;
      return;
    }
    for (const r of this.moteRoutes) {
      r.wait -= dt;
      if (r.wait > 0) continue;
      r.wait += r.every;
      if (r.wait < 0) r.wait = r.every;
      const sprite = this.takeMote();
      if (!sprite) continue;
      sprite.tint = r.color;
      this.motesLive.push({ sprite, route: r, at: 0, fizzle: -1 });
    }
    const live: Mote[] = [];
    for (const m of this.motesLive) {
      const r = m.route;
      const last = r.len - 1;
      if (m.fizzle < 0) {
        m.at = Math.min(last, m.at + MOTE.speed * dt);
        if (m.at >= last) {
          if (r.broken) m.fizzle = 0;
          else {
            const core = this.coreSprites.find((c) => c.cell === r.core);
            if (core) core.fed = Math.min(1, core.fed + MOTE.feed);
            this.releaseMote(m);
            continue;
          }
        }
      } else {
        m.fizzle += dt / MOTE.fizzle;
        if (m.fizzle >= 1) {
          this.releaseMote(m);
          continue;
        }
      }
      const seg = Math.min(last - 1, Math.floor(m.at));
      const f = last > 0 ? m.at - seg : 0;
      const i = Math.max(0, seg) * 2;
      const x0 = r.pts[i] as number;
      const y0 = r.pts[i + 1] as number;
      const x = last > 0 ? x0 + ((r.pts[i + 2] as number) - x0) * f : x0;
      const y = last > 0 ? y0 + ((r.pts[i + 3] as number) - y0) * f : y0;
      m.sprite.position.set(x, y);
      if (m.fizzle >= 0) {
        // A broken route: the mote reddens and shrinks where the supply line was cut.
        m.sprite.tint = MOTE.fizzleColor;
        m.sprite.alpha = 0.9 * (1 - m.fizzle);
        m.sprite.scale.set(MOTE.size * (1 + 0.6 * m.fizzle) * (1 - m.fizzle * 0.7));
      } else {
        m.sprite.alpha = 0.85 * Math.min(1, m.at / 0.35 + 0.15);
        m.sprite.scale.set(MOTE.size);
      }
      live.push(m);
    }
    this.motesLive = live;
    for (const c of this.coreSprites) c.fed *= Math.exp(-dt * MOTE.fedDecay);
  }

  private takeMote(): Sprite | null {
    let s = this.moteSprites.pop();
    if (!s) {
      if (this.moteLayer.children.length >= MOTE.cap || !this.moteTex) return null;
      s = new Sprite(this.moteTex);
      s.anchor.set(0.5);
      this.moteLayer.addChild(s);
    }
    s.visible = true;
    return s;
  }

  private releaseMote(m: Mote): void {
    m.sprite.visible = false;
    this.moteSprites.push(m.sprite);
  }

  private rebuildMotesPool(): void {
    for (const m of this.motesLive) this.releaseMote(m);
    this.motesLive = [];
  }

  /**
   * A draining rim on every cut-off cell: the full circle is 5+ turns left before it starves,
   * and it empties as the cell runs down (Dormancy grace included). Static.
   */
  private drawStarveMarks(
    colony: readonly (Colony | null)[],
    board: ReturnType<typeof getBoard>,
    state: GameState,
  ): void {
    const g = this.starveMarks;
    g.clear();
    this.starveRims = 0;
    const loss = state.rules.starvationLoss;
    colony.forEach((c, i) => {
      if (!c || c.connected || c.core) return;
      const left = starveTurnsLeft(c, playerRules(state, c.owner).dormancyTurns, loss);
      this.starveRims++;
      const p = hexToPixel(board.cells[i] as Hex);
      const r = HEX_SIZE * 0.62;
      g.circle(p.x, p.y, r).stroke({ width: 2.5, color: 0x000000, alpha: 0.35 });
      const frac = Math.min(1, left / 5);
      // One open polyline from the top: no moveTo + arc, whose doubled start point can leave a
      // stray line (playtest).
      const pts = arcPoints(p.x, p.y, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      if (pts.length) {
        g.poly(pts, false).stroke({
          width: 2.5,
          color: left <= 1 ? 0xff6b6b : 0xc9d1e0,
          alpha: 0.9,
          cap: "round",
        });
      }
    });
  }

  /**
   * Fruiting bodies are stalks that grow taller with maturity and glow when mature; comet
   * deposits are bright shards; the viewer's spores in flight mark their landing cell
   * (SPEC §10.4, §6).
   */
  private rebuildStalks(
    colony: readonly (Colony | null)[],
    board: ReturnType<typeof getBoard>,
    body: Body,
    state: GameState,
  ): void {
    const g = this.stalks;
    g.clear();
    this.stalkGlow.clear();
    const full = Math.max(1, state.rules.fruitMatureTurns);
    colony.forEach((c, i) => {
      if (!c || c.fruiting === null) return;
      const p = hexToPixel(board.cells[i] as Hex);
      const grown = 1 - c.fruiting / full;
      const height = 10 + 18 * grown;
      const color = lighten(playerColor(c.owner), 0.35);
      g.moveTo(p.x, p.y)
        .quadraticCurveTo(p.x + 5, p.y - height * 0.5, p.x, p.y - height)
        .stroke({ width: 4, color, alpha: 0.95, cap: "round" });
      g.circle(p.x, p.y - height, 4 + 3 * grown).fill(lighten(color, 0.4));
      if (c.fruiting === 0) {
        for (let k = 4; k >= 1; k--)
          this.stalkGlow.circle(p.x, p.y - height, 4 + k * 4).fill({ color: 0xffffff, alpha: 0.1 });
      }
    });
    for (const comet of body.comets) {
      const p = hexToPixel(board.cells[comet.cell] as Hex);
      for (const [dx, dy, r] of [
        [-5, 2, 6],
        [4, -3, 7],
        [1, 6, 4],
      ] as const)
        g.star(p.x + dx, p.y + dy, 4, r, r * 0.35).fill({ color: DEPOSIT_COLORS.ice, alpha: 0.95 });
      g.circle(p.x, p.y, HEX_SIZE * 0.75).stroke({ width: 2, color: 0xcdefff, alpha: 0.6 });
    }
    for (const sp of state.spores) {
      if (sp.owner !== this.viewer || sp.targetBody !== body.id) continue;
      const p = hexToPixel(sp.targetCell);
      const color = trailColor(sp.owner);
      const d = HEX_SIZE * 0.7;
      g.circle(p.x, p.y, d).stroke({ width: 2, color, alpha: 0.9 });
      g.moveTo(p.x - d - 5, p.y)
        .lineTo(p.x - d + 5, p.y)
        .moveTo(p.x + d - 5, p.y)
        .lineTo(p.x + d + 5, p.y)
        .moveTo(p.x, p.y - d - 5)
        .lineTo(p.x, p.y - d + 5)
        .moveTo(p.x, p.y + d - 5)
        .lineTo(p.x, p.y + d + 5)
        .stroke({ width: 2, color, alpha: 0.9 });
    }
  }

  /** Biomass labels are only built while visible (zoomed in or long-press). */
  private rebuildNumbers(): void {
    if (!this.numbersDirty) return;
    this.numbersDirty = false;
    const colony = this.colony;
    const board = getBoard(this.body.radius);
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

  /** Fruiting hints and feelers are shown only while the viewer can still plan orders. */
  setPlanHints(on: boolean): void {
    if (on === this.planHints) return;
    this.planHints = on;
    this.refreshSparks();
  }

  /** The viewer's cells that could fruit now (after queued orders) sparkle faintly. */
  private refreshSparks(): void {
    if (!this.state || !this.sparkTex) return;
    // Only while planning, on the live state (not a replay frame).
    const live = this.boardLive && this.planHints && this.inputEnabled;
    const cells = live ? fruitableCells(this.state, this.body, this.viewer, this.pending) : [];
    this.refreshFeelers(live);
    const board = getBoard(this.body.radius);
    let used = 0;
    if (live) {
      for (const i of cells) {
        let sp = this.sparks[used];
        if (!sp) {
          const sprite = new Sprite(this.sparkTex);
          sprite.anchor.set(0.5);
          sprite.blendMode = "add";
          this.sparkLayer.addChild(sprite);
          sp = { sprite, phase: 0 };
          this.sparks.push(sp);
        }
        used++;
        const p = hexToPixel(board.cells[i] as Hex);
        // Upper left of the cell; the deposit badge sits upper right.
        sp.sprite.position.set(p.x - HEX_SIZE * 0.42, p.y - HEX_SIZE * 0.42);
        sp.sprite.visible = true;
        sp.phase = (i * 0.618) % 1;
      }
    }
    for (let k = used; k < this.sparks.length; k++)
      (this.sparks[k] as { sprite: Sprite }).sprite.visible = false;
    this.fruitable = used;
  }

  /** Feelers from the viewer's frontier toward the empty cells it could grow into. */
  private refreshFeelers(live: boolean): void {
    const board = getBoard(this.body.radius);
    const list = live ? spread(frontier(this.body, this.colony, this.viewer), MAX_FEELERS) : [];
    const color = lighten(playerColor(this.viewer), 0.15);
    this.feelerPace = (this.styles.get(this.viewer) ?? strainStyle(undefined)).pace;
    let used = 0;
    for (const f of list) {
      if (!this.feelerTex) break;
      let fs = this.feelerSprites[used];
      if (!fs) {
        const sprite = new Sprite(this.feelerTex);
        sprite.anchor.set(0, 0.5);
        this.feelerLayer.addChild(sprite);
        fs = { sprite, phase: 0, len: 0, angle: 0 };
        this.feelerSprites.push(fs);
      }
      used++;
      const a = hexToPixel(board.cells[f.from] as Hex);
      const b = hexToPixel(board.cells[f.to] as Hex);
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      fs.angle = Math.atan2(b.y - a.y, b.x - a.x);
      // From the cell's edge, reaching toward (never into) the empty cell.
      fs.sprite.position.set(a.x + (b.x - a.x) * 0.4, a.y + (b.y - a.y) * 0.4);
      fs.sprite.rotation = fs.angle;
      fs.sprite.tint = color;
      fs.sprite.visible = true;
      fs.len = d * 0.3;
      fs.phase = ((f.from * 7 + f.to * 13) % 97) / 97;
      fs.sprite.width = fs.len * 0.6;
      fs.sprite.height = 6;
      fs.sprite.alpha = 0.75;
    }
    for (let k = used; k < this.feelerSprites.length; k++) {
      (this.feelerSprites[k] as { sprite: Sprite }).sprite.visible = false;
    }
    this.feelers = used;
  }

  /** Where Sporer colonies shed specks: their cells, spread under a cap. */
  private rebuildSpecks(
    colony: readonly (Colony | null)[],
    board: ReturnType<typeof getBoard>,
  ): void {
    const cells: { x: number; y: number; tint: number }[] = [];
    colony.forEach((c, i) => {
      if (!c || !this.styles.get(c.owner)?.specks) return;
      const p = hexToPixel(board.cells[i] as Hex);
      cells.push({ x: p.x, y: p.y, tint: lighten(playerColor(c.owner), 0.6) });
    });
    this.speckCells = spread(cells, 60);
    // Specks already drifting finish their drift; still specks are placed afresh.
    if (this.reduceMotion) this.stillSpecks();
  }

  private takeSpeck(): Sprite | null {
    let s = this.speckSprites.pop();
    if (!s) {
      if (this.speckLayer.children.length >= MAX_SPECKS || !this.dot) return null;
      s = new Sprite(this.dot);
      s.anchor.set(0.5);
      s.blendMode = "add";
      this.speckLayer.addChild(s);
    }
    s.visible = true;
    return s;
  }

  private clearSpecks(): void {
    for (const sp of this.specksLive) {
      sp.sprite.visible = false;
      this.speckSprites.push(sp.sprite);
    }
    this.specksLive = [];
  }

  /** Reduce motion: one still speck above each of the first Sporer cells, no drift. */
  private stillSpecks(): void {
    this.clearSpecks();
    for (const c of spread(this.speckCells, MAX_SPECKS)) {
      const sprite = this.takeSpeck();
      if (!sprite) break;
      sprite.tint = c.tint;
      sprite.alpha = 0.55;
      sprite.scale.set(0.16);
      sprite.position.set(c.x + 6, c.y - 12);
      this.specksLive.push({ sprite, x: c.x + 6, y: c.y - 12, age: 0, drift: 0 });
    }
  }

  /** Feelers twitch and specks drift; both rest in Calm, and hold still with reduce motion. */
  private tickPersonality(dt: number, t: number): void {
    const calm = this.calm;
    this.feelerLayer.visible = !calm;
    this.speckLayer.visible = !calm;
    if (calm) return;
    const period = FEELER_PERIOD * this.feelerPace;
    for (const f of this.feelerSprites) {
      if (!f.sprite.visible) continue;
      if (this.reduceMotion) {
        f.sprite.width = f.len * 0.6;
        f.sprite.rotation = f.angle;
        continue;
      }
      const u = (t / period + f.phase) * Math.PI * 2;
      // A slow reach with a quick flick on top: alive, but never past the cell's edge.
      const reach = 0.6 + 0.25 * Math.sin(u) + 0.15 * Math.max(0, Math.sin(u * 3.1)) ** 4;
      f.sprite.width = f.len * Math.min(1, reach);
      f.sprite.rotation = f.angle + 0.14 * Math.sin(u * 1.7 + f.phase * 5);
    }
    if (this.reduceMotion) {
      if (this.specksLive.length === 0 && this.speckCells.length) this.stillSpecks();
      return;
    }
    if (this.specksLive.length && this.specksLive[0]?.drift === 0) this.clearSpecks();
    this.speckClock += dt;
    while (this.speckCells.length && this.speckClock >= SPECK_EVERY) {
      this.speckClock -= SPECK_EVERY;
      const c = this.speckCells[this.speckNext++ % this.speckCells.length] as {
        x: number;
        y: number;
        tint: number;
      };
      const sprite = this.takeSpeck();
      if (!sprite) break;
      sprite.tint = c.tint;
      const k = this.speckNext * 0.618;
      const x = c.x + ((k % 1) - 0.5) * HEX_SIZE;
      this.specksLive.push({ sprite, x, y: c.y, age: 0, drift: 0.6 + (k % 0.4) });
    }
    if (!this.speckCells.length) this.speckClock = 0;
    const live: typeof this.specksLive = [];
    for (const sp of this.specksLive) {
      sp.age += dt / SPECK_LIFE;
      if (sp.age >= 1) {
        sp.sprite.visible = false;
        this.speckSprites.push(sp.sprite);
        continue;
      }
      // Rise and sway, fading in and out.
      sp.sprite.position.set(
        sp.x + Math.sin(sp.age * 6 + sp.drift * 9) * 4,
        sp.y - sp.age * 26 * sp.drift,
      );
      sp.sprite.alpha = 0.7 * Math.sin(sp.age * Math.PI);
      sp.sprite.scale.set(0.16 + 0.08 * (1 - sp.age));
      live.push(sp);
    }
    this.specksLive = live;
  }

  /** Traces a held cell's supply route to its core and shows its defense. */
  private inspect(h: Hex): void {
    const board = getBoard(this.body.radius);
    const i = board.indexOf(h.q, h.r);
    const c = i >= 0 ? this.colony[i] : null;
    if (!c || !this.vasc) return;
    const d = defenseParts(this.state, this.body, this.colony, i);
    const color = lighten(playerColor(c.owner), 0.6);
    const g = this.inspectG.clear();
    const pts = supplyPath(this.vasc, i).map((k) => hexToPixel(board.cells[k] as Hex));
    if (pts.length > 1) {
      for (const [width, stroke, alpha] of [
        [8, 0x02040c, 0.6],
        [3.5, color, 0.95],
      ] as const) {
        const [first, ...rest] = pts as [Point, ...Point[]];
        g.moveTo(first.x, first.y);
        for (const q of rest) g.lineTo(q.x, q.y);
        g.stroke({ width, color: stroke, alpha, cap: "round", join: "round" });
      }
      const core = pts[pts.length - 1] as Point;
      g.circle(core.x, core.y, HEX_SIZE * 0.8).stroke({ width: 3, color, alpha: 0.95 });
    }
    const p = hexToPixel(h);
    g.circle(p.x, p.y, HEX_SIZE * 0.8).stroke({ width: 3, color: 0xffffff, alpha: 0.95 });
    const text = defenseText(d, c.connected);
    this.inspectLabel.removeChildren().forEach((x) => x.destroy());
    const t = new Text({
      text,
      style: {
        fontFamily: "Inter, system-ui, sans-serif",
        fontSize: 14,
        fontWeight: "700",
        fill: 0xffffff,
        align: "center",
        lineHeight: 18,
        stroke: { color: 0x02040c, width: 4 },
      },
      resolution: 2,
    });
    t.anchor.set(0.5, 1);
    const k = 1 / Math.max(0.8, this.zoom);
    t.scale.set(k);
    // Kept on screen, with a dark backing so it reads over the biomass numbers.
    const w = t.width;
    const ht = t.height;
    const pad = 6 * k;
    const left = this.screenToWorld({ x: 8, y: 0 }).x + w / 2 + pad;
    const right = this.screenToWorld({ x: this.app.screen.width - 8, y: 0 }).x - w / 2 - pad;
    const x = left > right ? p.x : Math.min(right, Math.max(left, p.x));
    const y = p.y - HEX_SIZE * 0.95;
    t.position.set(x, y);
    const back = new Graphics()
      .roundRect(x - w / 2 - pad, y - ht - pad, w + pad * 2, ht + pad * 2, 8 * k)
      .fill({ color: 0x070b1a, alpha: 0.82 });
    this.inspectLabel.addChild(back, t);
    this.inspected = i;
    this.inspectText = text;
    this.inspectRoute = pts.length;
  }

  private clearInspect(): void {
    if (this.inspected < 0) return;
    this.inspectG.clear();
    this.inspectLabel.removeChildren().forEach((x) => x.destroy());
    this.inspected = -1;
    this.inspectText = "";
    this.inspectRoute = 0;
  }

  private tick(dt: number): void {
    this.time += dt / 1000;
    const t = this.time;
    if (this.mode === "system") {
      if (!this.reduceMotion) this.system.tick(dt);
      return;
    }
    this.tickMotes(dt / 1000);
    this.tickPersonality(dt / 1000, t);
    // Fruiting hints twinkle; with reduce motion they hold still.
    for (const sp of this.sparks) {
      if (!sp.sprite.visible) continue;
      const tw = this.reduceMotion ? 0.5 : 0.5 + 0.5 * Math.sin((t * 0.9 + sp.phase) * Math.PI * 2);
      sp.sprite.alpha = 0.3 + 0.45 * tw;
      sp.sprite.scale.set(0.95 + 0.35 * tw);
    }
    if (this.reduceMotion) {
      // Still, but the same information: brightness follows strength; full cells glow.
      for (const f of this.flowSprites) {
        f.sprite.alpha = !f.connected ? 0.2 : f.full ? 0.6 : 0.18 + 0.4 * f.own;
        f.sprite.scale.set(f.base);
      }
      for (const c of this.coreSprites) c.g.scale.set(1);
      return;
    }
    for (const f of this.flowSprites) {
      if (!f.connected) {
        f.sprite.alpha = 0.12 + 0.18 * (0.5 + 0.5 * Math.sin(t * 1.2));
        continue;
      }
      if (f.full) {
        // Full: nothing more to grow into. A steady glow, not a beat.
        f.sprite.alpha = 0.6;
        f.sprite.scale.set(f.base * 1.12);
        continue;
      }
      // The beat leaves the core and flows outward: farther cells swell later.
      const swell = pulse(t / f.period - f.depth * WAVE_STEP) * f.depthAmp;
      f.sprite.alpha = 0.1 + swell * (0.35 + 0.45 * f.own);
      f.sprite.scale.set(f.base * (1 + 0.35 * swell * (0.4 + 0.6 * f.own)));
    }
    // Each core beats, and brightens a little as nutrients arrive.
    for (const c of this.coreSprites) {
      c.g.scale.set(1 + 0.13 * c.depthAmp * pulse(t / c.period) + 0.12 * c.fed);
    }
    // Mature stalks glow (SPEC §10.4).
    this.stalkGlow.alpha = 0.45 + 0.35 * Math.sin(t * 4);
  }

  // ---------------------------------------------------------------------------------------
  // Planning overlays

  /** Queued orders: ghost paths, reinforce rings and retract crosses. */
  setPlan(orders: readonly Order[], player: PlayerId, previews: StepPreview[][]): void {
    this.plan = { orders, player, previews };
    if (player === this.viewer) {
      this.pending = orders;
      this.refreshSparks();
    }
    const g = this.planG;
    g.clear();
    this.planShown = 0;
    const color = playerColor(player);
    orders.forEach((o, k) => {
      if (o.type === "draft") return;
      if (o.type === "launch" && o.targetBody === this.bodyId) {
        const p = hexToPixel(o.targetCell);
        g.circle(p.x, p.y, HEX_SIZE * 0.7).stroke({ width: 2.5, color, alpha: 0.9 });
        g.circle(p.x, p.y, 4).fill(color);
      }
      if (o.body !== this.bodyId) return;
      this.planShown++;
      if (o.type === "fruit") {
        const p = hexToPixel(o.cell);
        for (let y = 0; y < 22; y += 6)
          g.moveTo(p.x, p.y - y)
            .lineTo(p.x, p.y - y - 3)
            .stroke({ width: 3, color: lighten(color, 0.4), alpha: 0.9 });
        g.circle(p.x, p.y - 26, 5).stroke({ width: 2, color: 0xffffff, alpha: 0.9 });
        return;
      }
      if (o.type === "launch") {
        const p = hexToPixel(o.cell);
        g.circle(p.x, p.y, HEX_SIZE * 0.8).stroke({ width: 3, color: 0xffffff, alpha: 0.9 });
        g.moveTo(p.x, p.y - 4)
          .lineTo(p.x, p.y - 30)
          .moveTo(p.x - 7, p.y - 23)
          .lineTo(p.x, p.y - 30)
          .lineTo(p.x + 7, p.y - 23)
          .stroke({ width: 3, color: lighten(color, 0.5), alpha: 0.95, cap: "round" });
        return;
      }
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
    const here = (e: Effect) => e.body === this.bodyId || e.body === -1;
    const cells = frames.flatMap((f) => f.effects.filter(here).flatMap(effectCells));
    if (cells.length > 0 && !ctl.skipped()) this.frameCells(cells);
    for (const frame of frames) {
      if (ctl.skipped()) break;
      onFrame?.(frame);
      if (ctl.reduceMotion || !frame.effects.some(here)) {
        await this.wait(ctl.reduceMotion ? frame.duration * 0.6 : frame.duration * 0.4, ctl);
        this.setBoard(frame.colony.get(this.bodyId) ?? this.colony);
        continue;
      }
      await this.animateFrame(frame, ctl);
      this.setBoard(frame.colony.get(this.bodyId) ?? this.colony);
    }
    this.fx.clear();
    this.flash.clear();
    this.fxLabels.removeChildren().forEach((c) => c.destroy());
    const last = frames[frames.length - 1];
    if (last) this.setBoard(last.colony.get(this.bodyId) ?? this.colony);
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
          this.setBoard(frame.colony.get(this.bodyId) ?? this.colony);
        }
        if (p >= 1 || ctl.skipped()) {
          this.app.ticker.remove(step);
          for (const l of labels.values()) l.destroy();
          this.fx.clear();
          this.flash.clear();
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
      if (e.body !== this.bodyId && e.body !== -1) continue;
      switch (e.kind) {
        case "flash": {
          const { w, h } = this.screen;
          this.flash.clear();
          this.flash
            .rect(0, 0, w, h)
            .fill({ color: 0xffc46b, alpha: 0.35 * Math.sin(Math.PI * p) });
          break;
        }
        case "flare": {
          const c = hexToPixel(e.cell);
          g.circle(c.x, c.y, HEX_SIZE * (0.4 + 0.5 * ease)).fill({
            color: 0xffa040,
            alpha: 0.5 * (1 - p),
          });
          break;
        }
        case "comet": {
          const c = hexToPixel(e.cell);
          if (e.arrived) {
            const k = Math.min(1, p / 0.55);
            const from = { x: c.x + 260, y: c.y - 320 };
            const x = from.x + (c.x - from.x) * k;
            const y = from.y + (c.y - from.y) * k;
            g.moveTo(from.x + (x - from.x) * 0.6, from.y + (y - from.y) * 0.6)
              .lineTo(x, y)
              .stroke({ width: 5, color: 0xcdefff, alpha: 0.8 * (1 - p * 0.5), cap: "round" });
            g.circle(x, y, 7).fill(0xffffff);
            if (p > 0.55) {
              const q = (p - 0.55) / 0.45;
              g.circle(c.x, c.y, HEX_SIZE * (0.5 + 1.6 * q)).stroke({
                width: 6 * (1 - q),
                color: 0xcdefff,
                alpha: 1 - q,
              });
            }
          } else {
            g.circle(c.x, c.y, HEX_SIZE * 0.6).fill({ color: 0xcdefff, alpha: 0.4 * (1 - p) });
          }
          break;
        }
        case "fruit": {
          const c = hexToPixel(e.cell);
          const color = lighten(playerColor(e.player), 0.4);
          g.moveTo(c.x, c.y)
            .lineTo(c.x, c.y - 14 * ease)
            .stroke({ width: 4, color, alpha: 0.95, cap: "round" });
          break;
        }
        case "launch": {
          const c = hexToPixel(e.cell);
          const color = lighten(playerColor(e.player), 0.5);
          if (e.fizzled) {
            g.circle(c.x, c.y - 10, 6 * (1 - p)).fill({ color: 0x9aa3ad, alpha: 1 - p });
            break;
          }
          // The "thoom": a ring at the base, then the mote shoots up off the body.
          g.circle(c.x, c.y, HEX_SIZE * (0.4 + 1.2 * ease)).stroke({
            width: 5 * (1 - p),
            color,
            alpha: 1 - p,
          });
          const y = c.y - 20 - 420 * p * p;
          g.moveTo(c.x, y + 40)
            .lineTo(c.x, y)
            .stroke({ width: 4, color, alpha: 0.6, cap: "round" });
          g.circle(c.x, y, 6).fill(0xffffff);
          break;
        }
        case "land": {
          const c = hexToPixel(e.cell);
          const color = lighten(playerColor(e.player), 0.5);
          const k = Math.min(1, p / 0.5);
          if (p < 0.5) {
            const y = c.y - 360 * (1 - k) * (1 - k);
            g.moveTo(c.x, y - 36)
              .lineTo(c.x, y)
              .stroke({ width: 4, color, alpha: 0.6, cap: "round" });
            g.circle(c.x, y, 6).fill(0xffffff);
          } else {
            const q = (p - 0.5) / 0.5;
            const ring =
              e.outcome === "repelled" || e.outcome === "collided"
                ? 0xffffff
                : playerColor(e.player);
            g.circle(c.x, c.y, HEX_SIZE * (0.5 + 1.8 * q)).stroke({
              width: 7 * (1 - q),
              color: ring,
              alpha: 1 - q,
            });
          }
          break;
        }
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
    case "flash":
      return [];
    default:
      return [e.cell];
  }
}

/** Mote tuning (client presentation only, so not sim config). Speed in cells per second. */
const MOTE = {
  cap: 36,
  speed: 2.5,
  /** Seconds between motes for a deposit yielding 1 a turn; higher yields send more. */
  everyPerYield: 2.4,
  size: 0.5,
  fizzle: 0.45,
  fizzleColor: 0xff5a4a,
  feed: 0.45,
  fedDecay: 3,
} as const;

interface MoteRoute {
  from: number;
  /** Cell centres along the route, deposit first, as x,y pairs. */
  pts: Float32Array;
  len: number;
  broken: boolean;
  /** The core cell it feeds, or -1 for a broken route. */
  core: number;
  color: number;
  every: number;
  wait: number;
}

interface Mote {
  sprite: Sprite;
  route: MoteRoute;
  /** Distance along the route, in cells. */
  at: number;
  /** -1 while travelling; 0..1 while fizzling at a break. */
  fizzle: number;
}

/** The badge colour of a deposit kind (motes match their badges). */
function depositColor(kind: DepositKind | null | undefined): number {
  if (kind === "ice") return DEPOSIT_COLORS.ice;
  if (kind === "mineral") return DEPOSIT_COLORS.mineral;
  return 0x5fbf5c;
}

/** Feelers: at most this many, spread over the frontier; one twitch cycle in seconds. */
const MAX_FEELERS = 32;
const FEELER_PERIOD = 1.8;
/** Spore specks: the pool cap, seconds between specks, and how long each drifts. */
const MAX_SPECKS = 24;
const SPECK_EVERY = 0.22;
const SPECK_LIFE = 2.4;
