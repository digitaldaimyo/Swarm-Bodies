import { chromium } from "@playwright/test";
import lighthouse from "lighthouse";
import { expect, test } from "./fixtures";

// SPEC §15 M8 acceptance: Lighthouse PWA and accessibility scores ≥ 90. Lighthouse 11 is pinned:
// version 12 removed the PWA category (DECISIONS). It drives its own Chromium (Playwright's) over
// the DevTools port, with Lighthouse's default mobile emulation.
const PORT = 9333;

test("Lighthouse: PWA and accessibility ≥ 90 (best practices too)", async ({ baseURL }, info) => {
  test.skip(info.project.name !== "chromium", "Lighthouse drives Chromium only");
  test.setTimeout(180_000);
  const browser = await chromium.launch({ args: [`--remote-debugging-port=${PORT}`] });
  try {
    const result = await lighthouse(`${baseURL}/`, {
      port: PORT,
      output: "json",
      logLevel: "error",
      onlyCategories: ["pwa", "accessibility", "best-practices"],
    });
    const categories = result?.lhr.categories ?? {};
    const scores = Object.fromEntries(
      Object.entries(categories).map(([k, c]) => [k, Math.round((c.score ?? 0) * 100)]),
    );
    const failing = Object.values(categories).flatMap((c) =>
      c.auditRefs
        .filter((a) => a.weight > 0)
        .map((a) => result?.lhr.audits[a.id])
        .filter((a) => a && a.score !== null && a.score < 1)
        .map((a) => `${c.id}: ${a?.id}`),
    );
    console.log("Lighthouse", scores, failing.length ? failing : "");
    expect(scores["pwa"]).toBeGreaterThanOrEqual(90);
    expect(scores["accessibility"]).toBeGreaterThanOrEqual(90);
    expect(scores["best-practices"]).toBeGreaterThanOrEqual(90);
  } finally {
    await browser.close();
  }
});
