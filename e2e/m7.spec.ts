import { type Browser, type Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// SPEC §15 M7 acceptance: the campaign is completable (node 1 opens node 2 through the UI),
// the Daily leaderboard works, and a replay link plays back a finished online game.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

type Hook = { autoplay: boolean; finished: boolean; session?: unknown };
const autoplay = (p: Page) =>
  p.evaluate(() => ((window as unknown as { __swarm: Hook }).__swarm.autoplay = true));
const inMatch = (p: Page) =>
  p.waitForFunction(() => (window as unknown as { __swarm?: Hook }).__swarm?.session !== undefined);

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

test("campaign: node 1's tutorial, then a win opens node 2 and records progress", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto("/?e2e");
  await page.getByRole("button", { name: "Campaign" }).click();
  await expect(page.getByRole("listitem", { name: /2\. Fronts, locked/ })).toBeVisible();
  await page.getByRole("listitem", { name: /1\. First Contact, open/ }).click();
  await expect(page.getByLabel("Briefing: First Contact")).toContainText("Tutorial");
  await page.getByRole("button", { name: "Play" }).click();
  await inMatch(page);

  // The scripted tutorial: "Got it" advances a text step; the next step waits for a Grow order.
  const card = page.locator(".tutorial-card");
  await expect(card).toContainText("your core");
  await page.getByRole("button", { name: "Got it" }).click();
  await expect(card).toContainText("Grow path");
  await expect(card).toHaveAttribute("data-tutorial-step", "1");

  // The scripted player (Normal policy) plays the node out against the Easy bot. The seeds are
  // fixed, so this game is the same every run.
  await autoplay(page);
  await expect(page.getByRole("heading", { name: "Victory" })).toBeVisible({ timeout: 200_000 });
  await expect(page.getByLabel("Rewards")).toContainText("System 1 complete: First Contact");
  await expect(page.getByLabel("Rewards")).toContainText("Achievement: First Bloom");
  await page.getByRole("button", { name: "Campaign map" }).click();
  await expect(page.getByRole("listitem", { name: /1\. First Contact, complete/ })).toBeVisible();
  await expect(page.getByRole("listitem", { name: /2\. Fronts, open/ })).toBeVisible();

  // Progress survives a reload (IndexedDB) and shows in the codex.
  await page.reload();
  await page.getByRole("button", { name: "Codex" }).click();
  await page.getByRole("tab", { name: /Feats/ }).click();
  await expect(page.locator(".achievement.got")).toContainText(["First Bloom"]);
});

test("Daily Seed: a run is validated by the server and appears on the leaderboard", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto("/?e2e");
  await page.getByRole("button", { name: "Daily Seed" }).click();
  await expect(page.getByRole("heading", { name: "Leaderboard" })).toBeVisible();
  await page.getByRole("button", { name: /^Play/ }).click();
  await inMatch(page);
  await autoplay(page);
  await expect(page.getByRole("heading", { name: /Victory|Defeat|Draw/ })).toBeVisible({
    timeout: 200_000,
  });
  const rewards = page.getByLabel("Rewards");
  await expect(rewards).toContainText(/Daily score \d+/);
  const score = /Daily score (\d+)/.exec((await rewards.textContent()) ?? "")?.[1];
  await page.getByRole("button", { name: "Back to title" }).click();
  await page.getByRole("button", { name: "Daily Seed" }).click();
  const mine = page.locator(".leaderboard tr.you");
  await expect(mine).toBeVisible();
  // Our best run is at least this one (an earlier run on this database may have scored more).
  const shown = Number((await mine.locator("td.num").last().textContent()) ?? "0");
  expect(shown).toBeGreaterThanOrEqual(Number(score));
});

test("a replay link plays back a finished online game", async ({ browser }) => {
  test.setTimeout(300_000);
  const a = await player(browser);
  const b = await player(browser);
  await a.getByRole("button", { name: "Play online" }).click();
  await a.getByRole("button", { name: "Create game" }).click();
  await expect(a.getByRole("heading", { name: "Lobby" })).toBeVisible();
  const code = (await a.locator(".invite-code").textContent())?.trim() ?? "";
  await b.getByRole("button", { name: "Play online" }).click();
  await b.getByLabel("Invite code").fill(code);
  await b.getByRole("button", { name: "Join" }).click();
  await expect(b.getByRole("heading", { name: "Lobby" })).toBeVisible();
  await a.getByRole("button", { name: "Start game" }).click();
  for (const p of [a, b]) await inMatch(p);
  for (const p of [a, b]) await autoplay(p);
  for (const p of [a, b])
    await expect(p.getByRole("heading", { name: /Victory|Defeat|Draw/ })).toBeVisible({
      timeout: 200_000,
    });
  const gameId = await a.evaluate(
    () =>
      (window as unknown as { __swarm: { session: { gameId: string } } }).__swarm.session.gameId,
  );
  await expect(a.getByRole("button", { name: "Share replay link" })).toBeVisible();
  const turns = await a.evaluate(
    () =>
      (window as unknown as { __swarm: { session: { history: unknown[] } } }).__swarm.session
        .history.length,
  );

  // A third browser (a fresh guest, not a player) opens the link.
  const viewer = await player(browser);
  await viewer.goto(`/replay/${gameId}`);
  const replay = viewer.locator(".replay-viewer");
  await expect(replay).toHaveAttribute("data-turns", String(turns), { timeout: 30_000 });
  await expect(replay).toContainText("Online game");
  // It plays: turns advance (skip ahead to keep the test short).
  await expect(replay).toHaveAttribute("data-turn", "1");
  for (let i = 0; i < 3; i++) await viewer.getByRole("button", { name: "Next turn" }).click();
  await expect
    .poll(async () => Number(await replay.getAttribute("data-turn")), { timeout: 20_000 })
    .toBeGreaterThan(1);
  await viewer.getByRole("button", { name: "Close replay" }).click();
  await expect(viewer.getByRole("button", { name: "Campaign" })).toBeVisible();
  expect(new URL(viewer.url()).pathname).toBe("/");
});
