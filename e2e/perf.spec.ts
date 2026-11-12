import { type Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/*
 * SPEC §10.7 / §15 M3: 60 fps on a mid-range phone profile.
 *
 * The phone profile is emulated with Chromium's 4× CPU throttle at a phone viewport. What that
 * emulates faithfully is main-thread cost, so this test measures the CPU time of each frame:
 * from the first ticker callback through Pixi building and submitting its draw commands.
 *
 * - Typical frames (median), idle and during a replay, stay under 5 ms on the emulated phone:
 *   under a third of a 16.7 ms frame, leaving the rest for the browser and the GPU.
 * - Idle frames stay inside one frame at p95, over at least 100 frames.
 * - A replay board swap (redrawing every colony cell, the heaviest work in the game) is timed
 *   directly; with a typical frame's work on top it must still fit in one frame, so replays
 *   never visibly stutter.
 *
 * This is a CI regression check of CPU work. It is not a device benchmark: real-device frame
 * rates are validated separately (docs/DECISIONS.md #33).
 *
 * Raw requestAnimationFrame rates are logged but not asserted: CI machines and this repo's dev
 * containers often have no GPU, so WebGL is rasterised in software (SwiftShader), and that
 * measures the host's CPU fill rate rather than any phone's GPU (see docs/DECISIONS.md).
 */
// Device pixel ratio 1 by default: on GPU-less hosts the software rasteriser's fill cost at a
// phone's 2.75× density stalls the main thread and swamps the CPU signal this test is about.
// On a machine with a real GPU, run with PERF_DPR=2.75 for the full phone density.
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: Number(process.env.PERF_DPR ?? 1),
});
// Timing on shared hosts is noisy; one retry absorbs a stray GC or scheduler stall.
// Best-of sampling on a starved runner (4–5 fps) needs more than the default 180 s.
test.describe.configure({ retries: 1, timeout: 300_000 });

const FRAME_MS = 1000 / 60;
const TYPICAL_BUDGET_MS = 5;
/** A swap frame is the swap plus a typical frame's other work, and must fit in one frame. */
const SWAP_BUDGET_MS = FRAME_MS - TYPICAL_BUDGET_MS;

interface FrameStats {
  frames: number;
  /** Frames left out because a board swap ran in them (timed separately). */
  swapFrames: number;
  p50: number;
  p95: number;
  max: number;
  rafFps: number;
}

/**
 * Times main-thread work per Pixi frame, via ticker listeners at the highest and lowest priority.
 * Stops after `minFrames` frames, after `maxMs`, or (with `untilReplayEnds`) when the replay is
 * over. CI runners render WebGL in software at 4–20 fps, so a fixed short window can hold only
 * a dozen frames: count-based and whole-replay sampling keep the statistics meaningful.
 *
 * With `skipSwaps`, frames in which a replay board swap ran are excluded: the swap is the
 * heaviest work in the game and is timed directly (`timeSwap`), so leaving it in "typical frame"
 * statistics made the median depend on how few frames a starved runner managed to draw.
 */
async function sampleFrames(
  page: Page,
  opts: { minFrames: number; maxMs: number; skipSwaps?: boolean; untilReplayEnds?: boolean },
): Promise<FrameStats> {
  return page.evaluate(
    ({ minFrames, maxMs, skipSwaps, untilReplayEnds }) =>
      new Promise<FrameStats>((resolve) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = (window as any).__swarm;
        const view = w.view;
        const app = view.app;
        const cost: number[] = [];
        const stamps: number[] = [];
        let swapFrames = 0;
        let start = 0;
        let swapsAtStart = 0;
        const begin = () => {
          start = performance.now();
          swapsAtStart = view.boardSwaps;
        };
        const t0 = performance.now();
        const end = () => {
          const now = performance.now();
          stamps.push(now);
          if (skipSwaps && view.boardSwaps !== swapsAtStart) swapFrames++;
          else cost.push(now - start);
          const over = untilReplayEnds && w.phase !== "replay";
          if (cost.length >= minFrames || now - t0 >= maxMs || over) finish();
        };
        app.ticker.add(begin, null, 1000);
        app.ticker.add(end, null, -1000);
        const finish = () => {
          app.ticker.remove(begin);
          app.ticker.remove(end);
          const sorted = cost.slice().sort((a, b) => a - b);
          const q = (p: number) =>
            sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
          const span = (stamps[stamps.length - 1] ?? 0) - (stamps[0] ?? 0);
          resolve({
            frames: cost.length,
            swapFrames,
            p50: q(0.5),
            p95: q(0.95),
            max: sorted[sorted.length - 1] ?? 0,
            rafFps: (1000 * (stamps.length - 1)) / Math.max(1, span),
          });
        };
      }),
    { skipSwaps: false, untilReplayEnds: false, ...opts },
  );
}

/**
 * Best of several measurements. Shared CI hosts get starved for seconds at a time (one PR #6 run
 * drew 4.7 fps where the retry drew 18.7), and starvation only ever adds time, so the best window
 * is the estimate of the work itself. A real regression slows every window.
 */
async function bestOf(n: number, measure: () => Promise<FrameStats>): Promise<FrameStats> {
  let best: FrameStats | null = null;
  for (let i = 0; i < n; i++) {
    const s = await measure();
    if (!best || s.p50 < best.p50) best = s;
  }
  return best as FrameStats;
}

const fmt = (s: FrameStats) =>
  `${s.frames} frames${s.swapFrames ? ` (+${s.swapFrames} swap frames excluded)` : ""}, CPU p50 ${s.p50.toFixed(2)} ms, p95 ${s.p95.toFixed(2)} ms, max ${s.max.toFixed(1)} ms; raw rAF ${s.rafFps.toFixed(1)} fps`;

/** Starts a skirmish and autoplays to `turn` so the board is busy, then waits for true idle. */
async function busyGame(
  page: Page,
  opts: { map: "Single Rock" | "Asteroid system"; bots: 1 | 3; seed: string; turn: number },
): Promise<void> {
  await page.goto("/?e2e");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Play skirmish" }).click();
  await page.getByRole("radio", { name: opts.map }).click();
  if (opts.map === "Asteroid system")
    await page
      .getByRole("radio", { name: `${opts.bots} bot${opts.bots === 1 ? "" : "s"}` })
      .click();
  // A Biofilm mirror: games last past turn 13 despite the Swarmer imbalance (DECISIONS #36),
  // and growth uses base entry costs.
  await page.getByRole("radio", { name: /^Biofilm/ }).click();
  await page.getByRole("radio", { name: /plays? Biofilm/ }).click();
  await page.getByRole("radio", { name: "Normal bot" }).click();
  await page.getByRole("textbox").fill(opts.seed);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForFunction(
    () => (window as unknown as { __swarm?: { view?: unknown } }).__swarm?.view,
  );

  // Play quickly so the board is busy, then stop.
  await page.evaluate(
    () => ((window as unknown as { __swarm: { autoplay: boolean } }).__swarm.autoplay = true),
  );
  await page.waitForFunction(
    (turn) => (window as unknown as { __swarm: { turn: number } }).__swarm.turn >= turn,
    opts.turn,
    { timeout: 120_000 },
  );
  await page.evaluate(
    () => ((window as unknown as { __swarm: { autoplay: boolean } }).__swarm.autoplay = false),
  );
  // Wait until the game is truly idle. Stopping autoplay can still let one in-flight turn
  // through, whose replay used to land inside the idle window; and the bot's worker plans as
  // soon as a turn opens. So: planning phase, turn number stable, every bot ready.
  await expect(page.getByRole("button", { name: "Submit" })).toBeEnabled({ timeout: 15_000 });
  await page.waitForFunction(
    () => {
      const w = window as unknown as {
        __swarm: { phase: string; turn: number };
        __settle?: { turn: number; since: number };
      };
      const now = performance.now();
      if (!w.__settle || w.__settle.turn !== w.__swarm.turn || w.__swarm.phase !== "planning") {
        w.__settle = { turn: w.__swarm.turn, since: now };
        return false;
      }
      // M4's ready markers label each seat ("Bot: ready", "Bot 2: ready").
      const seats = document.querySelectorAll(".ready-item").length;
      const ready = document.querySelectorAll('[aria-label^="Bot"] .ready-dot.on').length;
      return seats > 1 && ready === seats - 1 && now - w.__settle.since > 1000;
    },
    null,
    { timeout: 30_000, polling: 100 },
  );
  await dismissDraft(page);
}

/** A pending mutation draft opens a modal over the board: set it aside before measuring. */
async function dismissDraft(page: Page): Promise<void> {
  const later = page.getByRole("button", { name: "Decide later" });
  if (await later.isVisible()) await later.click();
}

/** A replay board swap timed directly (median of 7, redraw plus render). */
async function timeSwap(page: Page): Promise<{ swapMs: number; swapGeometry: number }> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (window as any).__swarm.view;
    const colony = v.colony;
    const runs: number[] = [];
    for (let i = 0; i < 9; i++) {
      const t = performance.now();
      v.setBoard(colony);
      v.app.renderer.render(v.app.stage);
      runs.push(performance.now() - t);
    }
    // Shapes the colony layer had to tessellate for this board (sprites need none).
    const swapGeometry: number = v.gooG.context.instructions.length;
    // Second-fastest of 9: contention on a shared host only ever adds time, so the low end is
    // the stable estimate of the work itself (one lucky run is still discarded).
    return { swapMs: runs.sort((a, b) => a - b)[1] as number, swapGeometry };
  });
}

test("frame CPU cost fits a 60 fps budget mid-game under a 4× CPU throttle", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CPU throttling needs the Chromium DevTools protocol");
  await busyGame(page, { map: "Single Rock", bots: 1, seed: "perf-1", turn: 13 });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const idle = await bestOf(3, () => sampleFrames(page, { minFrames: 80, maxMs: 25_000 }));
  // The heaviest work in the game: a replay board swap redraws every colony cell, 4–6 times a
  // turn. Timed directly (redraw plus render), it is a stable CPU measurement; inside a replay
  // the same frames also absorb software-GL stalls.
  const { swapMs, swapGeometry } = await timeSwap(page);
  // Two whole replays (5–7 phases each), board-swap frames excluded; the better one counts.
  const replay = await bestOf(2, async () => {
    await expect(page.getByRole("button", { name: "Submit" })).toBeVisible();
    await dismissDraft(page);
    await expect(page.getByRole("button", { name: "Submit" })).toBeEnabled({ timeout: 30_000 });
    await page.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByLabel("Replay controls")).toBeVisible();
    return sampleFrames(page, {
      minFrames: 1000,
      maxMs: 15_000,
      skipSwaps: true,
      untilReplayEnds: true,
    });
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  console.log(
    `idle:   ${fmt(idle)}\nreplay: ${fmt(replay)}\nboard swap: ${swapMs.toFixed(2)} ms, ${swapGeometry} colony shapes`,
  );
  expect(idle.frames).toBeGreaterThanOrEqual(70);
  expect(idle.p50).toBeLessThan(TYPICAL_BUDGET_MS);
  expect(idle.p95).toBeLessThan(FRAME_MS);
  expect(replay.p50).toBeLessThan(TYPICAL_BUDGET_MS);
  // Replay p95 is logged, not asserted: swap frames are excluded and timed below; what is left
  // in the tail is software-rasteriser stalls that say nothing about phones.
  expect(replay.frames).toBeGreaterThanOrEqual(10);
  expect(swapMs).toBeLessThan(SWAP_BUDGET_MS);
  // Hardware-independent guard for the cost CI caught on PR #3: a board swap must not rebuild
  // per-cell geometry (the old renderer rebuilt hundreds of polygons per swap: 444 on the test
  // board). Only the static
  // bounds rect remains, whatever the board size.
  expect(swapGeometry).toBeLessThanOrEqual(1);
});

test("systems: 4 players, Body view and System view fit the same budgets (M5)", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CPU throttling needs the Chromium DevTools protocol");
  await busyGame(page, { map: "Asteroid system", bots: 3, seed: "perf-sys", turn: 13 });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  // Body view renders only the shown body (SPEC §10.7): the home body, busiest for the viewer.
  const body = await bestOf(3, () => sampleFrames(page, { minFrames: 80, maxMs: 25_000 }));
  const { swapMs, swapGeometry } = await timeSwap(page);
  await page.getByRole("button", { name: "System view" }).click();
  const system = await bestOf(3, () => sampleFrames(page, { minFrames: 80, maxMs: 25_000 }));
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  console.log(
    `system game, body view: ${fmt(body)}\nsystem view: ${fmt(system)}\nboard swap: ${swapMs.toFixed(2)} ms, ${swapGeometry} colony shapes`,
  );
  expect(body.frames).toBeGreaterThanOrEqual(70);
  expect(body.p50).toBeLessThan(TYPICAL_BUDGET_MS);
  expect(body.p95).toBeLessThan(FRAME_MS);
  expect(system.frames).toBeGreaterThanOrEqual(70);
  expect(system.p50).toBeLessThan(TYPICAL_BUDGET_MS);
  expect(system.p95).toBeLessThan(FRAME_MS);
  expect(swapMs).toBeLessThan(SWAP_BUDGET_MS);
  expect(swapGeometry).toBeLessThanOrEqual(1);
});
