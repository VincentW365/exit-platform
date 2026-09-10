/**
 * The environment the run asks the application (and the database bridge) to
 * adopt. One place, so the web server, the bridge and the tests agree.
 */
import path from 'node:path';
import type { RunContext } from './run';

export function postureEnv(run: RunContext, repoRoot?: string): Record<string, string> {
  const port = new URL(run.baseUrl).port || '3101';
  // One object store for every process. The web server runs from apps/web
  // and the bridge from the repository root; a relative STORAGE_DIR would
  // give them different folders and the outbox could not find a rendered
  // PDF to attach. Absolute, and the same everywhere.
  const storage = repoRoot
    ? path.resolve(repoRoot, process.env['STORAGE_DIR'] ?? './storage')
    : undefined;
  return {
    ...(storage ? { STORAGE_DIR: storage } : {}),
    APP_ENVIRONMENT: 'test',
    TEST_EMAIL: run.testMailbox,
    APP_BASE_URL: run.baseUrl,
    WEB_PORT: port,
  };
}
