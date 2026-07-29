import { defineConfig } from 'vitest/config';

// Unit tests: pure domain/config logic, no database, no network.
export default defineConfig({
  test: {
    include: [
      'packages/config/test/**/*.test.ts',
      'packages/domain/test/**/*.test.ts',
      'packages/db/test/**/*.test.ts',
    ],
    environment: 'node',
  },
});
