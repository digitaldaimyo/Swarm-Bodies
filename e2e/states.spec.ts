import { expect, test } from "./fixtures";

// SPEC §15 M8: error, empty and loading states. The network is cut with route blocking, so the
// browser logs failed requests; those are the only console errors these tests allow.
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  allowConsoleErrors:
    /Failed to load resource|Failed to fetch dynamically imported module|WebSocket/,
});

test("Online with the server unreachable: retry state, ladder notice, no endless spinner", async ({
  page,
}) => {
  await page.route("**/api/**", (r) => r.abort());
  await page.goto("/?e2e");
  await page.getByRole("button", { name: "Play online" }).click();
  await expect(page.getByRole("alert")).toContainText("Can't reach the server");
  await expect(page.getByText("Your games will appear here")).toBeVisible();
  await expect(page.getByText("The ladder is unavailable offline.")).toBeVisible();
  // Back online: Retry recovers.
  await page.unroute("**/api/**");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Your games will appear here")).toBeHidden();
});

test("Daily offline: still playable, leaderboard explains why it is missing", async ({ page }) => {
  await page.route("**/api/**", (r) => r.abort());
  await page.goto("/?e2e");
  await page.getByRole("button", { name: "Daily Seed" }).click();
  await expect(page.getByText("Leaderboard unavailable offline")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Play/ })).toBeEnabled();
});

test("a screen whose code cannot load shows a recoverable error, not a blank page", async ({
  page,
}) => {
  await page.goto("/?e2e");
  await page.route(/\/assets\/Codex-[^/]*\.js$/, (r) => r.abort());
  await page.getByRole("button", { name: "Codex" }).click();
  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
  await page.getByRole("button", { name: "Back to title" }).click();
  await expect(page.getByRole("button", { name: "Campaign" })).toBeVisible();
});

test("empty states: no games yet, no Daily runs, an unknown replay link", async ({ page }) => {
  await page.goto("/?e2e");
  await page.getByRole("button", { name: "Play online" }).click();
  await expect(page.getByText("No games yet.")).toBeVisible();
  await page.goto("/replay/00000000-0000-0000-0000-000000000000?e2e");
  // The link fails politely and leaves you on the title.
  await expect(page.getByRole("alert")).toContainText(/No such game|not/i);
  await expect(page.getByRole("button", { name: "Campaign" })).toBeVisible();
});

test("landscape phone: the HUD sits at the sides and the title menu fits (SPEC §10.7)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/?e2e");
  const settings = await page.getByRole("button", { name: "Settings" }).boundingBox();
  expect((settings?.y ?? 999) + (settings?.height ?? 0)).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "Play skirmish" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForFunction(
    () => (window as unknown as { __swarm?: { view?: unknown } }).__swarm?.view,
  );
  const left = await page.locator(".hud-top").boundingBox();
  const submit = await page.getByRole("button", { name: "Submit" }).boundingBox();
  const orders = await page.getByRole("button", { name: /^Orders/ }).boundingBox();
  expect(left && submit && orders).toBeTruthy();
  // Left column, right column, and the board between them.
  expect(left!.width).toBeLessThan(844 / 3);
  expect(left!.height).toBeGreaterThan(300);
  expect(submit!.x).toBeGreaterThan(844 * 0.7);
  expect(orders!.x).toBeGreaterThan(844 * 0.7);
  expect(left!.x + left!.width).toBeLessThan(submit!.x);
});
