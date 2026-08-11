/**
 * Realistic-UAT alias mapping (Directive 6.1 sections T/AK).
 *
 * Facilitator-only tool. `create` selects employees from the SYNCED
 * directory by organizational pattern (never hard-coded names), assigns
 * aliases (UAT Employee A, UAT Manager A, ...), writes the LOCAL mapping
 * file `uat-local-real-person-mapping.json` (git- and docker-ignored) and
 * raises the "REAL DIRECTORY MAPPING ACTIVE — UAT ONLY" banner via system
 * configuration. `view` prints it locally. `purge` deletes the file, lowers
 * the banner and can anonymize the live directory cache.
 *
 *   pnpm exec tsx scripts/uat-alias.ts create|view|purge [--purge-directory]
 *
 * The mapping never leaves this machine. Committed docs use aliases only.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadRootEnvFile } from '../packages/config/src/index.ts';

loadRootEnvFile(import.meta.dirname);

const MAPPING_PATH = path.resolve(import.meta.dirname, '..', 'uat-local-real-person-mapping.json');

interface MappingEntry {
  alias: string;
  sourceSystem: string;
  sourceId: string;
  displayName: string;
  department: string | null;
  jobTitle: string | null;
  location: string | null;
  managerAlias?: string;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const db = await import('../packages/db/src/index.ts');
  const prisma = db.getPrisma();
  const sysAdmin = await prisma.user.findFirst({
    where: { roleAssignments: { some: { role: 'SYSTEM_ADMIN', revokedAt: null } }, isActive: true },
  });
  if (!sysAdmin) throw new Error('No active SYSTEM_ADMIN account exists.');
  const adminActor = { userId: sysAdmin.id, roles: ['SYSTEM_ADMIN'] as never };

  if (command === 'view') {
    if (!existsSync(MAPPING_PATH)) {
      console.log('No local mapping exists.');
    } else {
      console.log(readFileSync(MAPPING_PATH, 'utf8'));
    }
    await prisma.$disconnect();
    return;
  }

  if (command === 'purge') {
    if (existsSync(MAPPING_PATH)) {
      unlinkSync(MAPPING_PATH);
      console.log('Local mapping file deleted.');
    } else {
      console.log('No local mapping file to delete.');
    }
    await db.setSystemConfig(
      adminActor,
      'uat.aliasActive',
      false,
      'Realistic UAT alias mapping purged.',
    );
    console.log('REAL DIRECTORY MAPPING banner lowered.');
    if (process.argv.includes('--purge-directory')) {
      const result = await db.purgeLiveDirectory(adminActor);
      console.log(
        `Live directory cache purged: ${result.anonymized} record(s) anonymized (${result.referencedKept} case-referenced kept as PURGED markers).`,
      );
    }
    await prisma.$disconnect();
    return;
  }

  if (command !== 'create') {
    console.log('Usage: pnpm exec tsx scripts/uat-alias.ts create|view|purge [--purge-directory]');
    await prisma.$disconnect();
    process.exitCode = 1;
    return;
  }

  // Pattern-based selection over the synced directory - never names. Real
  // people whose names collide with synthetic fixtures or dev accounts are
  // excluded up front: the collision would make evidence ambiguous.
  const { SYNTHETIC_EMPLOYEES } = await import('../packages/domain/src/index.ts');
  const syntheticNames = new Set<string>(SYNTHETIC_EMPLOYEES.map((e) => e.displayName));
  const devUsers = await prisma.user.findMany({ select: { displayName: true } });
  for (const u of devUsers) syntheticNames.add(u.displayName);
  const people = (
    await prisma.employeeSourceRecord.findMany({
      where: { active: true, NOT: { displayName: { startsWith: 'PURGED-' } } },
      select: {
        sourceSystem: true,
        sourceId: true,
        displayName: true,
        workEmail: true,
        department: true,
        jobTitle: true,
        location: true,
        managerName: true,
        managerSourceId: true,
      },
    })
  ).filter((p) => !syntheticNames.has(p.displayName) && !p.sourceId.startsWith('EMP-TEST'));
  if (people.length < 4) {
    throw new Error(
      'The directory has too few active records - run a directory sync first (fixture or live).',
    );
  }
  const bySourceId = new Map(people.map((p) => [p.sourceId, p]));
  const reportCounts = new Map<string, number>();
  for (const p of people) {
    if (p.managerSourceId)
      reportCounts.set(p.managerSourceId, (reportCounts.get(p.managerSourceId) ?? 0) + 1);
  }
  // Managers with the most reports, that themselves exist in the directory.
  const managers = [...reportCounts.entries()]
    .filter(([id]) => bySourceId.has(id))
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => bySourceId.get(id)!);
  if (managers.length === 0) {
    throw new Error('No manager relationships resolved - review /admin/organization first.');
  }
  const managerA = managers[0]!;
  const managerB = managers[1] ?? managerA;
  const reportsOf = (managerId: string) =>
    people.filter((p) => p.managerSourceId === managerId && p.sourceId !== managerId);
  const employeeA = reportsOf(managerA.sourceId)[0];
  const employeeA2 = reportsOf(managerA.sourceId)[1] ?? employeeA;
  const employeeB =
    reportsOf(managerB.sourceId).find((p) => p.department !== employeeA?.department) ??
    reportsOf(managerB.sourceId)[0];
  const employeeC =
    people.find(
      (p) =>
        p.managerSourceId &&
        p.sourceId !== employeeA?.sourceId &&
        p.sourceId !== employeeB?.sourceId &&
        p.sourceId !== managerA.sourceId &&
        p.sourceId !== managerB.sourceId,
    ) ?? employeeA;
  if (!employeeA || !employeeB || !employeeC) {
    throw new Error('Could not select distinct employees by pattern - sync more records first.');
  }

  // Scenario F: a SIMULATED missing-manager copy - a local directory record
  // cloned from a real one with the manager removed. BambooHR is never
  // written; the copy is purged with everything else.
  const simSourceId = `UAT-SIM-${employeeC.sourceId}`;
  await prisma.employeeSourceRecord.upsert({
    where: {
      sourceSystem_sourceId: { sourceSystem: employeeC.sourceSystem, sourceId: simSourceId },
    },
    create: {
      sourceSystem: employeeC.sourceSystem,
      sourceId: simSourceId,
      displayName: employeeC.displayName,
      workEmail: null,
      jobTitle: employeeC.jobTitle,
      department: employeeC.department,
      location: employeeC.location,
      retrievedAt: new Date(),
      managerName: null,
      managerSourceId: null,
      active: true,
      payload: { simulatedCopyOf: employeeC.sourceId, uatOnly: true },
    },
    update: { managerName: null, managerSourceId: null, active: true },
  });

  const entries: MappingEntry[] = [
    { alias: 'UAT Manager A', ...pick(managerA) },
    { alias: 'UAT Manager B', ...pick(managerB) },
    { alias: 'UAT Employee A', ...pick(employeeA), managerAlias: 'UAT Manager A' },
    { alias: 'UAT Employee A2', ...pick(employeeA2!), managerAlias: 'UAT Manager A' },
    { alias: 'UAT Employee B', ...pick(employeeB), managerAlias: 'UAT Manager B' },
    { alias: 'UAT Employee C', ...pick(employeeC), managerAlias: 'aliased manager' },
    {
      alias: 'UAT Employee D (missing manager, simulated copy)',
      sourceSystem: employeeC.sourceSystem,
      sourceId: simSourceId,
      displayName: employeeC.displayName,
      department: employeeC.department,
      jobTitle: employeeC.jobTitle,
      location: employeeC.location,
    },
  ];
  writeFileSync(
    MAPPING_PATH,
    `${JSON.stringify({ createdAt: new Date().toISOString(), entries }, null, 2)}\n`,
  );
  await db.setSystemConfig(
    adminActor,
    'uat.aliasActive',
    true,
    'Realistic UAT alias mapping created (local file only).',
  );
  console.log(
    `Mapping written to ${path.basename(MAPPING_PATH)} (${entries.length} aliases; file is git-ignored).`,
  );
  console.log('REAL DIRECTORY MAPPING ACTIVE — UAT ONLY banner raised.');
  console.log('Aggregates: ', {
    aliases: entries.length,
    departments: new Set(entries.map((e) => e.department).filter(Boolean)).size,
    locations: new Set(entries.map((e) => e.location).filter(Boolean)).size,
  });
  await prisma.$disconnect();

  function pick(p: (typeof people)[number]) {
    return {
      sourceSystem: p.sourceSystem,
      sourceId: p.sourceId,
      displayName: p.displayName,
      department: p.department,
      jobTitle: p.jobTitle,
      location: p.location,
    };
  }
}

void main();
