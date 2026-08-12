/**
 * Stakeholder synthetic UAT dataset (Directive 6 section B).
 *
 * Builds the labelled scenario cases through the REAL service layer
 * (authorization, validation, snapshots, audit) on top of a freshly seeded
 * development database. Every case is record purpose TEST and carries a
 * "SYNTHETIC STAKEHOLDER UAT DATA" note. Synthetic EMP-TEST employees only.
 *
 * Prerequisites (run in order):
 *   1. reset dev DB (DEVELOPMENT.md) + pnpm db:seed
 *   2. pnpm exec tsx scripts/uat-stakeholder-seed.ts
 *   3. pnpm exec playwright test e2e/uat-scenarios.spec.ts -g "UAT-1"
 *      (drives one case to COMPLETED with survey + captured notification,
 *      covering scenarios 7 and 9 through the real UI)
 */
import { loadRootEnvFile } from '../packages/config/src/index.ts';

loadRootEnvFile(import.meta.dirname);

const LABEL = 'SYNTHETIC STAKEHOLDER UAT DATA';

async function main(): Promise<void> {
  const db = await import('../packages/db/src/index.ts');
  const prisma = db.getPrisma();

  const actorFor = async (slug: string, role: string) => {
    const u = await prisma.user.findUniqueOrThrow({ where: { identitySubject: `dev|${slug}` } });
    return { userId: u.id, roles: [role] as never };
  };
  const officer = await actorFor('hr-officer', 'HR_OFFICER');
  const manager = await actorFor('hr-manager', 'HR_MANAGER');

  // Disposable IT responder for the Scenario 11 deactivation drill. Created
  // here (not in the base seed) because only the UAT dataset needs him; the
  // upsert makes rebuilds idempotent and re-enables him after a drill.
  const devon = await prisma.user.upsert({
    where: { identitySubject: 'dev|it-responder-b' },
    create: {
      identitySubject: 'dev|it-responder-b',
      displayName: 'Second IT Responder',
      workEmail: 'devon.temple@example.test',
    },
    update: { displayName: 'Second IT Responder', isActive: true },
  });
  const devonRole = await prisma.roleAssignment.findFirst({
    where: { userId: devon.id, role: 'IT_RESPONDER' as never, revokedAt: null },
  });
  if (!devonRole) {
    await prisma.roleAssignment.create({
      data: {
        userId: devon.id,
        role: 'IT_RESPONDER' as never,
        reason: `${LABEL} - Scenario 11 disposable IT responder.`,
      },
    });
  }

  const note = async (actor: never, caseId: string, text: string) =>
    db.addNote(actor, caseId, `${LABEL} - ${text}`, 'HR_AND_OVERSIGHT');

  const draft = async (
    employee: string,
    type: string,
    opts: { receivedDaysAgo?: number; effectiveInDays?: number; purpose?: string } = {},
  ) => {
    const received = new Date(Date.now() - (opts.receivedDaysAgo ?? 2) * 86_400_000);
    const effective = new Date(Date.now() + (opts.effectiveInDays ?? 14) * 86_400_000);
    effective.setHours(17, 0, 0, 0);
    return db.createDraft(officer as never, {
      employeeSourceId: employee,
      departureType: type,
      receivedAt: received.toISOString(),
      receiptSource: `${LABEL} - synthetic receipt`,
      confirmedLastDay: effective.toISOString().slice(0, 10),
      effectiveSeparationAt: effective.toISOString(),
      measurementCohort: null,
      recordPurpose: (opts.purpose ?? 'TEST') as never,
    });
  };

  // Directive 6.1 (E/F/J): activation requires the assignment plan. The seed
  // assigns the HR Officer, routes manager tasks to the dev line manager
  // (audited override where derivation did not resolve), and confirms.
  const lineManager = await prisma.user.findUniqueOrThrow({
    where: { identitySubject: 'dev|line-manager' },
  });
  const { CONFIRMATION_KEYS } = await import('../packages/domain/src/index.ts');
  const readyAssignment = async (caseId: string) => {
    await db.assignOfficer(
      manager as never,
      caseId,
      (officer as { userId: string }).userId,
      `${LABEL} - operational officer assignment.`,
    );
    await db.overrideManager(
      manager as never,
      caseId,
      lineManager.id,
      `${LABEL} - manager routing for the UAT dataset.`,
    );
    await db.confirmAssignmentPlan(manager as never, caseId, [...CONFIRMATION_KEYS]);
  };

  const approveAndActivate = async (caseId: string) => {
    await db.transitionCase(officer as never, caseId, 'submit');
    await db.transitionCase(manager as never, caseId, 'approve');
    await readyAssignment(caseId);
    await db.activateCase(officer as never, caseId);
  };

  const summary: string[] = [];

  // 1. Resignation with notice - ACTIVE, mid-journey.
  const s1 = await draft('EMP-TEST-001', 'RESIGNATION_WITH_NOTICE');
  await approveAndActivate(s1.caseId);
  await note(
    officer as never,
    s1.caseId,
    'Scenario 1: resignation with notice, active workflow ready for HR/IT/Finance/Manager journey.',
  );
  summary.push(`S1 ${s1.caseNumber} resignation-with-notice ACTIVE`);

  // 2. Immediate resignation - urgent, access removal already overdue.
  const s2 = await draft('EMP-TEST-002', 'IMMEDIATE_RESIGNATION', {
    receivedDaysAgo: 1,
    effectiveInDays: -1,
  });
  await approveAndActivate(s2.caseId);
  await note(
    officer as never,
    s2.caseId,
    'Scenario 2: immediate resignation; the exact-time access task is overdue and escalates.',
  );
  summary.push(`S2 ${s2.caseNumber} immediate-resignation ACTIVE overdue-access`);

  // 3. Restricted termination - discoverable only by authorized HR.
  const s3 = await db.createDraft(manager as never, {
    employeeSourceId: 'EMP-TEST-003',
    departureType: 'TERMINATION',
    receivedAt: new Date(Date.now() - 86_400_000).toISOString(),
    receiptSource: `${LABEL} - synthetic restricted intake`,
    effectiveSeparationAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    measurementCohort: null,
    recordPurpose: 'TEST',
  });
  await note(
    manager as never,
    s3.caseId,
    'Scenario 3: restricted termination; verify non-disclosure to unauthorized roles.',
  );
  summary.push(`S3 ${s3.caseNumber} restricted-termination DRAFT`);

  // 4. Approved document invalidated by an audited correction; corrected
  //    draft awaits re-submission and re-approval.
  const s4 = await draft('EMP-TEST-004', 'RESIGNATION_WITH_NOTICE');
  await db.transitionCase(officer as never, s4.caseId, 'submit');
  await db.transitionCase(manager as never, s4.caseId, 'approve');
  const s4doc = await db.createLetterDraft(officer as never, s4.caseId);
  await db.submitDocument(officer as never, s4doc.id);
  await db.approveDocument(manager as never, s4doc.id);
  const newEffective = new Date(Date.now() + 16 * 86_400_000);
  newEffective.setHours(17, 0, 0, 0);
  await db.changeEffectiveTime(
    manager as never,
    s4.caseId,
    newEffective,
    `${LABEL} - Scenario 4 audited correction (separation moved two days).`,
  );
  await note(
    manager as never,
    s4.caseId,
    'Scenario 4: the approved letter shows INVALIDATED/superseded; re-submit and re-approve the corrected draft.',
  );
  summary.push(`S4 ${s4.caseNumber} document-correction pending re-approval`);

  // 5. Overdue departmental work - received long ago, tasks past due.
  const s5 = await draft('EMP-TEST-005', 'RESIGNATION_WITH_NOTICE', {
    receivedDaysAgo: 12,
    effectiveInDays: 3,
  });
  await approveAndActivate(s5.caseId);
  await note(
    officer as never,
    s5.caseId,
    'Scenario 5: departmental tasks are overdue; review the escalation exceptions.',
  );
  summary.push(`S5 ${s5.caseNumber} overdue-tasks ACTIVE`);

  // 6. Asset lost - review exception with NO payroll consequence.
  const s6 = await draft('EMP-TEST-002', 'RESIGNATION_WITH_NOTICE', { receivedDaysAgo: 3 });
  await approveAndActivate(s6.caseId);
  const s6assets = await db.listCaseAssets(officer as never, s6.caseId);
  const firstAsset = s6assets.items[0];
  if (firstAsset) {
    await db.setAssetDisposition(officer as never, firstAsset.id, {
      status: 'LOST',
      reason: `${LABEL} - employee reports the item lost (synthetic).`,
    });
  }
  await note(
    officer as never,
    s6.caseId,
    'Scenario 6: lost asset raises a review exception; confirm no payroll/deduction appears anywhere.',
  );
  summary.push(`S6 ${s6.caseNumber} asset-lost exception`);

  // 8. Blocked clearance - a blocked task plus unmet gate conditions.
  const s8 = await draft('EMP-TEST-004', 'RESIGNATION_WITH_NOTICE', { receivedDaysAgo: 1 });
  await approveAndActivate(s8.caseId);
  const s8wf = await db.getCaseWorkflow(officer as never, s8.caseId);
  const verifyTask = s8wf.instances[0]?.tasks.find((t: { title: string }) =>
    t.title.startsWith('Verify resignation'),
  );
  if (verifyTask) {
    await db.blockTask(
      officer as never,
      verifyTask.id,
      `${LABEL} - awaiting the signed letter from the branch (synthetic blocker).`,
    );
  }
  await note(
    officer as never,
    s8.caseId,
    'Scenario 8: clearance is blocked by open conditions and a recorded task blocker.',
  );
  summary.push(`S8 ${s8.caseNumber} blocked-clearance ACTIVE`);

  // 10. Failed notification in the development outbox (demonstration state).
  const s10 = await draft('EMP-TEST-001', 'IMMEDIATE_RESIGNATION', { receivedDaysAgo: 1 });
  await approveAndActivate(s10.caseId);
  const s10n = await db.prepareNotification(officer as never, s10.caseId, {
    notificationType: 'IT_ACCESS_REMOVAL',
  });
  await db.transitionNotification(officer as never, s10n.id, 'submit');
  await db.transitionNotification(manager as never, s10n.id, 'approve');
  // Demonstration state for the outbox monitor: mark the enqueued row as a
  // retryable provider failure (synthetic; retry stays a week away so the
  // stakeholder sees the FAILED_RETRYABLE surface and the Retry control).
  await prisma.notificationOutbox.updateMany({
    where: { notificationRecordId: s10n.id },
    data: {
      status: 'FAILED_RETRYABLE',
      attempts: 2,
      lastErrorCode: 'UPSTREAM_ERROR',
      nextAttemptAt: new Date(Date.now() + 7 * 86_400_000),
    },
  });
  await note(
    officer as never,
    s10.caseId,
    'Scenario 10: the outbox monitor shows a retryable synthetic provider failure for this case.',
  );
  summary.push(`S10 ${s10.caseNumber} outbox FAILED_RETRYABLE demo`);

  // One sweep pass computes overdue states and escalation exceptions for
  // scenarios 2 and 5 exactly as the worker would.
  const sweep = await db.runStage3Sweep(new Date());
  summary.push(
    `sweep: released ${sweep.released}, overdue ${sweep.overdueExceptions}, accessEscalations ${sweep.accessEscalations}`,
  );

  console.log(summary.join('\n'));
  console.log(
    'Scenarios 7 and 9 (completed case + survey + captured notification): run ' +
      'pnpm exec playwright test e2e/uat-scenarios.spec.ts -g "UAT-1"',
  );
  await prisma.$disconnect();
}

void main();
