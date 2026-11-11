import { defineConfig, devices } from "@playwright/test";

// WebKit is required for the cross-platform golden check (SPEC §9.3). It runs in CI, where
// `playwright install --with-deps chromium webkit` is available. Locally it is opt-in with
// PW_WEBKIT=1 because not every machine has the WebKit build installed.
const withWebkit = Boolean(process.env.CI) || process.env.PW_WEBKIT === "1";

export default defineConfig({
  testDir: "e2e",
  reporter: "list",
  use: { trace: "off" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    ...(withWebkit ? [{ name: "webkit", use: { ...devices["Desktop Safari"] } }] : []),
  ],
});
