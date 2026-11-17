import { defineConfig } from 'vitest/config';

// Unit tests: pure domain/config logic, no database, no network.
export default defineConfig({
  test: {
    include: [
      'packages/config/test/**/*.test.ts',
      'packages/domain/test/**/*.test.ts',
      'packages/db/test/**/*.test.ts',
      // Repository-level guards over the web app's source (no runtime, no database).
      'test/**/*.test.ts',
    ],
    environment: 'node',
  },
});
