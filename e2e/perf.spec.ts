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
 * - Idle frames stay inside one frame even at p95.
 * - The heaviest work, a replay board swap (redrawing every colony cell), is timed directly
 *   and must take under half a frame. Replay p95 is logged but not asserted: on GPU-less hosts
 *   the software rasteriser stalls the main thread right after a swap re-renders the cached
 *   colony texture, which says nothing about a phone's GPU (docs/DECISIONS.md #29).
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
const SWAP_BUDGET_MS = FRAME_MS / 2;

interface FrameStats {
  frames: number;
  p50: number;
  p95: number;
  max: number;
  rafFps: number;
}

/** Times main-thread work per Pixi frame, via ticker listeners at the highest and lowest priority. */
async function sampleFrames(page: Page, ms: number): Promise<FrameStats> {
  return page.evaluate(
    (duration) =>
      new Promise<FrameStats>((resolve) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const app = (window as any).__swarm.view.app;
        const cost: number[] = [];
        const stamps: number[] = [];
        let start = 0;
        const begin = () => (start = performance.now());
        const end = () => {
          const now = performance.now();
          cost.push(now - start);
          stamps.push(now);
        };
        app.ticker.add(begin, null, 1000);
        app.ticker.add(end, null, -1000);
        setTimeout(() => {
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
        }, duration);
      }),
    ms,
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
  // A Biofilm mirror: long enough games, and base entry costs (2 N per cell).
  await page.getByRole("radio", { name: /^Biofilm/ }).click();
  await page.getByRole("radio", { name: "Bot plays Biofilm" }).click();
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
  await expect(page.getByRole("button", { name: "Submit" })).toBeEnabled({ timeout: 15_000 });

  // Measure the view alone: wait until the bot's worker has finished choosing its orders.
  await expect(page.getByLabel("Bot: ready")).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(300);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const idle = await sampleFrames(page, 3000);
  // A board swap's CPU cost, timed directly (median of 7), as a replay does 4–6 times a turn.
  const swapMs = await page.evaluate(() => {
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
    return runs.sort((a, b) => a - b)[3] as number;
  });
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByLabel("Replay controls")).toBeVisible();
  const replay = await sampleFrames(page, 2500);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  console.log(`idle:   ${fmt(idle)}\nreplay: ${fmt(replay)}\nboard swap: ${swapMs.toFixed(2)} ms`);
  expect(idle.frames).toBeGreaterThan(10);
  expect(idle.p50).toBeLessThan(TYPICAL_BUDGET_MS);
  expect(idle.p95).toBeLessThan(FRAME_MS);
  expect(replay.p50).toBeLessThan(TYPICAL_BUDGET_MS);
  expect(swapMs).toBeLessThan(SWAP_BUDGET_MS);
});
