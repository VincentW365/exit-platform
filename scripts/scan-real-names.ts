/**
 * Real-name leak scan (DEC-043 pre-commit gate).
 *
 * Live-data UAT keeps real employee information in the LOCAL database only.
 * This scan derives its needles from the local `employee_source_record`
 * BAMBOOHR rows (display names + distinctive ids) and greps every
 * git-TRACKED file for them, exiting non-zero on any hit. Names are never
 * printed - hits are reported as file + record ordinal only.
 *
 * With no live rows present the scan verifies that fact and passes; the
 * legacy alias-mapping filename must remain ignored and untracked forever.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadRootEnvFile } from '../packages/config/src/index.ts';

loadRootEnvFile(import.meta.dirname);

const ROOT = path.resolve(import.meta.dirname, '..');

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

async function main(): Promise<void> {
  // The retired mapping filename must never re-enter the tree (defence in depth).
  const trackedMapping = git('ls-files', '--', 'uat-local-real-person-mapping.json').trim();
  if (trackedMapping) {
    console.error('FAIL: uat-local-real-person-mapping.json is TRACKED by git.');
    process.exit(1);
  }

  const db = await import('../packages/db/src/index.ts');
  const prisma = db.getPrisma();
  const liveRows = await prisma.employeeSourceRecord.findMany({
    where: { sourceSystem: 'BAMBOOHR', NOT: { displayName: { startsWith: 'PURGED-' } } },
    select: { displayName: true, sourceId: true, workEmail: true },
  });
  await prisma.$disconnect();

  if (liveRows.length === 0) {
    console.log('PASS: no live directory rows exist locally; nothing to leak.');
    return;
  }

  // The repository operator's own git identity is inherently present in
  // commits and delivery records; when the operator is also a directory
  // employee their own name is NOT a directory leak.
  const gitAuthor = git('config', 'user.name').trim();

  // Distinctive needles only: full display names, non-numeric source ids
  // (numeric BambooHR ids collide with synthetic employee numbers), and real
  // work-email local parts.
  const needles = new Set<string>();
  for (const r of liveRows) {
    if (r.displayName.length >= 5 && r.displayName !== gitAuthor) needles.add(r.displayName);
    if (/[^0-9]/.test(r.sourceId) && r.sourceId.length >= 4) needles.add(r.sourceId);
    const local = r.workEmail?.split('@')[0];
    if (local && local.length >= 6 && local.includes('.')) needles.add(local);
  }

  const files = git('ls-files').split('\n').filter(Boolean);
  const contents = new Map<string, string>();
  for (const file of files) {
    try {
      contents.set(file, readFileSync(path.join(ROOT, file), 'utf8'));
    } catch {
      // binary or unreadable
    }
  }

  let failures = 0;
  let ordinal = 0;
  for (const needle of needles) {
    ordinal += 1;
    for (const [file, content] of contents) {
      if (content.includes(needle)) {
        console.error(`FAIL: tracked file ${file} contains live-directory value #${ordinal}.`);
        failures += 1;
      }
    }
  }
  if (failures > 0) {
    console.error(`Real-name scan FAILED with ${failures} hit(s).`);
    process.exit(1);
  }
  console.log(
    `PASS: no live-directory name/id/email (${liveRows.length} records, ${needles.size} needles) appears in any tracked file.`,
  );
}

void main();
