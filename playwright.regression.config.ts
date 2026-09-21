import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

/**
 * The offboarding regression and evidence suite (owner directive, 2026-09-09).
 *
 * It runs against its OWN development server, started here in the UAT
 * posture (APP_ENVIRONMENT=test): real routing is resolved and every message
 * is redirected to one test mailbox, while the only provider available in
 * development captures messages to the database and never sends. Nothing
 * here weakens a production guard - the same guards refuse to start if the
 * posture is wrong.
 *
 * Run it through `pnpm regression:offboarding` (scripts/offboarding-regression.ts),
 * which creates the run folder and checks the environment first.
 */
const port = Number(process.env['WEB_PORT_REGRESSION'] ?? 3101);
const baseUrl = process.env['OFFBOARDING_E2E_BASE_URL'] ?? `http://localhost:${port}`;
const mailbox = process.env['OFFBOARDING_E2E_TEST_MAILBOX'] ?? 'uat-test-mailbox@example.test';
// The same absolute object store as the database bridge (see support/posture.ts).
const storageDir = path.resolve(
  fileURLToPath(new URL('./', import.meta.url)),
  process.env['STORAGE_DIR'] ?? './storage',
);

export default defineConfig({
  testDir: './e2e/offboarding-regression',
  // Playwright EMPTIES its output directory at the start of every run. The
  // evidence folders live under test-results/offboarding-e2e/ and must
  // survive every later run (directive sections 38-39), so Playwright's own
  // artefacts (traces) go to a sibling folder of their own.
  outputDir: './test-results/offboarding-e2e-playwright',
  testMatch: /offboarding\.spec\.ts$/,
  timeout: 20 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/offboarding-regression/global-setup.ts',
  globalTeardown: './e2e/offboarding-regression/global-teardown.ts',
  use: {
    baseURL: baseUrl,
    trace: 'retain-on-failure',
    actionTimeout: 20_000,
    viewport: { width: 1280, height: 900 },
  },
  webServer: {
    command: `pnpm --filter web exec next dev --port ${port}`,
    url: `${baseUrl}/signin`,
    timeout: 240_000,
    // Never reuse: a server started in the development posture would not
    // resolve real routing, and one from another run would not be this run.
    reuseExistingServer: false,
    env: {
      APP_ENVIRONMENT: 'test',
      TEST_EMAIL: mailbox,
      APP_BASE_URL: baseUrl,
      WEB_PORT: String(port),
      STORAGE_DIR: storageDir,
      // BambooHR directory proofs (2026-09-15): the runner generates a
      // per-run webhook private key so the signed-webhook path is exercised
      // end to end. Without one the endpoint stays closed and the proof is
      // recorded as skipped. The value is never written to the evidence.
      ...(process.env['OFFBOARDING_E2E_WEBHOOK_KEY']
        ? { BAMBOOHR_WEBHOOK_PRIVATE_KEY: process.env['OFFBOARDING_E2E_WEBHOOK_KEY'] }
        : {}),
    },
  },
});
