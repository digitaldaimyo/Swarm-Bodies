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
