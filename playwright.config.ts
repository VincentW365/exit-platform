import { defineConfig } from '@playwright/test';

// Critical-path E2E (TestStrategy.md section "End-to-end tests").
// Requires: migrated + seeded database, .env with ALLOW_DEV_LOGIN=true.
export default defineConfig({
  testDir: './e2e',
  // Playwright empties its output directory before every run. Keep that to a
  // folder of its own: test-results/offboarding-e2e/ holds the regression
  // evidence packs and must survive every run of every config.
  outputDir: './test-results/playwright',
  timeout: 60_000,
  // Dev-server cold compiles can exceed the 5s default on first navigation.
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
    // Bound individual actions so a hung locator fails fast instead of
    // consuming the whole test budget.
    actionTimeout: 20_000,
  },
  webServer: {
    command: 'pnpm --filter web exec next dev --port 3100',
    url: 'http://localhost:3100/signin',
    timeout: 240_000,
    reuseExistingServer: true,
  },
});
