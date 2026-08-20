/**
 * Directive 6.1 integration - HR ownership, manager routing, activation
 * gates, department-queue claim/assign/return and SLA preservation
 * (sections E/F/G/H/J, AM tests 12-27).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { getPrisma } from '../src/client.ts';
import { createDraft, transitionCase } from '../src/services/caseService.ts';
import { activateCase } from '../src/services/workflowService.ts';
import {
  assignOfficer,
  confirmAssignmentPlan,
  getAssignmentPlan,
  overrideManager,
} from '../src/services/caseAssignmentService.ts';
import {
  assignTask,
  claimTask,
  completeTask,
  listMyQueue,
  reassignTask,
  returnTaskToQueue,
  startTask,
} from '../src/services/taskService.ts';
import { CONFIRMATION_KEYS } from '@exit/domain';
import {
  createUser,
  readyAssignment,
  resetDb,
  seedStage3Fixtures,
  VALID_DRAFT,
  FIXTURE_CONFIRMED_LAST_DAY,
} from './helpers.ts';

const prisma = getPrisma();

let officer: Awaited<ReturnType<typeof createUser>>;
let manager: Awaited<ReturnType<typeof createUser>>;
// Directive 6.3 I/J: department logins are retired - queue mechanics are
// exercised by HR officers (and the retired roles prove they get nothing).
let hrA: Awaited<ReturnType<typeof createUser>>;
let hrB: Awaited<ReturnType<typeof createUser>>;
let itA: Awaited<ReturnType<typeof createUser>>;
let finA: Awaited<ReturnType<typeof createUser>>;
let lineMgr: Awaited<ReturnType<typeof createUser>>;

const TEST_DRAFT = {
  ...VALID_DRAFT,
  recordPurpose: 'TEST',
  measurementCohort: null,
  confirmedLastDay: FIXTURE_CONFIRMED_LAST_DAY,
} as const;

async function approvedCase(overrides: Record<string, unknown> = {}): Promise<string> {
  const created = await createDraft(officer.actor, { ...TEST_DRAFT, ...overrides });
  await transitionCase(officer.actor, created.caseId, 'submit');
  await transitionCase(manager.actor, created.caseId, 'approve');
  return created.caseId;
}

async function activeCase(overrides: Record<string, unknown> = {}): Promise<string> {
  const caseId = await approvedCase(overrides);
  await readyAssignment(caseId, manager.actor, officer.userId, lineMgr.userId);
  await activateCase(manager.actor, caseId);
  return caseId;
}

async function releasedHrTask(caseId: string) {
  const t = await prisma.workflowTask.findFirstOrThrow({
    where: {
      caseId,
      department: 'HR',
      status: 'READY',
      requiredRole: 'HR_OFFICER',
      assigneeId: null,
    },
    orderBy: { sortOrder: 'asc' },
  });
  return t;
}

beforeAll(async () => {
  await resetDb();
  await seedStage3Fixtures();
  officer = await createUser('D61A Officer', 'HR_OFFICER');
  manager = await createUser('D61A Manager', 'HR_MANAGER');
  hrA = await createUser('D61A HR One', 'HR_OFFICER');
  hrB = await createUser('D61A HR Two', 'HR_OFFICER');
  itA = await createUser('D61A IT One', 'IT_RESPONDER');
  finA = await createUser('D61A Finance', 'FINANCE_RESPONDER');
  lineMgr = await createUser('D61A Line Manager', 'LINE_MANAGER');
});

describe('HR officer ownership (E; AM 13)', () => {
  it('HR_MANAGER assigns and reassigns with full audit; targets validated', async () => {
    const caseId = await approvedCase();
    // Officers cannot assign officers.
    await expect(
      assignOfficer(officer.actor, caseId, officer.userId, 'self-serve'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    // Target must hold an HR role.
    await expect(
      assignOfficer(manager.actor, caseId, itA.userId, 'wrong role'),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await assignOfficer(manager.actor, caseId, officer.userId, 'Initial ownership.');
    const assigned = await prisma.auditEvent.findFirst({
      where: { caseId, eventType: 'CASE_OFFICER_ASSIGNED' },
    });
    expect(assigned).not.toBeNull();
    const officer2 = await createUser('D61A Officer Two', 'HR_OFFICER');
    await assignOfficer(manager.actor, caseId, officer2.userId, 'Workload rebalancing.');
    const reassigned = await prisma.auditEvent.findFirst({
      where: { caseId, eventType: 'CASE_OFFICER_REASSIGNED' },
    });
    const meta = reassigned!.metadata as Record<string, unknown>;
    expect(meta['previousOfficerId']).toBe(officer.userId);
    expect(meta['newOfficerId']).toBe(officer2.userId);
    expect(meta['reason']).toBe('Workload rebalancing.');
  });
});

describe('manager routing and the activation gate (F/J; AM 14-18)', () => {
  it('activation is blocked without officer, manager and confirmations - in that order', async () => {
    const caseId = await approvedCase({ employeeSourceId: 'EMP-TEST-002' });
    await expect(activateCase(manager.actor, caseId)).rejects.toMatchObject({
      code: 'VALIDATION',
      details: [expect.stringContaining('HR Officer must be assigned')],
    });
    await assignOfficer(manager.actor, caseId, officer.userId, 'Test.');
    // The fixture directory names a manager for this employee, so the notice
    // has somewhere to go and the remaining blocker is the confirmations.
    await expect(activateCase(manager.actor, caseId)).rejects.toMatchObject({
      code: 'VALIDATION',
      details: [expect.stringContaining('not confirmed')],
    });
    await confirmAssignmentPlan(manager.actor, caseId, [...CONFIRMATION_KEYS]);
    await activateCase(manager.actor, caseId);
  });

  it('override is HR-Manager-only, target-validated and audited before/after (AM 14)', async () => {
    const caseId = await approvedCase({ employeeSourceId: 'EMP-TEST-003' });
    // An alternate manager is a DIRECTORY person now, not an account.
    const alternate = await prisma.employeeSourceRecord.findFirstOrThrow({
      where: { NOT: [{ workEmail: null }, { workEmail: '' }] },
      select: { sourceId: true, displayName: true },
    });
    await expect(
      overrideManager(officer.actor, caseId, alternate.sourceId, 'not my call'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      overrideManager(manager.actor, caseId, 'NOT-IN-DIRECTORY', 'unknown person'),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await overrideManager(
      manager.actor,
      caseId,
      alternate.sourceId,
      'Manager on leave during UAT.',
    );
    const e = await prisma.auditEvent.findFirst({
      where: { caseId, eventType: 'CASE_MANAGER_OVERRIDDEN' },
    });
    const meta = e!.metadata as Record<string, unknown>;
    expect(meta['originalManagerName']).toBe('Operations Manager');
    expect(meta['replacementManagerSourceId']).toBe(alternate.sourceId);
    expect(meta['reason']).toBe('Manager on leave during UAT.');
    const c = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(c.managerSource).toBe('OVERRIDE');
  });

  it('confirmation is all-or-nothing (AM 15)', async () => {
    const caseId = await approvedCase({ employeeSourceId: 'EMP-TEST-004' });
    await assignOfficer(manager.actor, caseId, officer.userId, 'Test.');
    const routeTo = await prisma.employeeSourceRecord.findFirstOrThrow({
      where: { NOT: [{ workEmail: null }, { workEmail: '' }] },
      select: { sourceId: true },
    });
    await overrideManager(manager.actor, caseId, routeTo.sourceId, 'Routing.');
    await expect(
      confirmAssignmentPlan(manager.actor, caseId, ['employee-identity']),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await confirmAssignmentPlan(manager.actor, caseId, [...CONFIRMATION_KEYS]);
    const plan = await getAssignmentPlan(manager.actor, caseId);
    expect(plan.confirmations.complete).toBe(true);
  });

  it('activation notifies the manager by email and gives them nothing to do', async () => {
    const caseId = await activeCase({ employeeSourceId: 'EMP-TEST-005' });

    // No participant: there is no login for that access to serve.
    const participant = await prisma.caseParticipant.findFirst({
      where: { caseId, participantRole: 'MANAGER', removedAt: null },
    });
    expect(participant).toBeNull();

    // No manager task on the active workflow.
    const managerTasks = await prisma.workflowTask.count({
      where: { caseId, department: 'LINE_MANAGER' },
    });
    expect(managerTasks).toBe(0);

    // Instead, the rules engine derived the departure notice.
    const notice = await prisma.caseRequiredAction.findFirst({
      where: { caseId, actionKey: 'EMAIL:MANAGER_DEPARTURE_NOTICE' },
    });
    expect(notice).not.toBeNull();
    expect(notice?.applicable).toBe(true);
  });
});

describe('work queue lifecycle - HR-operated under the v2 model (G/H/I; AM 20-27, Directive 6.3)', () => {
  it('claim: released + unassigned only; dueAt untouched; audited; retired logins see nothing (AM 20/21/24, AC 3-4)', async () => {
    const caseId = await activeCase({ employeeSourceId: 'EMP-TEST-001' });
    const t = await releasedHrTask(caseId);
    const dueBefore = t.dueAt?.toISOString() ?? null;
    // Retired department logins cannot even see the task (NOT_FOUND, no leak).
    await expect(claimTask(finA.actor, t.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(claimTask(itA.actor, t.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await claimTask(hrA.actor, t.id);
    const claimed = await prisma.workflowTask.findUniqueOrThrow({ where: { id: t.id } });
    expect(claimed.assigneeId).toBe(hrA.userId);
    expect(claimed.dueAt?.toISOString() ?? null).toBe(dueBefore);
    // Second claim refuses.
    await expect(claimTask(hrB.actor, t.id)).rejects.toMatchObject({ code: 'VALIDATION' });
    const audit = await prisma.auditEvent.findFirst({
      where: { caseId, eventType: 'TASK_CLAIMED', objectId: t.id },
    });
    expect(audit).not.toBeNull();
    // An unreleased task cannot be claimed.
    const notReady = await prisma.workflowTask.findFirstOrThrow({
      where: { caseId, department: 'HR', status: 'NOT_READY' },
    });
    await expect(claimTask(hrB.actor, notReady.id)).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('peer assignment works only for unassigned tasks; targets validated (AM 22)', async () => {
    const caseId = await activeCase({ employeeSourceId: 'EMP-TEST-002' });
    const t = await releasedHrTask(caseId);
    // A retired-role target is not a valid holder of HR work.
    await expect(assignTask(hrB.actor, t.id, finA.userId, 'wrong role')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await assignTask(hrB.actor, t.id, hrA.userId, 'Load balancing within HR.');
    const assigned = await prisma.auditEvent.findFirst({
      where: { caseId, eventType: 'TASK_ASSIGNED', objectId: t.id },
    });
    const meta = assigned!.metadata as Record<string, unknown>;
    expect(meta['previousAssigneeId']).toBeNull();
    expect(meta['newAssigneeId']).toBe(hrA.userId);
    // Already assigned -> peers must not assign again.
    await expect(assignTask(hrB.actor, t.id, hrB.userId, 'grab it')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('return-to-queue keeps history and the SLA clock (AM 23/24)', async () => {
    const caseId = await activeCase({ employeeSourceId: 'EMP-TEST-003' });
    const t = await releasedHrTask(caseId);
    await claimTask(hrA.actor, t.id);
    await startTask(hrA.actor, t.id);
    const started = await prisma.workflowTask.findUniqueOrThrow({ where: { id: t.id } });
    expect(started.status).toBe('IN_PROGRESS');
    const dueBefore = started.dueAt?.toISOString() ?? null;
    // Someone else cannot return it.
    await expect(returnTaskToQueue(hrB.actor, t.id, 'not mine')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await returnTaskToQueue(hrA.actor, t.id, 'Handing back before leave.');
    const returned = await prisma.workflowTask.findUniqueOrThrow({ where: { id: t.id } });
    expect(returned.assigneeId).toBeNull();
    expect(returned.status).toBe('READY');
    expect(returned.startedAt).not.toBeNull(); // history preserved
    expect(returned.dueAt?.toISOString() ?? null).toBe(dueBefore); // SLA never resets
    const audit = await prisma.auditEvent.findFirst({
      where: { caseId, eventType: 'TASK_RETURNED_TO_QUEUE', objectId: t.id },
    });
    const meta = audit!.metadata as Record<string, unknown>;
    expect(meta['previousAssigneeId']).toBe(hrA.userId);
    expect(meta['wasInProgress']).toBe(true);
  });

  it('reassignment records the former assignee and validates targets (AM 24)', async () => {
    const caseId = await activeCase({ employeeSourceId: 'EMP-TEST-004' });
    const t = await releasedHrTask(caseId);
    await claimTask(hrA.actor, t.id);
    await expect(
      reassignTask(manager.actor, t.id, finA.userId, 'retired role'),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const dueBefore = t.dueAt?.toISOString() ?? null;
    await reassignTask(manager.actor, t.id, hrB.userId, 'Primary officer unavailable.');
    const after = await prisma.workflowTask.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.assigneeId).toBe(hrB.userId);
    expect(after.dueAt?.toISOString() ?? null).toBe(dueBefore);
    const audit = await prisma.auditEvent.findFirst({
      where: { caseId, eventType: 'TASK_REASSIGNED', objectId: t.id },
      orderBy: { occurredAt: 'desc' },
    });
    const meta = audit!.metadata as Record<string, unknown>;
    expect(meta['previousAssigneeId']).toBe(hrA.userId);
    expect(meta['newAssigneeId']).toBe(hrB.userId);
  });

  it('completed evidence keeps the original actor (AM 25)', async () => {
    const caseId = await activeCase({ employeeSourceId: 'EMP-TEST-005' });
    const t = await releasedHrTask(caseId);
    await claimTask(hrA.actor, t.id);
    await startTask(hrA.actor, t.id);
    await completeTask(hrA.actor, t.id, 'Case details verified and archived.');
    const done = await prisma.workflowTask.findUniqueOrThrow({ where: { id: t.id } });
    expect(done.completedById).toBe(hrA.userId);
    // Closed tasks cannot be returned or reassigned away from the evidence.
    await expect(returnTaskToQueue(manager.actor, t.id, 'tidy up')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(
      (await prisma.workflowTask.findUniqueOrThrow({ where: { id: t.id } })).completedById,
    ).toBe(hrA.userId);
  });

  it('queue quick views and assignee names (G; AM 27)', async () => {
    const caseId = await activeCase({ employeeSourceId: 'EMP-TEST-010' });
    const t = await releasedHrTask(caseId);
    await claimTask(hrA.actor, t.id);
    const mine = await listMyQueue(hrA.actor, { view: 'myTasks' });
    expect(mine.rows.some((r) => r.id === t.id)).toBe(true);
    expect(mine.rows.find((r) => r.id === t.id)?.assigneeName).toBe('D61A HR One');
    const unassigned = await listMyQueue(hrB.actor, { view: 'unassigned' });
    expect(unassigned.rows.every((r) => r.assigneeId === null)).toBe(true);
    const critical = await listMyQueue(hrA.actor, { view: 'critical' });
    expect(critical.rows.every((r) => r.priority === 'CRITICAL' || r.status !== 'NOT_READY')).toBe(
      true,
    );
  });
});
