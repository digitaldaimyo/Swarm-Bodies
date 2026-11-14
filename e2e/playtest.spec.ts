import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Playtest feedback (2026-11-13): resource badges on occupied cells, the turn replay touring
// every body with action, and a replay viewer with a turn scrubber and body switching.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

type Hook = {
  autoplay: boolean;
  phase: string;
  turn: number;
  view?: {
    depositBadges: number;
    vessels: number;
    motes: number;
    moteRouteCount: number;
    calm: boolean;
  };
};
/**
 * Small reads from the e2e hook. Never return `__swarm` itself: it holds the live view and
 * session, and serialising those per poll takes seconds in WebKit (PR #11 CI).
 */
const phase = (p: Page) => p.evaluate(() => (window as unknown as { __swarm: Hook }).__swarm.phase);
const turn = (p: Page) => p.evaluate(() => (window as unknown as { __swarm: Hook }).__swarm.turn);
const depositBadges = (p: Page) =>
  p.evaluate(() => (window as unknown as { __swarm: Hook }).__swarm.view?.depositBadges ?? 0);

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
  // Autoplay can stop with a mutation draft pending (drafts follow biomass, so it depends on
  // the turn it stops at). Its dialog covers the board and Submit: set it aside first.
  const later = page.getByRole("button", { name: "Decide later" });
  if (await later.isVisible()) await later.click();
  // Resources stay visible under the colony: occupied deposit cells carry a badge.
  expect(await depositBadges(page)).toBeGreaterThan(0);
  // Colony life, phase 1: the supply tree is drawn as vessels over the colony body.
  expect(
    await page.evaluate(() => (window as unknown as { __swarm: Hook }).__swarm.view?.vessels ?? 0),
  ).toBeGreaterThan(5);
  // Phase 3: nutrient motes travel from the deposits to the cores; Calm detail stills them.
  const motes = () =>
    page.evaluate(() => (window as unknown as { __swarm: Hook }).__swarm.view?.motes ?? 0);
  expect(
    await page.evaluate(
      () => (window as unknown as { __swarm: Hook }).__swarm.view?.moteRouteCount ?? 0,
    ),
  ).toBeGreaterThan(0);
  await expect.poll(motes, { timeout: 10_000 }).toBeGreaterThan(0);
  await page.evaluate(() => ((window as unknown as { __swarm: Hook }).__swarm.view!.calm = true));
  await expect.poll(motes, { timeout: 5_000 }).toBe(0);
  await page.evaluate(() => ((window as unknown as { __swarm: Hook }).__swarm.view!.calm = false));

  const strip = page.getByRole("navigation", { name: "Bodies" });
  const current = async (): Promise<string> =>
    ((await strip.locator('[aria-current="true"]').getAttribute("aria-label")) ?? "").split(
      ",",
    )[0] ?? "";
  const start = await current();
  const before = await turn(page);
  // Sample the body on screen inside the page: the tour lasts seconds, and polling from the
  // test is too coarse on a slow engine to be sure of seeing it.
  await page.evaluate(() => {
    const seen = new Set<string>();
    (window as unknown as { __tour: Set<string> }).__tour = seen;
    setInterval(() => {
      const label = document
        .querySelector('nav[aria-label="Bodies"] [aria-current="true"]')
        ?.getAttribute("aria-label");
      if (label) seen.add(label.split(",")[0] ?? "");
    }, 50);
  });
  await page.getByRole("button", { name: "Submit" }).click();
  await expect
    .poll(async () => (await turn(page)) > before && (await phase(page)) === "planning", {
      timeout: 90_000,
    })
    .toBe(true);
  const seen = await page.evaluate(() => [
    ...(window as unknown as { __tour: Set<string> }).__tour,
  ]);
  // Other bodies were shown during the replay, and control came back to the starting body.
  expect(seen.filter((b) => b !== start).length).toBeGreaterThan(0);
  expect(await current()).toBe(start);
  await expect(page.getByRole("button", { name: "Submit" })).toBeEnabled();

  // Colony life, phases 2 and 3: cut-off cells carry a starvation rim, and cut-off deposits a
  // slashed badge. Shown on a copy of the state with our deposit cells and at least three
  // cells cut off (the game itself is untouched).
  const cut = await page.evaluate(() => {
    type Cell = Record<string, unknown> | null;
    const h = (
      window as unknown as {
        __swarm: {
          session: {
            state: { bodies: { id: number; colony: Cell[]; deposits: (string | null)[] }[] };
          };
          view: {
            setState(s: unknown): void;
            showBody(id: number): void;
            starveRims: number;
            cutBadges: number;
          };
        };
      }
    ).__swarm;
    const st = structuredClone(h.session.state);
    const own = (c: Cell) => !!c && c["owner"] === 0 && !c["core"];
    const body =
      st.bodies.find((b) => b.colony.some((c, i) => own(c) && b.deposits[i])) ??
      st.bodies.find((b) => b.colony.some(own));
    if (!body) return { rims: -1, badges: -1, deposits: 0 };
    let cells = 0;
    let deposits = 0;
    body.colony.forEach((c, i) => {
      if (!own(c)) return;
      const deposit = !!body.deposits[i];
      if (!deposit && cells >= 3) return;
      body.colony[i] = { ...c, connected: false };
      cells++;
      if (deposit) deposits++;
    });
    h.view.showBody(body.id);
    h.view.setState(st);
    return { rims: h.view.starveRims, badges: h.view.cutBadges, deposits };
  });
  expect(cut.rims).toBeGreaterThanOrEqual(3);
  expect(cut.badges).toBeGreaterThanOrEqual(cut.deposits);
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

test("holding a cell traces its supply route and shows its defense", async ({ page }) => {
  test.setTimeout(180_000);
  await systemGame(page);
  await setAutoplay(page, true);
  await page.waitForFunction(() => (window as unknown as { __swarm: Hook }).__swarm.turn >= 5);
  await setAutoplay(page, false);
  await page.waitForFunction(
    () => (window as unknown as { __swarm: Hook }).__swarm.phase === "planning",
  );
  const later = page.getByRole("button", { name: "Decide later" });
  if (await later.isVisible()) await later.click();

  // The farthest connected cell of ours on the body shown, and where it is on screen.
  const target = await page.evaluate(() => {
    type Cell = { owner: number; core: boolean; connected: boolean } | null;
    const h = (
      window as unknown as {
        __swarm: {
          session: { state: { bodies: { radius: number; colony: Cell[] }[] } };
          view: {
            shownBody: number;
            worldToScreen(h: { q: number; r: number }): { x: number; y: number };
          };
        };
      }
    ).__swarm;
    const body = h.session.state.bodies[h.view.shownBody]!;
    const R = body.radius;
    const cells: { q: number; r: number }[] = [];
    for (let r = -R; r <= R; r++)
      for (let q = -R; q <= R; q++)
        if ((Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2 <= R) cells.push({ q, r });
    const i = body.colony.findIndex((c) => c && c.owner === 0 && !c.core && c.connected);
    if (i < 0) return null;
    const p = h.view.worldToScreen(cells[i]!);
    const rect = document.querySelector("canvas")!.getBoundingClientRect();
    return { i, x: rect.left + p.x, y: rect.top + p.y };
  });
  expect(target).not.toBeNull();
  const read = () =>
    page.evaluate(() => {
      const v = (
        window as unknown as {
          __swarm: { view: { inspected: number; inspectText: string; inspectRoute: number } };
        }
      ).__swarm.view;
      return { inspected: v.inspected, text: v.inspectText, route: v.inspectRoute };
    });
  await page.mouse.move(target!.x, target!.y);
  await page.mouse.down();
  await expect.poll(async () => (await read()).inspected, { timeout: 3_000 }).toBe(target!.i);
  const held = await read();
  expect(held.text).toMatch(/^Defense \d+\n\d+ biomass \+ \d+ support/);
  // The route runs from the cell to a core.
  expect(held.route).toBeGreaterThan(1);
  await page.mouse.up();
  expect((await read()).inspected).toBe(-1);

  // Fruiting hints are only shown while orders can still be planned.
  const fruitable = () =>
    page.evaluate(
      () =>
        (window as unknown as { __swarm: { view: { fruitable: number } } }).__swarm.view.fruitable,
    );
  expect(await fruitable()).toBeGreaterThanOrEqual(0);
  await page.getByRole("button", { name: "Submit" }).click();
  await expect.poll(fruitable).toBe(0);
});
