/**
 * Live-data UAT dataset (Directive 6.2 M/N, DEC-043).
 *
 * Selects REAL employees from the synchronized live directory BY
 * ORGANIZATIONAL PATTERN (never by name) and creates SIMULATED offboarding
 * cases for the walkthrough scenarios. Every case is RecordPurpose=TEST,
 * carries the UAT banner and never triggers live side effects. Real names
 * exist only in the local database; this script prints AGGREGATES ONLY.
 *
 *   pnpm exec tsx scripts/live-uat-seed.ts
 *
 * Selection rules (M): different departments/locations/managers; excludes
 * people with no manager (except the dedicated scenario), senior titles
 * (director/CEO patterns), and anyone colliding with synthetic fixture or
 * function-account names. Scenario 7 uses a LOCAL simulated copy with the
 * manager reference removed - BambooHR is never written.
 */
import { loadRootEnvFile } from '../packages/config/src/index.ts';

loadRootEnvFile(import.meta.dirname);

const SENIOR_TITLE = /director|chief|ceo|managing|general manager|owner/i;

async function main(): Promise<void> {
  const db = await import('../packages/db/src/index.ts');
  const { SYNTHETIC_EMPLOYEES } = await import('../packages/domain/src/index.ts');
  const prisma = db.getPrisma();

  const live = await db.liveDirectoryPresence();
  if (!live.present) {
    console.error(
      'REFUSED: no live directory rows exist. Sync BambooHR first (Administration > System).',
    );
    process.exitCode = 1;
    await prisma.$disconnect();
    return;
  }

  const hrManager = await prisma.user.findFirst({
    where: {
      isActive: true,
      roleAssignments: { some: { role: 'HR_MANAGER', revokedAt: null } },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (!hrManager) throw new Error('No active HR_MANAGER account exists.');
  const hrActor = { userId: hrManager.id, roles: ['HR_MANAGER'] as never };

  const syntheticNames = new Set<string>(SYNTHETIC_EMPLOYEES.map((e) => e.displayName));
  for (const u of await prisma.user.findMany({ select: { displayName: true } }))
    syntheticNames.add(u.displayName);

  const people = (
    await prisma.employeeSourceRecord.findMany({
      where: {
        sourceSystem: 'BAMBOOHR',
        active: true,
        NOT: { displayName: { startsWith: 'PURGED-' } },
      },
      select: {
        sourceSystem: true,
        sourceId: true,
        displayName: true,
        jobTitle: true,
        department: true,
        location: true,
        managerName: true,
        managerSourceId: true,
      },
    })
  ).filter(
    (p) =>
      !syntheticNames.has(p.displayName) &&
      !SENIOR_TITLE.test(p.jobTitle ?? '') &&
      !p.sourceId.startsWith('UAT-SIM-'),
  );
  if (people.length < 6) {
    throw new Error('Too few eligible live records - review the directory sync first.');
  }

  const withManager = people.filter((p) => p.managerSourceId || p.managerName);
  // Scenario 1: standard subject with a manager, from the largest department.
  const byDept = new Map<string, typeof withManager>();
  for (const p of withManager) {
    const k = p.department ?? '(none)';
    byDept.set(k, [...(byDept.get(k) ?? []), p]);
  }
  const deptsBySize = [...byDept.entries()].sort((a, b) => b[1].length - a[1].length);
  const subject1 = deptsBySize[0]![1][0]!;
  // Scenario 2: a DIFFERENT department (and location where possible).
  const subject2 =
    deptsBySize
      .slice(1)
      .flatMap(([, v]) => v)
      .find((p) => p.location !== subject1.location) ?? deptsBySize[1]![1][0]!;
  // Scenario 8 (restricted): a third distinct department.
  const subject8 = withManager.find(
    (p) => p.department !== subject1.department && p.department !== subject2.department,
  )!;
  // Scenario 7: local SIMULATED missing-manager copy of a fourth person.
  const subject7base = withManager.find(
    (p) => ![subject1, subject2, subject8].some((s) => s.sourceId === p.sourceId),
  )!;
  const simId = `UAT-SIM-${subject7base.sourceId}`;
  await prisma.employeeSourceRecord.upsert({
    where: { sourceSystem_sourceId: { sourceSystem: 'BAMBOOHR', sourceId: simId } },
    create: {
      sourceSystem: 'BAMBOOHR',
      sourceId: simId,
      displayName: subject7base.displayName,
      workEmail: null,
      jobTitle: subject7base.jobTitle,
      department: subject7base.department,
      location: subject7base.location,
      retrievedAt: new Date(),
      managerName: null,
      managerSourceId: null,
      active: true,
      payload: { simulatedCopyOf: subject7base.sourceId, uatOnly: true },
    },
    update: { managerName: null, managerSourceId: null, active: true },
  });

  const receivedAt = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
  const NOTE =
    'UAT ONLY — SIMULATED OFFBOARDING — NOT A REAL EMPLOYEE SEPARATION (DEC-043 live-data UAT).';

  const mk = async (
    label: string,
    employeeSourceId: string,
    departureType: 'RESIGNATION_WITH_NOTICE' | 'IMMEDIATE_RESIGNATION' | 'TERMINATION',
  ) => {
    const created = await db.createDraft(hrActor, {
      employeeSourceId,
      departureType,
      receivedAt,
      receiptSource: NOTE,
      recordPurpose: 'TEST',
      measurementCohort: null,
      ...(departureType === 'RESIGNATION_WITH_NOTICE' ? { confirmedLastDay: inDays(12) } : {}),
      effectiveSeparationAt: departureType === 'IMMEDIATE_RESIGNATION' ? inDays(1) : inDays(12),
    });
    console.log(`${label}: ${created.caseNumber} (${departureType}, TEST)`);
    return created;
  };

  await mk('Scenario 1 (standard resignation)', subject1.sourceId, 'RESIGNATION_WITH_NOTICE');
  await mk('Scenario 2 (immediate resignation)', subject2.sourceId, 'IMMEDIATE_RESIGNATION');
  await mk('Scenario 7 (missing manager, simulated copy)', simId, 'RESIGNATION_WITH_NOTICE');
  await mk('Scenario 8 (restricted termination)', subject8.sourceId, 'TERMINATION');

  console.log('Aggregates:', {
    eligibleLivePeople: people.length,
    departmentsRepresented: new Set(
      [subject1, subject2, subject7base, subject8].map((p) => p.department),
    ).size,
    locationsRepresented: new Set(
      [subject1, subject2, subject7base, subject8].map((p) => p.location),
    ).size,
  });
  console.log(
    'Live-data UAT cases created. Continue with docs/operations/LiveDataStakeholderUATWalkthrough.md.',
  );
  await prisma.$disconnect();
}

void main();
