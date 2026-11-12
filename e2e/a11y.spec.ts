import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// SPEC §10.8 / §15 M8: an accessibility audit of every screen at the phone viewport. axe-core is
// the engine behind Lighthouse's accessibility score; here it checks screens Lighthouse cannot
// reach by URL. WCAG 2.x A and AA rules, contrast included (≥ 4.5:1 for UI text).
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function audit(page: Page, screen: string): Promise<void> {
  const r = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    // The game board is a canvas; its content is mirrored in the HUD, log and labels.
    .exclude("canvas")
    .analyze();
  const found = r.violations.map(
    (v) => `${screen}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
  expect(found, `axe violations on ${screen}`).toEqual([]);
}

test("menus and panels pass axe (WCAG 2.1 AA)", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/?e2e");
  await expect(page.getByRole("button", { name: "Campaign" })).toBeVisible();
  // Let the title's entrance settle so contrast is measured on final colours.
  await page.waitForTimeout(600);
  await audit(page, "title");

  await page.getByRole("button", { name: "Play skirmish" }).click();
  await audit(page, "skirmish setup");
  await page.getByRole("button", { name: "Back" }).click();

  await page.getByRole("button", { name: "Campaign" }).click();
  await audit(page, "campaign map");
  await page.locator('[data-node="c01"]').click();
  await audit(page, "campaign briefing");
  await page.getByRole("button", { name: "Back" }).click();

  await page.getByRole("button", { name: "Codex" }).click();
  for (const tab of [/How to play/, /Strains/, /Mutations/, /Feats/]) {
    await page.getByRole("tab", { name: tab }).click();
    await audit(page, `codex ${tab.source}`);
  }
  await page.getByRole("button", { name: "Back" }).click();

  await page.getByRole("button", { name: "Daily Seed" }).click();
  await expect(page.getByRole("heading", { name: "Leaderboard" })).toBeVisible();
  await audit(page, "daily");
  await page.getByRole("button", { name: "Back" }).click();

  await page.getByRole("button", { name: "Settings" }).click();
  await audit(page, "settings");
  await page.getByRole("button", { name: "Back" }).click();

  await page.getByRole("button", { name: "Play online" }).click();
  await expect(page.getByRole("heading", { name: "Ranked" })).toBeVisible();
  await audit(page, "online");
});

test("match HUD and results pass axe (WCAG 2.1 AA)", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/?e2e");
  await page.getByRole("button", { name: "Play skirmish" }).click();
  await page.getByRole("radio", { name: "Single Rock" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForFunction(
    () => (window as unknown as { __swarm?: { view?: unknown } }).__swarm?.view,
  );
  await audit(page, "match");
  await page.getByRole("button", { name: /^Orders/ }).click();
  await audit(page, "order drawer");
  await page.keyboard.press("Escape");
  await page.evaluate(
    () => ((window as unknown as { __swarm: { autoplay: boolean } }).__swarm.autoplay = true),
  );
  await expect(page.getByRole("heading", { name: /Victory|Defeat|Draw/ })).toBeVisible({
    timeout: 150_000,
  });
  await audit(page, "results");
});

test("HUD controls are reachable by keyboard on desktop (SPEC §10.8)", async ({
  page,
  browserName,
}) => {
  // Safari moves focus to buttons with Option+Tab (plain Tab skips them unless the user turns on
  // "Press Tab to highlight each item"); the controls are reachable either way.
  const tab = browserName === "webkit" ? "Alt+Tab" : "Tab";
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?e2e");
  await page.getByRole("button", { name: "Play skirmish" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForFunction(
    () => (window as unknown as { __swarm?: { view?: unknown } }).__swarm?.view,
  );
  const reached = new Set<string>();
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press(tab);
    const name = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return el?.getAttribute("aria-label") ?? el?.textContent?.trim() ?? "";
    });
    reached.add(name);
  }
  // Undo is disabled (so skipped by Tab) until there is an order to undo.
  for (const control of ["Leave match", "Whole body", "Submit"])
    expect(
      [...reached].some((n) => n.startsWith(control)),
      control,
    ).toBe(true);
  expect([...reached].some((n) => n.startsWith("Orders"))).toBe(true);
});

test("text at 150% and colourblind patterns pass axe and fit the phone", async ({ page }) => {
  await page.goto("/?e2e");
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("checkbox", { name: "Colourblind patterns" }).check();
  await page.getByRole("radio", { name: "150%" }).click();
  // Text grows; nothing scrolls sideways.
  await expect
    .poll(() =>
      page.evaluate(() => parseFloat(getComputedStyle(document.querySelector("h2")!).fontSize)),
    )
    .toBeCloseTo(26 * 1.5, 0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await audit(page, "settings at 150%");
  await page.reload();
  await expect(page.getByRole("radio", { name: "150%" })).toHaveCount(0); // back on the title
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("radio", { name: "150%" })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("checkbox", { name: "Colourblind patterns" })).toBeChecked();
});
