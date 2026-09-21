/**
 * Before the scenarios: settle the run folder, record the posture the
 * application is running in, and clear leftovers from earlier runs through
 * the audited product services. Runs after Playwright has started the web
 * server, so the application's health endpoint can be read too.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { DbBridge } from './support/db';
import { postureEnv } from './support/posture';
import {
  runContext,
  scenarioCode,
  scenarioDirName,
  slugForType,
  writeExecution,
  type Execution,
} from './support/run';

export default async function globalSetup(): Promise<void> {
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  const run = runContext(repoRoot);
  const execution: Execution = {
    runId: run.runId,
    startedAt: run.startedAt,
    completedAt: null,
    employee: run.employee,
    environment: 'UAT',
    emailMode: 'TEST',
    testMailbox: run.testMailbox,
    baseUrl: run.baseUrl,
    appCommit: null,
    scenarios: [],
    exceptions: [],
    notes: [],
  };
  writeExecution(run.runDir, execution);

  const env = postureEnv(run, repoRoot);
  const bridge = new DbBridge(repoRoot, env);

  // Every supported separation type is planned up front, so a scenario that
  // never starts is reported as not run rather than silently absent.
  const catalogue = bridge.profiles();
  execution.scenarios = catalogue.types.map((t, i) => ({
    code: scenarioCode(i),
    slug: slugForType(t.type),
    type: t.type,
    label: t.profile.label,
    result: 'SKIPPED',
    caseNumber: null,
    caseUrl: null,
    dir: scenarioDirName(scenarioCode(i), slugForType(t.type)),
    checks: { pass: 0, fail: 0, warn: 0, humanReview: 0 },
    emails: 0,
    documents: 0,
    links: 0,
    screenshots: 0,
    startedAt: '',
    completedAt: null,
    headline: 'Not run.',
  }));
  execution.notes.push(
    `Separation types discovered from the platform: ${catalogue.types.map((t) => t.type).join(', ')}`,
  );
  // The directory proofs are planned too, so a run that never reaches them
  // reports them as not run rather than silently absent.
  execution.directory = {
    result: 'SKIPPED',
    dir: 'BambooHR Directory',
    checks: { pass: 0, fail: 0, warn: 0, humanReview: 0 },
    sections: [],
    startedAt: '',
    completedAt: null,
    headline: 'Not run.',
  };
  execution.notes.push(
    process.env['OFFBOARDING_E2E_WEBHOOK_KEY']
      ? 'BambooHR webhook: a per-run private key was generated for the web server (value never recorded).'
      : 'BambooHR webhook: no per-run key set; the signed-webhook proof is skipped (run through pnpm regression:offboarding).',
  );

  try {
    const res = await fetch(`${run.baseUrl}/api/health/lan`);
    const health = (await res.json()) as { commit?: string; environment?: string };
    execution.appCommit = health.commit ?? null;
    execution.notes.push(
      `Application health: environment=${health.environment ?? '?'} commit=${health.commit ?? '?'}`,
    );
  } catch (e) {
    execution.notes.push(`Health endpoint unavailable: ${String(e).slice(0, 120)}`);
  }

  const prep = bridge.prepareRun({ employee: run.employee, runId: run.runId });
  execution.notes.push(
    `Posture: APP_ENVIRONMENT=${prep.posture.appEnvironment}, EMAIL_MODE=${prep.posture.emailMode}, TEST_EMAIL=${prep.posture.testEmail ?? '(unset)'}, rehearsal=${JSON.stringify(prep.posture.rehearsalMode)}`,
  );
  execution.notes.push(`Automation flags: ${JSON.stringify(prep.posture.automationFlags)}`);
  if (prep.voided.length)
    execution.notes.push(
      `Leftover TEST cases from earlier runs voided (audited): ${prep.voided.map((v) => `${v.caseNumber} (was ${v.from})`).join(', ')}`,
    );
  if (prep.leftAlone.length)
    execution.notes.push(
      `Leftover cases that could not be voided: ${prep.leftAlone.map((v) => `${v.caseNumber} ${v.status}`).join('; ')}`,
    );

  const facts = bridge.directoryFacts(run.employee);
  execution.notes.push(
    `Directory record for "${run.employee}": ${facts.matches} active match(es) in ${facts.sourceSystem ?? 'no directory'}; fields present: ${
      Object.entries(facts.present)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(', ') || 'none'
    }; missing: ${
      Object.entries(facts.present)
        .filter(([, v]) => !v)
        .map(([k]) => k)
        .join(', ') || 'none'
    }; manager on record: ${facts.manager?.onRecord ? 'yes' : 'no'}${facts.manager?.onRecord ? ` (routable email: ${facts.manager.hasWorkEmail ? 'yes' : 'no'})` : ''}`,
  );
  writeExecution(run.runDir, execution);
  writeFileSync(
    path.join(run.runDir, 'run-context.json'),
    JSON.stringify({ ...run, posture: prep.posture, directory: facts }, null, 2),
  );
}
