import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Integration tests run against a REAL, isolated PostgreSQL test database
// (TestStrategy.md: "Mocks alone are insufficient"). DATABASE_URL_TEST from
// the root .env is promoted to DATABASE_URL for the test processes, so the
// development database is never touched.
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '.env'));
} catch {
  // environment must already be configured
}

const testUrl = process.env['DATABASE_URL_TEST'];
if (!testUrl) {
  throw new Error(
    'DATABASE_URL_TEST is required for integration tests (see .env.example). ' +
      'It must point at a disposable test database.',
  );
}

export default defineConfig({
  test: {
    include: ['packages/db/test-int/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./vitest.integration.setup.ts'],
    // One database -> deterministic, sequential execution.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      DATABASE_URL: testUrl,
      NODE_ENV: 'test',
      ALLOW_DEV_LOGIN: 'false',
      SESSION_SECRET: 'integration-test-secret-0123456789abcdefghij',
      SCAN_MODE: 'disabled',
      EMAIL_MODE: 'sink',
    },
  },
});
