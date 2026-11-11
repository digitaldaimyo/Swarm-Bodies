import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// SPEC §9.3: the golden replays must produce identical hashes in Node, Chromium and WebKit.
// `pnpm test:e2e` builds the sim as a browser bundle first.
const root = fileURLToPath(new URL("..", import.meta.url));
const bundle = readFileSync(`${root}/packages/sim/dist/browser/sim.iife.js`, "utf8");
const golden = readFileSync(`${root}/packages/sim/test/golden/replays.json`, "utf8");

test("golden replays match committed hashes in the browser", async ({ page }) => {
  await page.goto("about:blank");
  await page.addScriptTag({ content: bundle });
  const mismatches = await page.evaluate((json) => {
    type Replay = {
      seed: string;
      config: unknown;
      initialHash: string;
      orders: unknown[][][];
      hashes: string[];
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sim = (window as any).SwarmSim;
    const { replays } = JSON.parse(json) as { replays: Replay[] };
    const out: string[] = [];
    for (const r of replays) {
      let state = sim.createGame(r.config, r.seed);
      if (sim.hashState(state) !== r.initialHash) out.push(`${r.seed}: initial`);
      r.orders.forEach((turn, t) => {
        const byPlayer: Record<number, unknown[]> = {};
        turn.forEach((orders, p) => (byPlayer[p] = orders));
        state = sim.resolveTurn(state, byPlayer).state;
        const h = sim.hashState(state);
        if (h !== r.hashes[t]) out.push(`${r.seed}: turn ${t + 1}`);
      });
    }
    return { count: replays.length, out };
  }, golden);
  expect(mismatches.count).toBe(20);
  expect(mismatches.out).toEqual([]);
});
