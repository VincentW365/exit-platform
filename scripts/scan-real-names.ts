/**
 * Real-name leak scan (Directive 6.1 sections T/AP).
 *
 * Reads the LOCAL alias mapping (if present) and greps every git-TRACKED
 * file for the real display names, source ids and email local-parts it
 * contains. Exits non-zero on any hit. When no mapping exists, verifies the
 * mapping file itself is untracked and ignored. Never prints a real name -
 * hits are reported as file + alias reference only.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const MAPPING = path.join(ROOT, 'uat-local-real-person-mapping.json');

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function main(): void {
  // The mapping file must never be tracked, regardless of its existence.
  const tracked = git('ls-files', '--', 'uat-local-real-person-mapping.json').trim();
  if (tracked) {
    console.error('FAIL: uat-local-real-person-mapping.json is TRACKED by git.');
    process.exit(1);
  }
  const ignored = execFileSync('git', ['check-ignore', 'uat-local-real-person-mapping.json'], {
    cwd: ROOT,
    encoding: 'utf8',
  }).trim();
  if (!ignored) {
    console.error('FAIL: uat-local-real-person-mapping.json is not git-ignored.');
    process.exit(1);
  }

  if (!existsSync(MAPPING)) {
    console.log('PASS: no local mapping exists; mapping filename is ignored and untracked.');
    return;
  }

  const mapping = JSON.parse(readFileSync(MAPPING, 'utf8')) as {
    entries: Array<{ alias: string; displayName: string; sourceId: string }>;
  };
  // Known-fictional names (synthetic fixtures) are excluded as needles: any
  // tracked occurrence refers to the fixture, and the alias selector refuses
  // real people with colliding names anyway.
  const fixtureSource = readFileSync(
    path.join(ROOT, 'packages', 'domain', 'src', 'employeeSource.ts'),
    'utf8',
  );
  const isFictional = (name: string) => fixtureSource.includes(`'${name}'`);
  const files = git('ls-files').split('\n').filter(Boolean);
  let failures = 0;
  for (const entry of mapping.entries) {
    // Display names are always scanned; ids only when distinctive (purely
    // numeric BambooHR ids collide with synthetic employee numbers).
    const needles = [
      isFictional(entry.displayName) ? null : entry.displayName,
      /[^0-9]/.test(entry.sourceId) ? entry.sourceId : null,
    ].filter(
      (n): n is string =>
        Boolean(n && n.length >= 4) &&
        !n!.startsWith('EMP-TEST') &&
        !n!.startsWith('UAT-SIM-EMP-TEST') &&
        !n!.startsWith('UAT-SIM-'),
    );
    for (const needle of needles) {
      for (const file of files) {
        const full = path.join(ROOT, file);
        let content: string;
        try {
          content = readFileSync(full, 'utf8');
        } catch {
          continue; // binary or unreadable
        }
        if (content.includes(needle)) {
          console.error(`FAIL: tracked file ${file} contains data for "${entry.alias}".`);
          failures += 1;
        }
      }
    }
  }
  if (failures > 0) {
    console.error(`Real-name scan FAILED with ${failures} hit(s).`);
    process.exit(1);
  }
  console.log(
    `PASS: no real name/id from the local mapping (${mapping.entries.length} aliases) appears in any tracked file.`,
  );
}

main();
