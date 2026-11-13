import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Playtest feedback (2026-11-13): resource badges on occupied cells, the turn replay touring
// every body with action, and a replay viewer with a turn scrubber and body switching.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

type Hook = {
  autoplay: boolean;
  phase: string;
  turn: number;
  view?: { depositBadges: number };
};
const hook = (p: Page) => p.evaluate(() => (window as unknown as { __swarm: Hook }).__swarm);

/** A 3-player system skirmish whose game ends by turn ~20 (see smoke.spec.ts). */
async function systemGame(page: Page): Promise<void> {
  await page.goto("/?e2e");
  await page.getByRole("button", { name: "Play skirmish" }).click();
  await page.getByRole("radio", { name: "Asteroid system" }).click();
  await page.getByRole("radio", { name: "2 bots" }).click();
  await page.getByRole("textbox").fill("smoke-sys-47");
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForFunction(
    () => (window as unknown as { __swarm?: { view?: unknown } }).__swarm?.view,
  );
}

const setAutoplay = (page: Page, on: boolean) =>
  page.evaluate((v) => ((window as unknown as { __swarm: Hook }).__swarm.autoplay = v), on);

test("a turn's replay tours every body with action, then returns to yours", async ({ page }) => {
  test.setTimeout(240_000);
  await systemGame(page);
  // The scripted player builds up until the colonies own deposit cells.
  await setAutoplay(page, true);
  await page.waitForFunction(() => (window as unknown as { __swarm: Hook }).__swarm.turn >= 6);
  await setAutoplay(page, false);
  await page.waitForFunction(
    () => (window as unknown as { __swarm: Hook }).__swarm.phase === "planning",
  );
  // Resources stay visible under the colony: occupied deposit cells carry a badge.
  expect((await hook(page)).view?.depositBadges).toBeGreaterThan(0);

  const strip = page.getByRole("navigation", { name: "Bodies" });
  const current = async (): Promise<string> =>
    ((await strip.locator('[aria-current="true"]').getAttribute("aria-label")) ?? "").split(
      ",",
    )[0] ?? "";
  const start = await current();
  await page.getByRole("button", { name: "Submit" }).click();
  const seen = new Set<string>();
  await expect
    .poll(
      async () => {
        seen.add(await current());
        return (await hook(page)).phase === "planning" && seen.size > 1;
      },
      { timeout: 90_000, intervals: [100] },
    )
    .toBe(true);
  // Other bodies were shown during the replay, and control came back to the starting body.
  expect([...seen].filter((b) => b !== start).length).toBeGreaterThan(0);
  expect(await current()).toBe(start);
  await expect(page.getByRole("button", { name: "Submit" })).toBeEnabled();
});

test("the replay viewer scrubs to any turn and switches between bodies", async ({ page }) => {
  test.setTimeout(240_000);
  await systemGame(page);
  await setAutoplay(page, true);
  await expect(page.getByRole("heading", { name: /Victory|Defeat|Draw/ })).toBeVisible({
    timeout: 200_000,
  });
  await page.getByRole("button", { name: "Watch replay" }).click();
  const viewer = page.locator(".replay-viewer");
  const turns = Number(await viewer.getAttribute("data-turns"));
  expect(turns).toBeGreaterThan(10);
  const scrubber = page.getByRole("slider", { name: "Turn" });
  const scrubTo = (v: number | "end") =>
    scrubber.evaluate((el, to) => {
      const input = el as HTMLInputElement;
      input.value = to === "end" ? input.max : String(to);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, v);

  await scrubTo(10);
  await expect(viewer).toHaveAttribute("data-turn", "10");
  await page.getByRole("button", { name: "Pause" }).click();
  await page.getByRole("button", { name: "Previous turn" }).click();
  await expect(viewer).toHaveAttribute("data-turn", "9");
  await page.getByRole("button", { name: "Next turn" }).click();
  await expect(viewer).toHaveAttribute("data-turn", "10");

  // Another asteroid: the strip marks it, and the turn stays where it was.
  const strip = page.getByRole("navigation", { name: "Bodies" });
  const other = strip.locator('button[aria-label^="Body "]:not([aria-current="true"])').first();
  const label = ((await other.getAttribute("aria-label")) ?? "").split(",")[0];
  await other.click();
  await expect(strip.locator('[aria-current="true"]')).toHaveAttribute(
    "aria-label",
    new RegExp(`^${label},`),
  );
  await expect(viewer).toHaveAttribute("data-turn", "10");
  await strip.getByRole("button", { name: "System view" }).click();
  await expect(strip.getByRole("button", { name: "System view" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // The end of the game, then play from the start again.
  await scrubTo("end");
  await expect(scrubber).toHaveAttribute("aria-valuetext", "End of game");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(viewer).toHaveAttribute("data-turn", "1");
});
