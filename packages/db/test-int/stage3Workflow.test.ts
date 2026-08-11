/**
 * Stage 3 integration: workflow engine, queues, access revocation,
 * notifications and restricted terminations (Directive 3 T.1-T.11, T.23, T.25).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/client.ts';
import { createDraft, transitionCase, changeEffectiveTime } from '../src/services/caseService.ts';
import {
  activateCase,
  getCaseWorkflow,
  holdCase,
  previewWorkflowForCase,
  resumeCase,
} from '../src/services/workflowService.ts';
import {
  completeAccessTask,
  completeTask,
  getTask,
  listMyQueue,
  waiveTask,
} from '../src/services/taskService.ts';
import { listExceptionFeed } from '../src/services/exceptionService.ts';
import {
  prepareNotification,
  transitionNotification,
} from '../src/services/notificationService.ts';
import { runStage3Sweep } from '../src/services/workflowSweepService.ts';
import { ServiceError } from '../src/errors.ts';
import {
  createUser,
  readyAssignment,
  resetDb,
  seedStage3Fixtures,
  VALID_DRAFT,
} from './helpers.ts';

const prisma = getPrisma();

let officer: Awaited<ReturnType<typeof createUser>>;
let officer2: Awaited<ReturnType<typeof createUser>>;
let manager: Awaited<ReturnType<typeof createUser>>;
let itUser: Awaited<ReturnType<typeof createUser>>;
let finUser: Awaited<ReturnType<typeof createUser>>;
let lineMgr: Awaited<ReturnType<typeof createUser>>;
let sysAdmin: Awaited<ReturnType<typeof createUser>>;

const TEST_DRAFT = {
  ...VALID_DRAFT,
  recordPurpose: 'TEST',
  measurementCohort: null,
  confirmedLastDay: '2026-08-14T00:00:00.000Z',
} as const;

async function makeActiveCase(
  overrides: Record<string, unknown> = {},
  activator = manager,
): Promise<string> {
  const created = await createDraft(officer.actor, { ...TEST_DRAFT, ...overrides });
  await transitionCase(officer.actor, created.caseId, 'submit');
  await transitionCase(manager.actor, created.caseId, 'approve');
  await readyAssignment(created.caseId, manager.actor, officer.userId, lineMgr.userId);
  await activateCase(activator.actor, created.caseId);
  return created.caseId;
}

function tasksOf(caseId: string) {
  return prisma.workflowTask.findMany({
    where: { caseId },
    orderBy: { sortOrder: 'asc' },
  });
}

beforeAll(async () => {
  await resetDb();
  await seedStage3Fixtures();
  officer = await createUser('S3 Officer', 'HR_OFFICER');
  officer2 = await createUser('S3 Officer Two', 'HR_OFFICER');
  manager = await createUser('S3 Manager', 'HR_MANAGER');
  itUser = await createUser('S3 IT', 'IT_RESPONDER');
  finUser = await createUser('S3 Finance', 'FINANCE_RESPONDER');
  lineMgr = await createUser('S3 Line Manager', 'LINE_MANAGER');
  sysAdmin = await createUser('S3 SysAdmin', 'SYSTEM_ADMIN');
});

describe('workflow activation and pinning (T.1, T.2, T.25, B/C)', () => {
  it('OPERATIONAL/BASELINE cases cannot activate while the flag is off (T.25)', async () => {
    const created = await createDraft(officer.actor, {
      ...VALID_DRAFT,
      confirmedLastDay: '2026-08-14T00:00:00.000Z',
    });
    await transitionCase(officer.actor, created.caseId, 'submit');
    await transitionCase(manager.actor, created.caseId, 'approve');
    await expect(activateCase(manager.actor, created.caseId)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    const instances = await prisma.workflowInstance.count({ where: { caseId: created.caseId } });
    expect(instances).toBe(0);
  });

  it('previews then activates a resignation-with-notice workflow pinned to v1 (T.1, B.8)', async () => {
    const created = await createDraft(officer.actor, TEST_DRAFT);
    await transitionCase(officer.actor, created.caseId, 'submit');
    await transitionCase(manager.actor, created.caseId, 'approve');

    const preview = await previewWorkflowForCase(officer.actor, created.caseId);
    expect(preview.definition?.workflowType).toBe('RESIGNATION_WITH_NOTICE');
    expect(preview.tasks.length).toBeGreaterThanOrEqual(24);
    const access = preview.tasks.find((t) => t.taskKind === 'ACCESS_REVOCATION')!;
    expect(access.dueAt?.toISOString()).toBe('2026-08-14T22:00:00.000Z'); // exact effective time
    expect(access.waiverAllowed).toBe(false);

    await readyAssignment(created.caseId, manager.actor, officer.userId, lineMgr.userId);
    await activateCase(officer.actor, created.caseId);
    const instance = await prisma.workflowInstance.findFirstOrThrow({
      where: { caseId: created.caseId },
    });
    expect(instance.status).toBe('ACTIVE');
    expect(instance.definitionVersion).toBe(1);
    expect(instance.configChecksum).toBe(preview.definition!.configChecksum);

    // Tasks without dependencies released immediately; dependent ones held.
    const tasks = await tasksOf(created.caseId);
    expect(tasks.find((t) => t.taskCode === 'HR_VERIFY_CASE')!.status).toBe('READY');
    expect(tasks.find((t) => t.taskCode === 'HR_CONFIRM_DATES')!.status).toBe('NOT_READY');
    // Handover record + asset items were created (M, L).
    expect(await prisma.handoverRecord.count({ where: { caseId: created.caseId } })).toBe(1);
    expect(
      await prisma.assetRecoveryItem.count({ where: { caseId: created.caseId } }),
    ).toBeGreaterThanOrEqual(3); // EMP-TEST-001 issued assets
  });

  it('prevents duplicate activation (T.2 / C.3)', async () => {
    const caseId = await makeActiveCase();
    await expect(activateCase(manager.actor, caseId)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(
      await prisma.workflowInstance.count({
        where: { caseId, status: { in: ['ACTIVE', 'ON_HOLD', 'CLEARANCE_PENDING'] } },
      }),
    ).toBe(1);
  });

  it('activates immediate-resignation and termination workflows (T.1)', async () => {
    const immediateId = await makeActiveCase({
      departureType: 'IMMEDIATE_RESIGNATION',
      confirmedLastDay: null,
    });
    const immediate = await prisma.workflowInstance.findFirstOrThrow({
      where: { caseId: immediateId },
    });
    expect(immediate.workflowType).toBe('IMMEDIATE_RESIGNATION');

    // Restricted termination: the HR manager creates and works the case
    // (explicit participation is mandatory on RESTRICTED cases).
    const term = await createDraft(manager.actor, {
      ...TEST_DRAFT,
      departureType: 'TERMINATION',
      confirmedLastDay: null,
    });
    await transitionCase(manager.actor, term.caseId, 'submit');
    await transitionCase(manager.actor, term.caseId, 'approve');
    await readyAssignment(term.caseId, manager.actor, officer.userId, lineMgr.userId);
    await activateCase(manager.actor, term.caseId);
    const termInstance = await prisma.workflowInstance.findFirstOrThrow({
      where: { caseId: term.caseId },
    });
    expect(termInstance.workflowType).toBe('TERMINATION');
    // H.11: no survey task exists in the termination workflow.
    const termTasks = await tasksOf(term.caseId);
    expect(termTasks.some((t) => t.taskCode.includes('SURVEY'))).toBe(false);
  });
});

describe('dependency release and minimum-data department views (T.3, T.4)', () => {
  let caseId: string;
  beforeAll(async () => {
    caseId = await makeActiveCase();
  });

  it('completing a dependency releases the dependent task (T.3)', async () => {
    const before = await tasksOf(caseId);
    const verify = before.find((t) => t.taskCode === 'HR_VERIFY_CASE')!;
    const confirmDates = before.find((t) => t.taskCode === 'HR_CONFIRM_DATES')!;
    expect(confirmDates.status).toBe('NOT_READY');
    await completeTask(officer.actor, verify.id, 'Verified against the signed letter.');
    const after = await tasksOf(caseId);
    expect(after.find((t) => t.taskCode === 'HR_CONFIRM_DATES')!.status).toBe('READY');
  });

  it('department users get released tasks with minimum data; no case grant (T.4, J.3)', async () => {
    const tasks = await tasksOf(caseId);
    const itReview = tasks.find((t) => t.taskCode === 'IT_ACCESS_REVIEW')!;
    const view = await getTask(itUser.actor, itReview.id);
    expect(view.access).toBe('DEPARTMENT');
    expect(view.task.departureType).toBeNull(); // authorized-only field
    expect(view.task.caseId).toBeNull(); // no case navigation
    expect(view.task.employeeDisplayName).toBe('Avery Brown'); // minimum needed
    // The IT user still cannot see the case itself.
    await expect(getCaseWorkflow(itUser.actor, caseId)).rejects.toMatchObject({
      code: expect.stringMatching(/NOT_FOUND|FORBIDDEN/),
    });
    // SYSTEM_ADMIN has no queue and no task access (R.8).
    const adminQueue = await listMyQueue(sysAdmin.actor).catch((e) => e);
    expect(adminQueue).toBeInstanceOf(ServiceError);
    await expect(getTask(sysAdmin.actor, itReview.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    // Line managers see only tasks expressly assigned to them (H.6).
    await expect(getTask(lineMgr.actor, itReview.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    // HR queue rows carry the departure type; IT rows do not.
    const itQueue = await listMyQueue(itUser.actor, { view: 'all' });
    const row = itQueue.rows.find((r) => r.id === itReview.id)!;
    expect(row.departureType).toBeNull();
    expect(row.caseId).toBeNull();
    const hrQueue = await listMyQueue(officer.actor, { view: 'all' });
    expect(hrQueue.rows.some((r) => r.departureType !== null)).toBe(true);
  });

  it('finance sees finance tasks; completing them requires the role (D.3)', async () => {
    const tasks = await tasksOf(caseId);
    const finAck = tasks.find((t) => t.taskCode === 'FIN_ACKNOWLEDGE')!;
    expect(finAck.status).toBe('READY');
    await expect(
      completeTask(officer.actor, finAck.id, 'HR trying to complete finance work'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await completeTask(finUser.actor, finAck.id, 'Finance acknowledges the case.');
    const after = await tasksOf(caseId);
    expect(after.find((t) => t.taskCode === 'FIN_WORKPAPER_INIT')!.status).toBe('READY');
  });
});

describe('exact-time access revocation (T.5, T.6, I)', () => {
  it('access task cannot be waived - service and database both refuse (T.6)', async () => {
    const caseId = await makeActiveCase();
    const tasks = await tasksOf(caseId);
    const review = tasks.find((t) => t.taskCode === 'IT_ACCESS_REVIEW')!;
    await completeTask(itUser.actor, review.id, 'Systems listed.');
    const access = (await tasksOf(caseId)).find((t) => t.taskCode === 'IT_ACCESS_REVOCATION')!;
    expect(access.status).toBe('READY');
    await expect(waiveTask(manager.actor, access.id, 'try to waive')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    // Defence in depth: direct UPDATE to WAIVED is refused by the trigger.
    await expect(
      prisma.workflowTask.update({ where: { id: access.id }, data: { status: 'WAIVED' } }),
    ).rejects.toThrow(/cannot be waived/);
  });

  it('past-due access task becomes CRITICAL immediately and escalates to level 2 (T.5, I.6-I.8)', async () => {
    // Immediate resignation with the effective time already in the past (G.2).
    const caseId = await makeActiveCase({
      departureType: 'IMMEDIATE_RESIGNATION',
      receivedAt: '2026-07-28T13:00:00.000Z',
      effectiveSeparationAt: '2026-07-28T14:00:00.000Z',
      confirmedLastDay: null,
    });
    const access = (await tasksOf(caseId)).find((t) => t.taskCode === 'IT_ACCESS_REVOCATION')!;
    expect(access.status).toBe('READY'); // security tasks release immediately (G.1)

    await runStage3Sweep(new Date());
    const exception = await prisma.caseException.findFirstOrThrow({
      where: { caseId, exceptionType: 'CRITICAL_ACCESS_OVERDUE', status: 'OPEN' },
    });
    expect(exception.severity).toBe('CRITICAL');
    const escalated = await prisma.workflowTask.findUniqueOrThrow({ where: { id: access.id } });
    expect(escalated.escalationLevel).toBe(2); // > 15 minutes overdue

    // Completion stores the exact delay and resolves the exception (I.5).
    const result = await completeAccessTask(itUser.actor, access.id, {
      systemsCompleted: ['Network account', 'Email', 'Business applications', 'Building access'],
      systemsUnresolved: [],
      note: 'All access removed; evidence in the IT ticket TEST-1234.',
    });
    expect(result.result).toBe('COMPLETED_LATE');
    expect(result.lateMinutes).toBeGreaterThan(0);
    const resolved = await prisma.caseException.findFirstOrThrow({ where: { id: exception.id } });
    expect(resolved.status).toBe('RESOLVED');
  });

  it('early completion needs a reason; unresolved systems keep it blocked with CRITICAL exception (I.3, I.10)', async () => {
    const caseId = await makeActiveCase();
    const review = (await tasksOf(caseId)).find((t) => t.taskCode === 'IT_ACCESS_REVIEW')!;
    await completeTask(itUser.actor, review.id, 'Reviewed.');
    const access = (await tasksOf(caseId)).find((t) => t.taskCode === 'IT_ACCESS_REVOCATION')!;

    await expect(
      completeAccessTask(itUser.actor, access.id, {
        systemsCompleted: ['Email'],
        systemsUnresolved: [],
        note: 'Done early without authority.',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' }); // early, no reason

    const partial = await completeAccessTask(itUser.actor, access.id, {
      systemsCompleted: ['Email'],
      systemsUnresolved: ['Building access'],
      note: 'Door controller offline.',
      earlyCompletionReason: 'HR Manager approved early removal for this test.',
      incidentRef: 'INC-TEST-01',
    });
    expect(partial.result).toBe('PARTIAL');
    const after = await prisma.workflowTask.findUniqueOrThrow({ where: { id: access.id } });
    expect(after.status).toBe('BLOCKED');
    const critical = await prisma.caseException.findFirstOrThrow({
      where: { caseId, exceptionType: 'TASK_BLOCKED', refId: access.id, status: 'OPEN' },
    });
    expect(critical.severity).toBe('CRITICAL');
  });
});

describe('due-date recalculation and holds (T.7, T.8, E)', () => {
  it('an approved effective-time change recalculates with provenance (T.7, E.5)', async () => {
    const caseId = await makeActiveCase();
    const before = (await tasksOf(caseId)).find((t) => t.taskCode === 'IT_ACCESS_REVOCATION')!;
    expect(before.dueAt?.toISOString()).toBe('2026-08-14T22:00:00.000Z');

    await changeEffectiveTime(
      manager.actor,
      caseId,
      new Date('2026-08-21T22:00:00.000Z'),
      'Separation date renegotiated.',
    );
    const after = (await tasksOf(caseId)).find((t) => t.taskCode === 'IT_ACCESS_REVOCATION')!;
    expect(after.dueAt?.toISOString()).toBe('2026-08-21T22:00:00.000Z');
    expect(after.originalDueAt?.toISOString()).toBe('2026-08-14T22:00:00.000Z');
    expect(after.dueRecalcReason).toContain('effective separation time changed');
    expect(after.dueCalendarVersion).not.toBeNull();
  });

  it('ON_HOLD pauses eligible admin tasks but never the access task (T.8, E.3/E.4)', async () => {
    const caseId = await makeActiveCase();
    const before = await tasksOf(caseId);
    const accessBefore = before.find((t) => t.taskCode === 'IT_ACCESS_REVOCATION')!;
    const adminBefore = before.find((t) => t.taskCode === 'HR_VERIFY_CASE')!;

    await holdCase(manager.actor, caseId, 'Legal query raised.');
    await new Promise((r) => setTimeout(r, 1100));
    await resumeCase(manager.actor, caseId, 'Query resolved.');

    const after = await tasksOf(caseId);
    const accessAfter = after.find((t) => t.taskCode === 'IT_ACCESS_REVOCATION')!;
    const adminAfter = after.find((t) => t.taskCode === 'HR_VERIFY_CASE')!;
    expect(accessAfter.dueAt!.getTime()).toBe(accessBefore.dueAt!.getTime()); // never paused
    expect(adminAfter.dueAt!.getTime()).toBeGreaterThan(adminBefore.dueAt!.getTime()); // shifted
    expect(adminAfter.dueRecalcReason).toContain('case hold released');
  });
});

describe('notification control (T.9, T.10, T.11, K)', () => {
  let caseId: string;
  beforeAll(async () => {
    caseId = await makeActiveCase();
  });

  it('HR prepares an internal notice from the deterministic template (T.9)', async () => {
    const record = await prepareNotification(officer.actor, caseId, {
      notificationType: 'IT_ACCESS_REMOVAL',
    });
    expect(record.status).toBe('DRAFT');
    expect(record.bodySnapshot).toContain('Avery Brown');
    expect(record.bodySnapshot).not.toContain('[MISSING:');
    expect(record.contentChecksum).toMatch(/^[a-f0-9]{64}$/);

    await transitionNotification(officer.actor, record.id, 'submit');
    // Internal department notices: HR officer approval is sufficient (K.3).
    await transitionNotification(officer.actor, record.id, 'approve');
    await transitionNotification(officer.actor, record.id, 'markReady');
    await transitionNotification(officer.actor, record.id, 'recordManualSend', {
      method: 'IN_PERSON',
      destinationRef: 'IT service desk (internal)',
    });
    const sent = await prisma.notificationRecord.findUniqueOrThrow({ where: { id: record.id } });
    expect(sent.status).toBe('MANUALLY_SENT');
    expect(sent.manualSentAt).not.toBeNull();
  });

  it('duplicate notifications are prevented by the idempotency key (T.11)', async () => {
    await expect(
      prepareNotification(officer.actor, caseId, { notificationType: 'IT_ACCESS_REMOVAL' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('external providers require confirmed applicability + HR_MANAGER approval (T.10, K.2/K.9)', async () => {
    await expect(
      prepareNotification(officer.actor, caseId, {
        notificationType: 'SAGICOR_GROUP_HEALTH_REMOVAL',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' }); // no applicability confirmation

    const record = await prepareNotification(officer.actor, caseId, {
      notificationType: 'SAGICOR_GROUP_HEALTH_REMOVAL',
      applicabilityNote: 'Employee is enrolled in the group health plan (record TEST-GH-1).',
    });
    // Minimum data: no departure wording in the external body (K.16).
    expect(record.bodySnapshot!.toLowerCase()).not.toContain('resignation');
    await transitionNotification(officer.actor, record.id, 'submit');
    await expect(transitionNotification(officer.actor, record.id, 'approve')).rejects.toMatchObject(
      { code: 'FORBIDDEN' },
    ); // officer cannot approve external
    await transitionNotification(manager.actor, record.id, 'approve');
    const approved = await prisma.notificationRecord.findUniqueOrThrow({
      where: { id: record.id },
    });
    expect(approved.approvedById).toBe(manager.userId);
  });
});

describe('restricted termination non-discovery (T.23, H)', () => {
  let termCaseId: string;
  beforeAll(async () => {
    // Effective in 30 minutes: the restricted access task releases at -1h,
    // i.e. immediately once its dependencies complete.
    const soon = new Date(Date.now() + 30 * 60_000);
    const term = await createDraft(manager.actor, {
      ...TEST_DRAFT,
      departureType: 'TERMINATION',
      employeeSourceId: 'EMP-TEST-002',
      receivedAt: '2026-07-28T13:00:00.000Z',
      effectiveSeparationAt: soon.toISOString(),
      confirmedLastDay: null,
    });
    termCaseId = term.caseId;
    await transitionCase(manager.actor, termCaseId, 'submit');
    await transitionCase(manager.actor, termCaseId, 'approve');
    await readyAssignment(termCaseId, manager.actor, manager.userId, lineMgr.userId);
    await activateCase(manager.actor, termCaseId);
  });

  it('unreleased restricted tasks are invisible to departments (H.8)', async () => {
    const itQueue = await listMyQueue(itUser.actor, { view: 'all' });
    expect(
      itQueue.rows.some(
        (r) => r.caseNumber.includes('OFF') && r.employeeDisplayName === 'Jordan Lee',
      ),
    ).toBe(false);
    const finQueue = await listMyQueue(finUser.actor, { view: 'all' });
    expect(finQueue.rows.some((r) => r.employeeDisplayName === 'Jordan Lee')).toBe(false);
  });

  it('non-participant HR cannot discover the workflow, tasks or exceptions (T.23)', async () => {
    await expect(getCaseWorkflow(officer2.actor, termCaseId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const tasks = await tasksOf(termCaseId);
    await expect(getTask(officer2.actor, tasks[0]!.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const hrQueue = await listMyQueue(officer2.actor, { view: 'all' });
    expect(hrQueue.rows.some((r) => r.employeeDisplayName === 'Jordan Lee')).toBe(false);
    // The exception feed minimizes restricted rows for non-participant HR:
    // they are excluded entirely by the case-visibility predicate.
    const feed = await listExceptionFeed(officer2.actor);
    expect(feed.some((f) => f.employeeDisplayName === 'Jordan Lee')).toBe(false);
  });

  it('IT receives ONLY the released minimum-data access task (H.4)', async () => {
    // Complete the restricted HR chain to satisfy the access dependencies.
    for (const code of ['HR_RESTRICTED_PREP', 'HRM_AUTHORIZATION', 'HR_CONFIRM_EFFECTIVE_TIME']) {
      const t = (await tasksOf(termCaseId)).find((x) => x.taskCode === code)!;
      await completeTask(manager.actor, t.id, `${code} recorded.`);
    }
    const access = (await tasksOf(termCaseId)).find((t) => t.taskCode === 'IT_ACCESS_REVOCATION')!;
    expect(access.status).toBe('READY'); // release instant (-1h) already passed

    const itQueue = await listMyQueue(itUser.actor, { view: 'all' });
    const row = itQueue.rows.find((r) => r.id === access.id)!;
    expect(row.employeeDisplayName).toBe('Jordan Lee'); // needed to act
    expect(row.departureType).toBeNull(); // never disclosed
    expect(row.caseId).toBeNull();
    expect(row.confidential).toBe(true);
    // Finance's minimum task stays unreleased until the effective time (H.8).
    const finTask = (await tasksOf(termCaseId)).find((t) => t.taskCode === 'FIN_MINIMUM_TASK')!;
    expect(finTask.status).toBe('NOT_READY');
    // No termination letter exists or can exist (H.1/H.2).
    expect(await prisma.documentInstance.count({ where: { caseId: termCaseId } })).toBe(0);
  });
});
