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
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
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
  await expect(page.getByRole("button", { name: /Mass matters.*completed/ })).toBeVisible();
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
  // The last lesson so far has no next one.
  await expect(done.getByRole("button", { name: "Next lesson" })).toHaveCount(0);
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
