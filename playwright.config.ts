import { defineConfig, devices } from "@playwright/test";

// WebKit is required for the cross-platform golden check (SPEC §9.3). It runs in CI, where
// `playwright install --with-deps chromium webkit` is available. Locally it is opt-in with
// PW_WEBKIT=1 because not every machine has the WebKit build installed.
const withWebkit = Boolean(process.env.CI) || process.env.PW_WEBKIT === "1";

export default defineConfig({
  testDir: "e2e",
  reporter: "list",
  // One worker: the frame-timing test must not share the CPU with another browser.
  workers: 1,
  timeout: 180_000,
  use: { trace: "off", baseURL: "http://localhost:4173" },
  // The client is tested as it ships: the production build behind `vite preview`, which
  // proxies /api and /ws to the game server. The server needs Postgres: E2E_DATABASE_URL, or
  // the local default below (its database is created if missing).
  webServer: [
    {
      command: "pnpm --filter @swarm/server start:e2e",
      url: "http://localhost:8787/api/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        DATABASE_URL:
          process.env.E2E_DATABASE_URL ?? "postgres://swarm:swarm@localhost:5432/swarm_e2e",
        PORT: "8787",
        NODE_ENV: "test",
      },
    },
    {
      command: "pnpm --filter @swarm/client preview",
      url: "http://localhost:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    ...(withWebkit ? [{ name: "webkit", use: { ...devices["Desktop Safari"] } }] : []),
  ],
});
