import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Training grounds (docs/plans/tutorial.md, step 2): lessons on hand-placed boards with a
// scripted opponent, opened from the title screen.
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

type Hook = {
  __swarm: {
    phase: string;
    turn: number;
    session: { planner: { add(o: unknown): { ok: boolean } }; state: { turn: number } };
  };
};

const turn = (p: Page) => p.evaluate(() => (window as unknown as Hook).__swarm.turn);
/** Queues an order through the planner (painting itself is covered by the smoke test). */
const order = (p: Page, o: unknown) =>
  p.evaluate((x) => (window as unknown as Hook).__swarm.session.planner.add(x).ok, o);

/** Submits and waits for the replay to finish and the next turn's planning to start. */
async function submitTurn(page: Page): Promise<void> {
  const before = await turn(page);
  await page.getByRole("button", { name: "Submit" }).click();
  await expect
    .poll(
      async () =>
        (await turn(page)) > before &&
        (await page.evaluate(() => (window as unknown as Hook).__swarm.phase)) === "planning",
      { timeout: 30_000 },
    )
    .toBe(true);
}

async function openLesson(page: Page, name: string): Promise<void> {
  await page.goto("/?e2e");
  await page.getByRole("button", { name: "Training grounds" }).click();
  await page.getByRole("listitem", { name: new RegExp(`^\\d\\. ${name},`) }).click();
  await page.getByRole("button", { name: /Start lesson|Play again/ }).click();
  await page.waitForFunction(() => (window as unknown as Partial<Hook>).__swarm?.session);
}

test("Mass matters: lose the thin gap, retake it, reinforce, hold: lesson complete", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openLesson(page, "Mass matters");
  await expect(page.getByText("Goal: Hold the gap through turn 3.")).toBeVisible();

  // Turn 1: no orders; the scripted rival takes the gap.
  await submitTurn(page);
  // Turn 2: retake it from the biomass-4 cell.
  expect(
    await order(page, {
      type: "grow",
      body: 0,
      path: [
        { q: -1, r: 0 },
        { q: 0, r: 0 },
      ],
    }),
  ).toBe(true);
  await submitTurn(page);
  await expect(page.getByRole("dialog", { name: "Lesson complete" })).toHaveCount(0);
  // Turn 3: reinforce, and their repeat attack fails.
  expect(await order(page, { type: "reinforce", body: 0, cell: { q: 0, r: 0 } })).toBe(true);
  await submitTurn(page);

  const done = page.getByRole("dialog", { name: "Lesson complete" });
  await expect(done).toBeVisible();
  await done.getByRole("button", { name: "Training grounds" }).click();
  await expect(page.getByRole("listitem", { name: "2. Mass matters, complete" })).toBeVisible();
});

test("Neighbours matter: the flanked attack captures in one turn; restart starts over", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openLesson(page, "Neighbours matter");
  // Restart from the goal chip once the tutorial is set aside.
  await page.getByRole("button", { name: "Skip tutorial" }).click();
  await page.getByRole("button", { name: "Restart lesson" }).click();
  await page.waitForFunction(() => (window as unknown as Partial<Hook>).__swarm?.session);
  expect(await turn(page)).toBe(1);

  expect(
    await order(page, {
      type: "grow",
      body: 0,
      path: [
        { q: -2, r: 1 },
        { q: -1, r: 1 },
      ],
    }),
  ).toBe(true);
  await submitTurn(page);
  const done = page.getByRole("dialog", { name: "Lesson complete" });
  await expect(done).toBeVisible();
  await done.getByRole("button", { name: "Next lesson" }).click();
  await expect(page.getByText("Goal: Destroy the rival core.")).toBeVisible();
});

test("Grow: the goal chip shows, and finishing Grow offers the next lesson", async ({ page }) => {
  test.setTimeout(120_000);
  await openLesson(page, "Grow");
  await expect(page.getByText("Goal: Reach an income of 7 N a turn.")).toBeVisible();
  const g = (path: [number, number][]) => ({
    type: "grow",
    body: 0,
    path: path.map(([q, r]) => ({ q, r })),
  });
  expect(
    await order(
      page,
      g([
        [-3, 2],
        [-2, 1],
        [-1, 0],
        [0, 0],
      ]),
    ),
  ).toBe(true);
  expect(
    await order(
      page,
      g([
        [-4, 2],
        [-4, 1],
        [-3, 0],
        [-2, -1],
      ]),
    ),
  ).toBe(true);
  await submitTurn(page);
  await expect(page.getByRole("dialog", { name: "Lesson complete" })).toHaveCount(0);
  expect(
    await order(
      page,
      g([
        [0, 0],
        [1, 0],
      ]),
    ),
  ).toBe(true);
  expect(
    await order(
      page,
      g([
        [-2, -1],
        [-2, -2],
      ]),
    ),
  ).toBe(true);
  await submitTurn(page);
  const done = page.getByRole("dialog", { name: "Lesson complete" });
  await expect(done).toBeVisible();
  await done.getByRole("button", { name: "Next lesson" }).click();
  await expect(page.getByText("Goal: Hold the gap through turn 3.")).toBeVisible();
});

test("Try that turn again undoes a turn and brings its tutorial step back", async ({ page }) => {
  test.setTimeout(120_000);
  await openLesson(page, "Mass matters");
  await page.getByRole("button", { name: "Skip step" }).click(); // past the zoom step
  const card = page.locator(".tutorial-card");
  const stepBefore = await card.getAttribute("data-tutorial-step");
  await submitTurn(page);
  expect(await turn(page)).toBe(2);
  await expect(card).not.toHaveAttribute("data-tutorial-step", stepBefore ?? "");
  await page
    .getByRole("button", { name: "Try that turn again" })
    .or(page.getByTitle("Try that turn again"))
    .first()
    .click();
  await expect.poll(() => turn(page)).toBe(1);
  await expect(card).toHaveAttribute("data-tutorial-step", stepBefore ?? "");
});

test("Protect your core ends the game with the lesson complete, not the results screen", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openLesson(page, "Protect your core");
  expect(
    await order(page, {
      type: "grow",
      body: 0,
      path: [
        { q: -1, r: 0 },
        { q: 0, r: 0 },
      ],
    }),
  ).toBe(true);
  await page.getByRole("button", { name: "Submit" }).click();
  await expect(page.getByRole("dialog", { name: "Lesson complete" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { name: /Victory|Defeat/ })).toHaveCount(0);
});

test("Supply and At the same time complete through their taught moves", async ({ page }) => {
  test.setTimeout(180_000);
  await openLesson(page, "Supply is critical");
  expect(
    await order(page, {
      type: "grow",
      body: 0,
      path: [
        { q: 0, r: -1 },
        { q: 0, r: 0 },
      ],
    }),
  ).toBe(true);
  await submitTurn(page);
  await submitTurn(page);
  await expect(page.getByRole("dialog", { name: "Lesson complete" })).toBeVisible();

  await openLesson(page, "At the same time");
  const into = {
    type: "grow",
    body: 0,
    path: [
      { q: -1, r: 0 },
      { q: 0, r: 0 },
    ],
  };
  expect(await order(page, into)).toBe(true);
  await submitTurn(page); // stalemate
  await expect(page.getByRole("dialog", { name: "Lesson complete" })).toHaveCount(0);
  expect(await order(page, { type: "reinforce", body: 0, cell: { q: -1, r: 0 } })).toBe(true);
  await submitTurn(page);
  expect(await order(page, into)).toBe(true);
  await submitTurn(page);
  await expect(page.getByRole("dialog", { name: "Lesson complete" })).toBeVisible();
});

test("Fruit and launch: a spore lands on another body", async ({ page }) => {
  test.setTimeout(180_000);
  await openLesson(page, "Fruit and launch");
  // The cell beside the core, as the lesson sets it up (biomass 4).
  const cell = await page.evaluate(() => {
    type S = {
      players: { id: number; home: { body: number } }[];
      bodies: {
        radius: number;
        colony: ({ owner: number; core: boolean; connected: boolean; biomass: number } | null)[];
      }[];
    };
    const st = (window as unknown as { __swarm: { session: { state: S } } }).__swarm.session.state;
    const home = st.players.find((p) => p.id === 0)!.home.body;
    const b = st.bodies[home]!;
    const R = b.radius;
    const cells: { q: number; r: number }[] = [];
    for (let r = -R; r <= R; r++)
      for (let q = -R; q <= R; q++)
        if ((Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2 <= R) cells.push({ q, r });
    const i = b.colony.findIndex((c) => !!c && c.owner === 0 && !c.core && c.connected);
    return { body: home, hex: cells[i]!, biomass: b.colony[i]!.biomass };
  });
  expect(cell.biomass).toBe(4);
  expect(await order(page, { type: "reinforce", body: cell.body, cell: cell.hex })).toBe(true);
  await submitTurn(page);
  expect(await order(page, { type: "fruit", body: cell.body, cell: cell.hex })).toBe(true);
  await submitTurn(page);
  await submitTurn(page);
  // Ripe now: launch at the first cell of another body the planner accepts.
  const launched = await page.evaluate((from) => {
    type S = { bodies: { id: number; radius: number; home: number | null }[] };
    const h = (
      window as unknown as {
        __swarm: { session: { state: S; planner: { add(o: unknown): { ok: boolean } } } };
      }
    ).__swarm.session;
    for (const b of h.state.bodies) {
      if (b.id === from.body || b.home === 1) continue;
      const R = b.radius;
      for (let r = -R; r <= R; r++)
        for (let q = -R; q <= R; q++) {
          if ((Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2 > R) continue;
          const o = {
            type: "launch",
            body: from.body,
            cell: from.hex,
            targetBody: b.id,
            targetCell: { q, r },
          };
          if (h.planner.add(o).ok) return true;
        }
    }
    return false;
  }, cell);
  expect(launched).toBe(true);
  for (let k = 0; k < 3; k++) {
    if (await page.getByRole("dialog", { name: "Lesson complete" }).isVisible()) break;
    await submitTurn(page);
  }
  await expect(page.getByRole("dialog", { name: "Lesson complete" })).toBeVisible();
});
