/**
 * Performance-smoke data seed (Directive 5 section G).
 *
 * Creates ~500 synthetic TEST-purpose offboarding cases through the REAL
 * service layer (authorization, validation, snapshots, workflow activation,
 * audit) so volumes are structurally representative: half the cases are
 * activated with full task/asset sets, a subset carries documents and
 * approved notifications. Synthetic identities only; automation flags stay
 * off; effective dates sit in the future so no overdue/escalation storm is
 * fabricated.
 *
 * Run:  pnpm exec tsx scripts/perf-seed.ts [count]
 * Data goes to the DEVELOPMENT database (.env). Never point this at real data.
 *
 * ISOLATION: run this only for an ad-hoc performance smoke, then RESET the
 * development database (DEVELOPMENT.md reset procedure) before running the
 * Playwright acceptance suites - the volume data floods the exception feed
 * and reuses fixture employees, which breaks the suites' non-disclosure and
 * first-page assertions by design, not by defect.
 */
import { loadRootEnvFile } from '../packages/config/src/index.ts';

loadRootEnvFile(import.meta.dirname);

const COUNT = Number(process.argv[2] ?? 500);
const EMPLOYEES = ['EMP-TEST-001', 'EMP-TEST-002', 'EMP-TEST-003', 'EMP-TEST-004', 'EMP-TEST-005'];
const TYPES = ['RESIGNATION_WITH_NOTICE', 'IMMEDIATE_RESIGNATION'];

async function main(): Promise<void> {
  const db = await import('../packages/db/src/index.ts');
  const prisma = db.getPrisma();

  const officerRow = await prisma.user.findUniqueOrThrow({
    where: { identitySubject: 'dev|hr-officer' },
  });
  const managerRow = await prisma.user.findUniqueOrThrow({
    where: { identitySubject: 'dev|hr-manager' },
  });
  const officer = { userId: officerRow.id, roles: ['HR_OFFICER'] as never };
  const manager = { userId: managerRow.id, roles: ['HR_MANAGER'] as never };
  const lineManagerRow = await prisma.user.findUniqueOrThrow({
    where: { identitySubject: 'dev|line-manager' },
  });
  const { CONFIRMATION_KEYS } = await import('../packages/domain/src/index.ts');

  const started = Date.now();
  let created = 0;
  let activated = 0;
  let documents = 0;
  let notifications = 0;

  for (let i = 0; i < COUNT; i++) {
    const type = TYPES[i % TYPES.length]!;
    const { caseId } = await db.createDraft(officer as never, {
      employeeSourceId: EMPLOYEES[i % EMPLOYEES.length]!,
      departureType: type,
      receivedAt: '2026-07-22T14:00:00.000Z',
      receiptSource: `Perf smoke synthetic receipt ${i + 1}`,
      confirmedLastDay: '2026-09-30',
      effectiveSeparationAt: '2026-09-30T22:00:00.000Z',
      measurementCohort: null,
      recordPurpose: 'TEST',
    });
    created++;
    await db.transitionCase(officer as never, caseId, 'submit');
    await db.transitionCase(manager as never, caseId, 'approve');

    if (i % 2 === 0) {
      // Directive 6.1: activation requires the assignment plan.
      await db.assignOfficer(manager as never, caseId, officerRow.id, 'Perf smoke assignment.');
      await db.overrideManager(manager as never, caseId, lineManagerRow.id, 'Perf smoke routing.');
      await db.confirmAssignmentPlan(manager as never, caseId, [...CONFIRMATION_KEYS]);
      await db.activateCase(officer as never, caseId);
      activated++;
    }
    if (i % 10 === 0) {
      await db.createLetterDraft(officer as never, caseId).catch(() => undefined);
      documents++;
    }
    if (i % 10 === 6) {
      try {
        const n = await db.prepareNotification(officer as never, caseId, {
          notificationType: 'IT_ACCESS_REMOVAL',
        });
        await db.transitionNotification(officer as never, n.id, 'submit');
        await db.transitionNotification(manager as never, n.id, 'approve');
        notifications++;
      } catch {
        // acceptable in a smoke seed (e.g. recipient rules); volumes still land
      }
    }
    if ((i + 1) % 50 === 0) {
      console.log(`${i + 1}/${COUNT} cases (${Math.round((Date.now() - started) / 1000)}s)`);
    }
  }

  console.log(
    JSON.stringify({
      created,
      activated,
      documents,
      notifications,
      seconds: Math.round((Date.now() - started) / 1000),
    }),
  );
  await prisma.$disconnect();
}

void main();
