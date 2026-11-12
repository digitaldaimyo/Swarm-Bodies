import { expect, test as base, type Page } from "@playwright/test";

/**
 * SPEC §15 M8: no console errors in the Playwright suite. Every page a test opens, including
 * pages in extra browser contexts (the multi-player tests), is watched for uncaught exceptions
 * and console errors; any one fails the test at teardown. A test that provokes an error on
 * purpose lists it with `allowConsoleErrors`.
 */
export const test = base.extend<{
  /** Errors this test provokes on purpose (one pattern; arrays read as fixture tuples). */
  allowConsoleErrors: RegExp | null;
  consoleGuard: undefined;
}>({
  allowConsoleErrors: [null, { option: true }],
  consoleGuard: [
    async ({ browser, context, allowConsoleErrors }, use) => {
      const errors: string[] = [];
      const watch = (page: Page) => {
        page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
        page.on("console", (m) => {
          if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
        });
      };
      for (const p of context.pages()) watch(p);
      context.on("page", watch);
      const created = browser.newContext.bind(browser);
      browser.newContext = async (...args) => {
        const ctx = await created(...args);
        ctx.on("page", watch);
        return ctx;
      };
      await use(undefined);
      browser.newContext = created;
      const unexpected = errors.filter((e) => !allowConsoleErrors?.test(e));
      expect(unexpected, "console errors during the test").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
