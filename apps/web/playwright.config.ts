import { defineConfig, devices } from "@playwright/test";

// End-to-end tests (e2e/). They run against the development server and the
// development database, with the accounts made by `pnpm e2e:seed`:
//
//   pnpm e2e            (from the repository root: seeds, then runs)
//
// A server that is already running is used as it is; otherwise `pnpm dev` is
// started for the run. Set E2E_BASE_URL to test another address (the origin,
// e.g. http://localhost:3100).
// E2E_BASE_PATH: the sub-path the server under test is served from (its
// KNOWLECTIVE_BASE_PATH), e.g. "/knowlective". The tests address pages relative to the
// base URL ("login", not "/login"), so they run the same either way.
const origin = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const basePath = (process.env.E2E_BASE_PATH ?? "").replace(/\/+$/, "");
const baseURL = `${origin}${basePath}/`;

export default defineConfig({
  testDir: "e2e",
  outputDir: "e2e/.results",
  // One at a time: the tests share one database, and an authenticator code
  // can only be used once.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  // Development mode compiles each screen on first use.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    // The app names its elements with data-ui (AGENTS.md).
    testIdAttribute: "data-ui",
    locale: "ja-JP",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, dependencies: ["setup"] },
  ],
  webServer: {
    command: "pnpm dev",
    url: `${baseURL}api/health`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});