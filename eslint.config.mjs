// Root ESLint flat config for shared packages and the worker.
// apps/web keeps its own generated eslint-config-next configuration and is
// linted separately (see the root "lint" script), so it is ignored here.
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    'apps/web/**',
    '**/node_modules/**',
    '**/dist/**',
    '**/.next/**',
    'packages/db/src/generated/**',
    'playwright-report/**',
    'test-results/**',
    'coverage/**',
    'storage/**',
    'tmp/**', // gitignored local scratch (UAT fixtures, perf harness)
  ]),
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // The worker and scripts are console applications: structured stdout logging is intentional.
    files: ['apps/worker/**', 'packages/db/src/seed.ts', 'packages/db/test-int/**', 'scripts/**'],
    rules: {
      'no-console': 'off',
    },
  },
]);
