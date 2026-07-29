import { defineConfig } from '@playwright/test';

// Critical-path E2E (TestStrategy.md section "End-to-end tests").
// Requires: migrated + seeded database, .env with ALLOW_DEV_LOGIN=true.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm --filter web exec next dev --port 3100',
    url: 'http://localhost:3100/signin',
    timeout: 240_000,
    reuseExistingServer: true,
  },
});
