/**
 * After the scenarios: close execution.json and build the run's README,
 * summary.md and summary.html from the scenario result files. The summary
 * is built from the files on disk, never from memory, so a run that was
 * interrupted still summarises whatever it managed to record.
 */
import { fileURLToPath } from 'node:url';
import { readExecution, runContext, writeExecution } from './support/run';
import { buildSummary } from './support/summary';

export default async function globalTeardown(): Promise<void> {
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  const run = runContext(repoRoot);
  const ex = readExecution(run.runDir);
  if (ex) {
    ex.completedAt = new Date().toISOString();
    for (const s of ex.scenarios) if (s.result === 'RUNNING') s.result = 'FAIL';
    if (ex.directory?.result === 'RUNNING') ex.directory.result = 'FAIL';
    writeExecution(run.runDir, ex);
  }
  buildSummary(run.runDir);
  process.stdout.write(
    `
Offboarding regression evidence: ${run.runDir}
  open summary.html or README.md there.
`,
  );
}
