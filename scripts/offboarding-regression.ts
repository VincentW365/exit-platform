/**
 * Run the full offboarding workflow regression suite and produce the
 * evidence pack (owner directive, 2026-09-09).
 *
 *   pnpm regression:offboarding [--employee "Name"] [--mailbox addr] [--port 3101] [--grep TEST-03]
 *
 * What it does:
 *   1. Refuses to run outside a local development/UAT environment.
 *   2. Refuses while another `next dev` holds this application (Next keeps a
 *      lock in apps/web/.next/dev): stop the dev server first.
 *   3. Creates test-results/offboarding-e2e/<run-date>-<run-id>/.
 *   4. Starts its own web server in the UAT posture (APP_ENVIRONMENT=test,
 *      TEST_EMAIL=<mailbox>) on the chosen port and runs every scenario.
 *   5. Prints where the evidence is and the exception list.
 *
 * Defaults keep committed code synthetic: the employee is a fixture person
 * and the mailbox is a reserved undeliverable address. Name the controlled
 * employee and the designated test mailbox on the command line.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { loadRootEnvFile } from '../packages/config/src/index.ts';

loadRootEnvFile(import.meta.dirname);

const root = path.resolve(import.meta.dirname, '..');

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1]!.startsWith('--'))
    return process.argv[i + 1];
  return fallback;
}

function stamp(now = new Date()): string {
  const s = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
  return `${s.slice(0, 8)}-${s.slice(9, 15)}`;
}

async function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, () => srv.close(() => resolve(true)));
  });
}

async function main(): Promise<void> {
  if (process.env['NODE_ENV'] === 'production') {
    console.error('Refusing: NODE_ENV=production. This suite runs only in development/UAT.');
    process.exit(2);
  }
  if (process.env['ALLOW_DEV_LOGIN'] !== 'true') {
    console.error(
      'Refusing: ALLOW_DEV_LOGIN must be true (the suite signs in through the UAT role switcher).',
    );
    process.exit(2);
  }
  const employee = arg('employee', process.env['OFFBOARDING_E2E_EMPLOYEE'] ?? 'Avery Brown')!;
  const mailbox = arg(
    'mailbox',
    process.env['OFFBOARDING_E2E_TEST_MAILBOX'] ?? 'uat-test-mailbox@example.test',
  )!;
  const port = Number(arg('port', process.env['WEB_PORT_REGRESSION'] ?? '3101'));
  const grep = arg('grep');

  const lock = path.join(root, 'apps', 'web', '.next', 'dev', 'lock');
  if (existsSync(lock)) {
    console.error(
      `Refusing: a development server appears to hold this application (${path.relative(root, lock)} exists).\n` +
        'Stop the running `pnpm dev` server first - Next.js allows one dev server per application directory -\n' +
        'then run this again. (If no server is running, delete the lock file.)',
    );
    process.exit(2);
  }
  if (!(await portFree(port))) {
    console.error(`Refusing: port ${port} is already in use. Choose another with --port.`);
    process.exit(2);
  }

  const runDir = path.join(root, 'test-results', 'offboarding-e2e', stamp());
  mkdirSync(runDir, { recursive: true });

  console.log(`Offboarding regression run`);
  console.log(`  employee:  ${employee}`);
  console.log(`  mailbox:   ${mailbox} (redirect target; delivery = development capture)`);
  console.log(`  server:    http://localhost:${port} (APP_ENVIRONMENT=test)`);
  console.log(`  evidence:  ${runDir}`);
  console.log('');

  const args = ['exec', 'playwright', 'test', '-c', 'playwright.regression.config.ts'];
  if (grep) args.push('-g', grep);
  const r = spawnSync('pnpm', args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      OFFBOARDING_E2E_RUN_DIR: runDir,
      OFFBOARDING_E2E_EMPLOYEE: employee,
      OFFBOARDING_E2E_TEST_MAILBOX: mailbox,
      OFFBOARDING_E2E_BASE_URL: `http://localhost:${port}`,
      WEB_PORT_REGRESSION: String(port),
      // A fresh webhook private key for this run only (BambooHR directory
      // proofs): the web server verifies with it, the suite signs with it,
      // and neither prints it.
      OFFBOARDING_E2E_WEBHOOK_KEY: randomBytes(32).toString('hex'),
    },
  });

  const executionPath = path.join(runDir, 'execution.json');
  if (existsSync(executionPath)) {
    const ex = JSON.parse(readFileSync(executionPath, 'utf8')) as {
      scenarios: Array<{ code: string; label: string; result: string; caseNumber: string | null }>;
      exceptions: Array<{ level: string; scenario: string; text: string }>;
    };
    console.log('\nScenarios:');
    for (const s of ex.scenarios)
      console.log(`  ${s.result.padEnd(7)} ${s.code} ${s.label} ${s.caseNumber ?? ''}`);
    const critical = ex.exceptions.filter((e) => e.level === 'FAIL');
    console.log(
      critical.length ? `\nFAIL items: ${critical.length}` : '\nNo critical exceptions detected.',
    );
    for (const e of critical.slice(0, 20)) console.log(`  FAIL ${e.scenario}: ${e.text}`);
  }
  console.log(`\nEvidence pack: ${runDir}\nOpen ${path.join(runDir, 'summary.html')}`);
  process.exit(r.status ?? 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
