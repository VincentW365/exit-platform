/**
 * One regression run = one folder (directive section 31):
 *
 *   test-results/offboarding-e2e/<run-date>-<run-id>/
 *
 * The runner script creates the folder and hands its path to Playwright
 * through the environment; the global setup falls back to creating one so
 * `playwright test -c playwright.regression.config.ts` also works alone.
 * Everything the run learns about itself is written to execution.json as
 * it goes, so a run that dies half way still leaves a readable record.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { DirectorySummary } from './directoryEvidence';

export const ENV_RUN_DIR = 'OFFBOARDING_E2E_RUN_DIR';
export const ENV_EMPLOYEE = 'OFFBOARDING_E2E_EMPLOYEE';
export const ENV_TEST_MAILBOX = 'OFFBOARDING_E2E_TEST_MAILBOX';
export const ENV_BASE_URL = 'OFFBOARDING_E2E_BASE_URL';

/**
 * Defaults keep committed code synthetic (CLAUDE.md): the controlled
 * employee is a fixture person unless the operator names another, and the
 * test mailbox is a reserved, undeliverable address unless the operator
 * points it at a real one.
 */
export const DEFAULT_EMPLOYEE = 'Avery Brown';
export const DEFAULT_TEST_MAILBOX = 'uat-test-mailbox@example.test';
export const DEFAULT_PORT = 3101;

export interface RunContext {
  runId: string;
  runDir: string;
  startedAt: string;
  employee: string;
  testMailbox: string;
  baseUrl: string;
  environment: 'UAT';
  emailMode: 'TEST';
}

export interface ScenarioSummary {
  code: string;
  slug: string;
  type: string;
  label: string;
  result: 'PASS' | 'FAIL' | 'WARN' | 'SKIPPED' | 'RUNNING';
  caseNumber: string | null;
  caseUrl: string | null;
  dir: string;
  checks: { pass: number; fail: number; warn: number; humanReview: number };
  emails: number;
  documents: number;
  links: number;
  screenshots: number;
  startedAt: string;
  completedAt: string | null;
  headline: string;
}

export interface Execution {
  runId: string;
  startedAt: string;
  completedAt: string | null;
  employee: string;
  environment: 'UAT';
  emailMode: 'TEST';
  testMailbox: string;
  baseUrl: string;
  appCommit: string | null;
  scenarios: ScenarioSummary[];
  exceptions: Array<{
    level: 'FAIL' | 'WARNING' | 'PASS' | 'HUMAN_REVIEW';
    scenario: string;
    text: string;
    href?: string;
  }>;
  notes: string[];
  /** BambooHR directory proofs (owner directive, 2026-09-15). */
  directory?: DirectorySummary;
}

function stamp(now = new Date()): string {
  return now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
}

/** Resolve (or create) the run folder and its context. */
export function runContext(repoRoot: string): RunContext {
  let runDir = process.env[ENV_RUN_DIR];
  const startedAt = new Date();
  if (!runDir) {
    const id = `${stamp(startedAt).slice(0, 8)}-${stamp(startedAt).slice(9, 15)}`;
    runDir = path.join(repoRoot, 'test-results', 'offboarding-e2e', id);
    process.env[ENV_RUN_DIR] = runDir;
  }
  mkdirSync(runDir, { recursive: true });
  mkdirSync(path.join(runDir, 'failures'), { recursive: true });
  const runId = path.basename(runDir);
  const port = Number(process.env['WEB_PORT_REGRESSION'] ?? DEFAULT_PORT);
  return {
    runId,
    runDir,
    startedAt: startedAt.toISOString(),
    employee: process.env[ENV_EMPLOYEE] ?? DEFAULT_EMPLOYEE,
    testMailbox: process.env[ENV_TEST_MAILBOX] ?? DEFAULT_TEST_MAILBOX,
    baseUrl: process.env[ENV_BASE_URL] ?? `http://localhost:${port}`,
    environment: 'UAT',
    emailMode: 'TEST',
  };
}

export function executionPath(runDir: string): string {
  return path.join(runDir, 'execution.json');
}

export function readExecution(runDir: string): Execution | null {
  const p = executionPath(runDir);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')) as Execution;
}

export function writeExecution(runDir: string, ex: Execution): void {
  writeFileSync(executionPath(runDir), JSON.stringify(ex, null, 2));
}

/** Update execution.json in place; the file is the single source of truth. */
export function updateExecution(runDir: string, fn: (ex: Execution) => void): Execution {
  const ex = readExecution(runDir);
  if (!ex) throw new Error(`execution.json missing in ${runDir}`);
  fn(ex);
  writeExecution(runDir, ex);
  return ex;
}

/** Scenario codes follow the platform's own canonical type order (section 3). */
export function slugForType(type: string): string {
  const known: Record<string, string> = {
    RESIGNATION_WITH_NOTICE: 'resignation-with-notice',
    IMMEDIATE_RESIGNATION: 'immediate-resignation',
    TERMINATION: 'termination',
    RETIREMENT: 'retirement',
    CONTRACT_EXPIRY: 'contract-expiry',
    REDUNDANCY: 'redundancy',
    OTHER: 'other',
  };
  return known[type] ?? type.toLowerCase().replace(/_/g, '-');
}

export function scenarioCode(index: number): string {
  return `TEST-${String(index + 1).padStart(2, '0')}`;
}

export function scenarioDirName(code: string, slug: string): string {
  return `${code}-${slug}`;
}
