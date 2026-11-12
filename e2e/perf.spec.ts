import { expect, test, type Page } from "@playwright/test";

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
test.describe.configure({ retries: 1 });

const FRAME_MS = 1000 / 60;
const TYPICAL_BUDGET_MS = 5;
/** A swap frame is the swap plus a typical frame's other work, and must fit in one frame. */
const SWAP_BUDGET_MS = FRAME_MS - TYPICAL_BUDGET_MS;

interface FrameStats {
  frames: number;
  p50: number;
  p95: number;
  max: number;
  rafFps: number;
}

/**
 * Times main-thread work per Pixi frame, via ticker listeners at the highest and lowest priority.
 * Stops after `minFrames` frames or `maxMs`, whichever comes first: CI runners render WebGL in
 * software at ~10 fps, so a fixed 3 s window gave ~30 frames and a "p95" that was really the
 * second-worst frame.
 */
async function sampleFrames(page: Page, minFrames: number, maxMs: number): Promise<FrameStats> {
  return page.evaluate(
    ({ minFrames, maxMs }) =>
      new Promise<FrameStats>((resolve) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const app = (window as any).__swarm.view.app;
        const cost: number[] = [];
        const stamps: number[] = [];
        let start = 0;
        const begin = () => (start = performance.now());
        const t0 = performance.now();
        const end = () => {
          const now = performance.now();
          cost.push(now - start);
          stamps.push(now);
          if (cost.length >= minFrames || now - t0 >= maxMs) finish();
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
            p50: q(0.5),
            p95: q(0.95),
            max: sorted[sorted.length - 1] ?? 0,
            rafFps: (1000 * (stamps.length - 1)) / Math.max(1, span),
          });
        };
      }),
    { minFrames, maxMs },
  );
}

const fmt = (s: FrameStats) =>
  `${s.frames} frames, CPU p50 ${s.p50.toFixed(2)} ms, p95 ${s.p95.toFixed(2)} ms, max ${s.max.toFixed(1)} ms; raw rAF ${s.rafFps.toFixed(1)} fps`;

test("frame CPU cost fits a 60 fps budget mid-game under a 4× CPU throttle", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CPU throttling needs the Chromium DevTools protocol");
  await page.goto("/?e2e");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Play skirmish" }).click();
  await page.getByRole("radio", { name: "Normal bot" }).click();
  await page.getByRole("textbox").fill("perf-1");
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForFunction(
    () => (window as unknown as { __swarm?: { view?: unknown } }).__swarm?.view,
  );

  // Play 12 turns quickly so the board is busy, then stop.
  await page.evaluate(
    () => ((window as unknown as { __swarm: { autoplay: boolean } }).__swarm.autoplay = true),
  );
  await page.waitForFunction(
    () => (window as unknown as { __swarm: { turn: number } }).__swarm.turn >= 13,
    null,
    { timeout: 90_000 },
  );
  await page.evaluate(
    () => ((window as unknown as { __swarm: { autoplay: boolean } }).__swarm.autoplay = false),
  );
  // Wait until the game is truly idle. Stopping autoplay can still let one in-flight turn
  // through, whose replay used to land inside the idle window; and the bot's worker plans as
  // soon as a turn opens. So: planning phase, turn number stable, bot ready.
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
      const botReady = document.querySelector('.ready-dot.on[title="Bot is ready"]') !== null;
      return botReady && now - w.__settle.since > 1000;
    },
    null,
    { timeout: 30_000, polling: 100 },
  );

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const idle = await sampleFrames(page, 120, 30_000);
  // The heaviest work in the game: a replay board swap redraws every colony cell, 4–6 times a
  // turn. Timed directly (median of 7, redraw plus render), it is a stable CPU measurement;
  // inside a replay the same frames also absorb software-GL stalls.
  const { swapMs, swapGeometry } = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (window as any).__swarm.view;
    const colony = v.colony;
    const runs: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t = performance.now();
      v.setBoard(colony);
      v.app.renderer.render(v.app.stage);
      runs.push(performance.now() - t);
    }
    // Shapes the colony layer had to tessellate for this board (sprites need none).
    const swapGeometry: number = v.gooG.context.instructions.length;
    return { swapMs: runs.sort((a, b) => a - b)[3] as number, swapGeometry };
  });
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByLabel("Replay controls")).toBeVisible();
  const replay = await sampleFrames(page, 1000, 2500);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  console.log(
    `idle:   ${fmt(idle)}\nreplay: ${fmt(replay)}\nboard swap: ${swapMs.toFixed(2)} ms, ${swapGeometry} colony shapes`,
  );
  expect(idle.frames).toBeGreaterThanOrEqual(100);
  expect(idle.p50).toBeLessThan(TYPICAL_BUDGET_MS);
  expect(idle.p95).toBeLessThan(FRAME_MS);
  expect(replay.p50).toBeLessThan(TYPICAL_BUDGET_MS);
  // Replay p95 is logged, not asserted: it is the 4–6 swap frames, which the line below
  // measures directly, plus software-rasteriser stalls that say nothing about phones.
  expect(swapMs).toBeLessThan(SWAP_BUDGET_MS);
  // Hardware-independent guard for the cost CI caught on PR #3: a board swap must not rebuild
  // per-cell geometry (the old renderer rebuilt hundreds of polygons per swap: 444 on the test
  // board). Only the static
  // bounds rect remains, whatever the board size.
  expect(swapGeometry).toBeLessThanOrEqual(1);
});
