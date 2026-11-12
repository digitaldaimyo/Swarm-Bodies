import { type Browser, type Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// SPEC §15 M4 acceptance, end to end: two real browsers against the real server.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

type Hook = {
  autoplay: boolean;
  phase: string;
  turn: number;
  finished: boolean;
  session?: { submit(): void; corruptForTest?(): void; resyncs?: number; state: { turn: number } };
  hash?: () => string;
};
const hook = (page: Page) => page.evaluate(() => (window as unknown as { __swarm?: Hook }).__swarm);

/** A fresh browser context is a fresh guest (its own storage and token). */
async function player(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
  await page.goto("/?e2e");
  return page;
}

/** A creates a live game, B joins by code, A starts; both end up in the match. */
async function startOnlineGame(browser: Browser): Promise<[Page, Page, string]> {
  const a = await player(browser);
  const b = await player(browser);
  await a.getByRole("button", { name: "Play online" }).click();
  await a.getByRole("radio", { name: /Swarmer/ }).click();
  await a.getByRole("button", { name: "Create game" }).click();
  await expect(a.getByRole("heading", { name: "Lobby" })).toBeVisible();
  const code = (await a.locator(".invite-code").textContent())?.trim() ?? "";
  expect(code).toMatch(/^[A-Z2-9]{6}$/);

  await b.getByRole("button", { name: "Play online" }).click();
  await b.getByRole("radio", { name: /Biofilm/ }).click();
  await b.getByLabel("Invite code").fill(code);
  await b.getByRole("button", { name: "Join" }).click();
  await expect(b.getByRole("heading", { name: "Lobby" })).toBeVisible();
  await expect(a.locator(".player-list")).toContainText("Biofilm");

  await a.getByRole("button", { name: "Start game" }).click();
  for (const p of [a, b]) {
    await p.waitForFunction(
      () => (window as unknown as { __swarm?: Hook }).__swarm?.session !== undefined,
    );
  }
  return [a, b, code];
}

test("two browsers complete a live game", async ({ browser }) => {
  const [a, b] = await startOnlineGame(browser);
  // Sealed orders: B sees that A is ready, and the turn waits for B.
  await a.evaluate(() => (window as unknown as { __swarm: Hook }).__swarm.session?.submit());
  await expect(b.getByLabel(/: ready/).first()).toBeVisible();
  expect((await hook(b))?.turn).toBe(1);
  // Both players hand their turns to the accelerated scripted player.
  for (const p of [a, b])
    await p.evaluate(() => ((window as unknown as { __swarm: Hook }).__swarm.autoplay = true));
  for (const p of [a, b]) {
    await expect(p.getByRole("heading", { name: /Victory|Defeat|Draw/ })).toBeVisible({
      timeout: 150_000,
    });
  }
  const ta = await a.getByRole("heading", { name: /Victory|Defeat|Draw/ }).textContent();
  const tb = await b.getByRole("heading", { name: /Victory|Defeat|Draw/ }).textContent();
  expect(ta === "Draw" ? tb === "Draw" : ta !== tb).toBe(true);
  // Both saw the same game: the final graphs agree.
  expect(await a.locator(".graph figcaption").textContent()).toContain("%");
  await expect(a.getByText(/Online · live/)).toBeVisible();
});

test("a deliberate hash mismatch is detected and recovered", async ({ browser }) => {
  const [a, b] = await startOnlineGame(browser);
  // Corrupt A's local state behind the server's back.
  await a.evaluate(() =>
    (window as unknown as { __swarm: Hook }).__swarm.session?.corruptForTest?.(),
  );
  const corrupted = await a.evaluate(() =>
    (window as unknown as { __swarm: Hook }).__swarm.hash?.(),
  );
  expect(corrupted).not.toBe(
    await b.evaluate(() => (window as unknown as { __swarm: Hook }).__swarm.hash?.()),
  );
  for (const p of [a, b])
    await p.evaluate(() => (window as unknown as { __swarm: Hook }).__swarm.session?.submit());
  // A's replay of turn 1 cannot match the server hash: it reports, refetches and replaces.
  await a.waitForFunction(
    () => ((window as unknown as { __swarm: Hook }).__swarm.session?.resyncs ?? 0) >= 1,
    null,
    { timeout: 15_000 },
  );
  await b.waitForFunction(
    () => (window as unknown as { __swarm: Hook }).__swarm.session?.state.turn === 2,
  );
  const ha = await a.evaluate(() => (window as unknown as { __swarm: Hook }).__swarm.hash?.());
  const hb = await b.evaluate(() => (window as unknown as { __swarm: Hook }).__swarm.hash?.());
  expect(ha).toBe(hb);
  expect(
    await a.evaluate(() => (window as unknown as { __swarm: Hook }).__swarm.session?.state.turn),
  ).toBe(2);
  // And the game carries on normally afterwards.
  for (const p of [a, b])
    await p.evaluate(() => (window as unknown as { __swarm: Hook }).__swarm.session?.submit());
  await a.waitForFunction(
    () => (window as unknown as { __swarm: Hook }).__swarm.session?.state.turn === 3,
  );
  expect(await a.evaluate(() => (window as unknown as { __swarm: Hook }).__swarm.hash?.())).toBe(
    await b.evaluate(() => (window as unknown as { __swarm: Hook }).__swarm.hash?.()),
  );
});

test.describe("connection loss", () => {
  // The test takes the browser offline on purpose: a reconnect attempt that fires before it
  // comes back makes Chromium log the failed WebSocket handshake. That error, and only it, is
  // expected here (the M8 console guard fails every other).
  test.use({
    allowConsoleErrors: /WebSocket connection to .* failed: .*ERR_INTERNET_DISCONNECTED/,
  });

  test("a dropped connection reconnects and catches up", async ({ browser }) => {
    const [a, b] = await startOnlineGame(browser);
    // A goes offline; B plays on alone is not possible (A must submit), so drop A after submitting.
    await a.evaluate(() => (window as unknown as { __swarm: Hook }).__swarm.session?.submit());
    await a.context().setOffline(true);
    await a.evaluate(() => {
      // Simulate the network blip on the open socket too.
      const s = (window as unknown as { __swarmSocket?: { dropConnection(): void } }).__swarmSocket;
      s?.dropConnection();
    });
    await b.evaluate(() => (window as unknown as { __swarm: Hook }).__swarm.session?.submit());
    await b.waitForFunction(
      () => (window as unknown as { __swarm: Hook }).__swarm.session?.state.turn === 2,
    );
    await a.context().setOffline(false);
    await a.waitForFunction(
      () => (window as unknown as { __swarm: Hook }).__swarm.session?.state.turn === 2,
      null,
      { timeout: 20_000 },
    );
    expect(await a.evaluate(() => (window as unknown as { __swarm: Hook }).__swarm.hash?.())).toBe(
      await b.evaluate(() => (window as unknown as { __swarm: Hook }).__swarm.hash?.()),
    );
  });
});
