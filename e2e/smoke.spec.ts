import { expect, test, type Page } from "@playwright/test";

// SPEC §14 client smoke flow, at the primary phone viewport (CLAUDE.md: 390×844, touch).
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 2,
});

type Hex = { q: number; r: number };

/** Two empty, non-rock cells in a line from the player's home core, as screen points. */
async function pathFromHome(page: Page): Promise<{ x: number; y: number }[]> {
  return page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (window as any).__swarm.view;
    const state = v.state;
    const body = state.bodies[0];
    const R = body.radius;
    // Canonical cell order is by r, then q (see packages/sim/src/hex.ts).
    const index = (h: Hex): number => {
      let i = 0;
      for (let r = -R; r <= R; r++)
        for (let q = -R; q <= R; q++) {
          if ((Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2 > R) continue;
          if (q === h.q && r === h.r) return i;
          i++;
        }
      return -1;
    };
    const open = (h: Hex) => {
      const i = index(h);
      return i >= 0 && body.terrain[i] !== "rock" && !body.colony[i];
    };
    const home: Hex = state.players[0].home.cell;
    const dirs = [
      [1, 0],
      [1, -1],
      [0, -1],
      [-1, 0],
      [-1, 1],
      [0, 1],
    ];
    for (const [dq, dr] of dirs) {
      const a = { q: home.q + dq!, r: home.r + dr! };
      const b = { q: home.q + 2 * dq!, r: home.r + 2 * dr! };
      if (open(a) && open(b)) return [home, a, b].map((h) => v.worldToScreen(h));
    }
    throw new Error("no open path from home");
  });
}

/** A real touch drag in Chromium (CDP), so Pointer Events arrive with pointerType "touch". */
async function touchDrag(page: Page, pts: { x: number; y: number }[]): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: "touchStart" | "touchMove" | "touchEnd", p?: { x: number; y: number }) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
  await send("touchStart", pts[0]);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    for (let k = 1; k <= 6; k++)
      await send("touchMove", { x: a.x + ((b.x - a.x) * k) / 6, y: a.y + ((b.y - a.y) * k) / 6 });
  }
  await send("touchEnd");
}

test("skirmish: paint, submit, replay, and finish against the Easy bot", async ({
  page,
  browserName,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto("/?e2e");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Play skirmish" }).click();
  await page.getByRole("radio", { name: "Single Rock" }).click();
  // A Biofilm mirror: long enough games, and base entry costs (2 N per cell).
  await page.getByRole("radio", { name: /^Biofilm/ }).click();
  await page.getByRole("radio", { name: "Bot plays Biofilm" }).click();
  await page.getByRole("radio", { name: "Easy bot" }).click();
  await page.getByRole("textbox").fill("smoke-1");
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForFunction(
    () => (window as unknown as { __swarm?: { view?: unknown } }).__swarm?.view,
  );

  // Paint a two-cell Grow path from the home core.
  const pts = await pathFromHome(page);
  if (browserName === "chromium") await touchDrag(page, pts);
  else {
    await page.mouse.move(pts[0]!.x, pts[0]!.y);
    await page.mouse.down();
    for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps: 6 });
    await page.mouse.up();
  }
  await expect(page.getByRole("button", { name: "Orders" })).toContainText("1");
  await expect(page.locator(".stat.planned .num")).toHaveText("−4");

  // Submit and watch the replay.
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByLabel("Replay controls")).toBeVisible();
  await expect(page.getByLabel("What happened")).toContainText("You grew into 2 new cells");
  await expect(page.getByRole("button", { name: "Submit" })).toBeEnabled({ timeout: 15_000 });
  await expect(page.getByLabel("Turn 2 of 40")).toBeVisible();

  // An accelerated scripted player (Normal bot policy, replays skipped) finishes the game.
  await page.evaluate(
    () => ((window as unknown as { __swarm: { autoplay: boolean } }).__swarm.autoplay = true),
  );
  await expect(page.getByRole("heading", { name: /Victory|Defeat|Draw/ })).toBeVisible({
    timeout: 150_000,
  });
  await expect(page.getByRole("img", { name: /Dominance over \d+ turns/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rematch" })).toBeVisible();

  expect(errors).toEqual([]);
});

test("system skirmish: body strip, System view, launches, and a finished game (M5)", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto("/?e2e");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Play skirmish" }).click();
  await page.getByRole("radio", { name: "Asteroid system" }).click();
  await page.getByRole("radio", { name: "2 bots" }).click();
  await page.getByRole("radio", { name: "Easy bot" }).click();
  await page.getByRole("textbox").fill("smoke-sys");
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForFunction(
    () => (window as unknown as { __swarm?: { view?: unknown } }).__swarm?.view,
  );

  // The body strip lists every body; three players get four (players + 1, DECISIONS #71).
  const strip = page.getByRole("navigation", { name: "Bodies" });
  await expect(strip.getByRole("button", { name: /^Body \d+,/ })).toHaveCount(4);
  await expect(strip.getByRole("button", { name: /^Body \d+, .*yours/ })).toHaveCount(1);

  // System view with the launch-window forecast, then open another body from the strip.
  await strip.getByRole("button", { name: "System view" }).click();
  await expect(page.getByLabel("Forecast, next 6 turns")).toBeVisible();
  const other = strip.getByRole("button", { name: /^Body \d+,/ }).filter({ hasNotText: "yours" });
  await other.first().click();
  await expect(page.getByLabel("Forecast, next 6 turns")).toBeHidden();
  await expect(strip.locator('[aria-current="true"]')).toHaveCount(1);

  // The scripted player (Normal policy) finishes the game; spores fly along the way.
  await page.evaluate(
    () => ((window as unknown as { __swarm: { autoplay: boolean } }).__swarm.autoplay = true),
  );
  await expect(page.getByRole("heading", { name: /Victory|Defeat|Draw/ })).toBeVisible({
    timeout: 170_000,
  });
  const launches = await page.evaluate(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = (window as any).__swarm.session;
    return s.history
      .flatMap((h: { events: { type: string }[] }) => h.events)
      .filter((e: { type: string }) => e.type === "SporeLaunched").length;
  });
  expect(launches).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test("mutation draft: the modal offers three cards, inspect then pick (M6)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto("/?e2e");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: "Play skirmish" }).click();
  await page.getByRole("radio", { name: /^Predator/ }).click();
  await page.getByRole("radio", { name: "Hard bot" }).click();
  await page.getByRole("textbox").fill("draft-1");
  await page.getByRole("button", { name: "Start" }).click();
  type Hook = {
    autoplay: boolean;
    stopAtDraft?: boolean;
    phase: string;
    session: { state: { players: { draft: unknown }[] }; planner: { orders: { type: string }[] } };
  };
  await page.waitForFunction(
    () => (window as unknown as { __swarm?: { view?: unknown } }).__swarm?.view,
  );
  // The scripted player grows until our first draft (40 total biomass) is offered, then stops
  // by itself so the offer is still pending when we look (race-free on slower engines).
  await page.evaluate(() => {
    const h = (window as unknown as { __swarm: Hook }).__swarm;
    h.stopAtDraft = true;
    h.autoplay = true;
  });
  await page.waitForFunction(
    () => {
      const h = (window as unknown as { __swarm: Hook }).__swarm;
      return !h.autoplay && h.phase === "planning" && !!h.session.state.players[0]!.draft;
    },
    null,
    { timeout: 120_000 },
  );
  const dialog = page.getByRole("dialog", { name: /Mutation draft 1 of 3/ });
  await expect(dialog).toBeVisible();
  const cards = dialog.locator(".draft-card");
  await expect(cards).toHaveCount(3);
  await cards.nth(2).click();
  await expect(cards.nth(2)).toContainText("Tap again to pick");
  await cards.nth(2).click();
  await expect(dialog).toBeHidden();
  const first = await page.evaluate(
    () => (window as unknown as { __swarm: Hook }).__swarm.session.planner.orders[0]?.type,
  );
  expect(first).toBe("draft");
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByLabel("What happened")).toContainText("You drafted");
  await expect(page.getByLabel(/Mutations: /).first()).toBeVisible();
  expect(errors).toEqual([]);
});
