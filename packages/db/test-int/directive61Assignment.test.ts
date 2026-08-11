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
  getTask,
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
} from './helpers.ts';

const prisma = getPrisma();

let officer: Awaited<ReturnType<typeof createUser>>;
let manager: Awaited<ReturnType<typeof createUser>>;
let itA: Awaited<ReturnType<typeof createUser>>;
let itB: Awaited<ReturnType<typeof createUser>>;
let finA: Awaited<ReturnType<typeof createUser>>;
let lineMgr: Awaited<ReturnType<typeof createUser>>;
let lineMgr2: Awaited<ReturnType<typeof createUser>>;

const TEST_DRAFT = {
  ...VALID_DRAFT,
  recordPurpose: 'TEST',
  measurementCohort: null,
  confirmedLastDay: '2026-08-14T00:00:00.000Z',
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

async function releasedItTask(caseId: string) {
  const t = await prisma.workflowTask.findFirstOrThrow({
    where: { caseId, department: 'IT', status: 'READY' },
    orderBy: { sortOrder: 'asc' },
  });
  return t;
}

beforeAll(async () => {
  await resetDb();
  await seedStage3Fixtures();
  officer = await createUser('D61A Officer', 'HR_OFFICER');
  manager = await createUser('D61A Manager', 'HR_MANAGER');
  itA = await createUser('D61A IT One', 'IT_RESPONDER');
  itB = await createUser('D61A IT Two', 'IT_RESPONDER');
  finA = await createUser('D61A Finance', 'FINANCE_RESPONDER');
  lineMgr = await createUser('D61A Line Manager', 'LINE_MANAGER');
  lineMgr2 = await createUser('D61A Other Manager', 'LINE_MANAGER');
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
    // Managers do not resolve to app accounts in this DB -> MISSING MANAGER.
    await expect(activateCase(manager.actor, caseId)).rejects.toMatchObject({
      code: 'VALIDATION',
      details: [expect.stringContaining('MISSING MANAGER — ACTION REQUIRED')],
    });
    await overrideManager(manager.actor, caseId, lineMgr.userId, 'No account for the manager.');
    await expect(activateCase(manager.actor, caseId)).rejects.toMatchObject({
      code: 'VALIDATION',
      details: [expect.stringContaining('not confirmed')],
    });
    await confirmAssignmentPlan(manager.actor, caseId, [...CONFIRMATION_KEYS]);
    await activateCase(manager.actor, caseId);
  });

  it('override is HR-Manager-only, target-validated and audited before/after (AM 14)', async () => {
    const caseId = await approvedCase({ employeeSourceId: 'EMP-TEST-003' });
    await expect(
      overrideManager(officer.actor, caseId, lineMgr.userId, 'not my call'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      overrideManager(manager.actor, caseId, itA.userId, 'wrong role'),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await overrideManager(manager.actor, caseId, lineMgr2.userId, 'Manager on leave during UAT.');
    const e = await prisma.auditEvent.findFirst({
      where: { caseId, eventType: 'CASE_MANAGER_OVERRIDDEN' },
    });
    const meta = e!.metadata as Record<string, unknown>;
    expect(meta['originalManagerName']).toBe('Samira Cole');
    expect(meta['replacementUserId']).toBe(lineMgr2.userId);
    expect(meta['reason']).toBe('Manager on leave during UAT.');
    const c = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: caseId } });
    expect(c.managerSource).toBe('OVERRIDE');
  });

  it('confirmation is all-or-nothing (AM 15)', async () => {
    const caseId = await approvedCase({ employeeSourceId: 'EMP-TEST-004' });
    await assignOfficer(manager.actor, caseId, officer.userId, 'Test.');
    await overrideManager(manager.actor, caseId, lineMgr.userId, 'Routing.');
    await expect(
      confirmAssignmentPlan(manager.actor, caseId, ['employee-identity']),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await confirmAssignmentPlan(manager.actor, caseId, [...CONFIRMATION_KEYS]);
    const plan = await getAssignmentPlan(manager.actor, caseId);
    expect(plan.confirmations.complete).toBe(true);
  });

  it('activation auto-adds the MANAGER participant and routes manager tasks (AM 17)', async () => {
    const caseId = await activeCase({ employeeSourceId: 'EMP-TEST-005' });
    const participant = await prisma.caseParticipant.findFirst({
      where: { caseId, userId: lineMgr.userId, participantRole: 'MANAGER', removedAt: null },
    });
    expect(participant).not.toBeNull();
    const managerTasks = await prisma.workflowTask.findMany({
      where: { caseId, department: 'LINE_MANAGER' },
    });
    expect(managerTasks.length).toBeGreaterThan(0);
    expect(managerTasks.every((t) => t.assigneeId === lineMgr.userId)).toBe(true);
    const handover = await prisma.handoverRecord.findUniqueOrThrow({ where: { caseId } });
    expect(handover.managerId).toBe(lineMgr.userId);
  });
});

describe('department queue lifecycle (G/H/I; AM 20-27)', () => {
  it('claim: released + unassigned only; dueAt untouched; audited (AM 20/21/24)', async () => {
    const caseId = await activeCase({ employeeSourceId: 'EMP-TEST-001' });
    const t = await releasedItTask(caseId);
    const dueBefore = t.dueAt?.toISOString() ?? null;
    // Finance responder cannot even see the IT task (NOT_FOUND, no leak).
    await expect(claimTask(finA.actor, t.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await claimTask(itA.actor, t.id);
    const claimed = await prisma.workflowTask.findUniqueOrThrow({ where: { id: t.id } });
    expect(claimed.assigneeId).toBe(itA.userId);
    expect(claimed.dueAt?.toISOString() ?? null).toBe(dueBefore);
    // Second claim refuses.
    await expect(claimTask(itB.actor, t.id)).rejects.toMatchObject({ code: 'VALIDATION' });
    const audit = await prisma.auditEvent.findFirst({
      where: { caseId, eventType: 'TASK_CLAIMED', objectId: t.id },
    });
    expect(audit).not.toBeNull();
    // An unreleased task cannot be claimed (invisible to the department).
    const notReady = await prisma.workflowTask.findFirstOrThrow({
      where: { caseId, department: 'IT', status: 'NOT_READY' },
    });
    await expect(claimTask(itB.actor, notReady.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('peer assignment works only for unassigned tasks; targets validated (AM 22)', async () => {
    const caseId = await activeCase({ employeeSourceId: 'EMP-TEST-002' });
    const t = await releasedItTask(caseId);
    await expect(assignTask(itB.actor, t.id, finA.userId, 'wrong dept')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await assignTask(itB.actor, t.id, itA.userId, 'Load balancing within IT.');
    const assigned = await prisma.auditEvent.findFirst({
      where: { caseId, eventType: 'TASK_ASSIGNED', objectId: t.id },
    });
    const meta = assigned!.metadata as Record<string, unknown>;
    expect(meta['previousAssigneeId']).toBeNull();
    expect(meta['newAssigneeId']).toBe(itA.userId);
    // Already assigned -> peers must not assign again.
    await expect(assignTask(itB.actor, t.id, itB.userId, 'grab it')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('return-to-queue keeps history and the SLA clock (AM 23/24)', async () => {
    const caseId = await activeCase({ employeeSourceId: 'EMP-TEST-003' });
    const t = await releasedItTask(caseId);
    await claimTask(itA.actor, t.id);
    await startTask(itA.actor, t.id);
    const started = await prisma.workflowTask.findUniqueOrThrow({ where: { id: t.id } });
    expect(started.status).toBe('IN_PROGRESS');
    const dueBefore = started.dueAt?.toISOString() ?? null;
    // Someone else cannot return it.
    await expect(returnTaskToQueue(itB.actor, t.id, 'not mine')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await returnTaskToQueue(itA.actor, t.id, 'Wrong specialty for this system.');
    const returned = await prisma.workflowTask.findUniqueOrThrow({ where: { id: t.id } });
    expect(returned.assigneeId).toBeNull();
    expect(returned.status).toBe('READY');
    expect(returned.startedAt).not.toBeNull(); // history preserved
    expect(returned.dueAt?.toISOString() ?? null).toBe(dueBefore); // SLA never resets
    const audit = await prisma.auditEvent.findFirst({
      where: { caseId, eventType: 'TASK_RETURNED_TO_QUEUE', objectId: t.id },
    });
    const meta = audit!.metadata as Record<string, unknown>;
    expect(meta['previousAssigneeId']).toBe(itA.userId);
    expect(meta['wasInProgress']).toBe(true);
  });

  it('reassignment records the former assignee and validates targets (AM 24)', async () => {
    const caseId = await activeCase({ employeeSourceId: 'EMP-TEST-004' });
    const t = await releasedItTask(caseId);
    await claimTask(itA.actor, t.id);
    await expect(
      reassignTask(manager.actor, t.id, finA.userId, 'wrong department'),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    const dueBefore = t.dueAt?.toISOString() ?? null;
    await reassignTask(manager.actor, t.id, itB.userId, 'Primary responder unavailable.');
    const after = await prisma.workflowTask.findUniqueOrThrow({ where: { id: t.id } });
    expect(after.assigneeId).toBe(itB.userId);
    expect(after.dueAt?.toISOString() ?? null).toBe(dueBefore);
    const audit = await prisma.auditEvent.findFirst({
      where: { caseId, eventType: 'TASK_REASSIGNED', objectId: t.id },
      orderBy: { occurredAt: 'desc' },
    });
    const meta = audit!.metadata as Record<string, unknown>;
    expect(meta['previousAssigneeId']).toBe(itA.userId);
    expect(meta['newAssigneeId']).toBe(itB.userId);
  });

  it('completed evidence keeps the original actor (AM 25)', async () => {
    const caseId = await activeCase({ employeeSourceId: 'EMP-TEST-005' });
    const t = await releasedItTask(caseId);
    await claimTask(itA.actor, t.id);
    await startTask(itA.actor, t.id);
    await completeTask(itA.actor, t.id, 'Access list reviewed and archived.');
    const done = await prisma.workflowTask.findUniqueOrThrow({ where: { id: t.id } });
    expect(done.completedById).toBe(itA.userId);
    // Closed tasks cannot be returned or reassigned away from the evidence.
    await expect(returnTaskToQueue(manager.actor, t.id, 'tidy up')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(
      (await prisma.workflowTask.findUniqueOrThrow({ where: { id: t.id } })).completedById,
    ).toBe(itA.userId);
  });

  it('LINE_MANAGER access stays assignment-scoped (D; AM 26)', async () => {
    const caseId = await activeCase({ employeeSourceId: 'EMP-TEST-008' });
    const managerTask = await prisma.workflowTask.findFirstOrThrow({
      where: { caseId, department: 'LINE_MANAGER' },
    });
    // The routed manager sees the task; an unrelated manager gets NOT_FOUND.
    await expect(getTask(lineMgr2.actor, managerTask.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const queue2 = await listMyQueue(lineMgr2.actor, { view: 'all' });
    expect(queue2.rows.some((r) => r.id === managerTask.id)).toBe(false);
  });

  it('queue quick views and assignee names (G; AM 27)', async () => {
    const caseId = await activeCase({ employeeSourceId: 'EMP-TEST-010' });
    const t = await releasedItTask(caseId);
    await claimTask(itA.actor, t.id);
    const mine = await listMyQueue(itA.actor, { view: 'myTasks' });
    expect(mine.rows.some((r) => r.id === t.id)).toBe(true);
    expect(mine.rows.find((r) => r.id === t.id)?.assigneeName).toBe('D61A IT One');
    const unassigned = await listMyQueue(itB.actor, { view: 'unassigned' });
    expect(unassigned.rows.every((r) => r.assigneeId === null)).toBe(true);
    const critical = await listMyQueue(itA.actor, { view: 'critical' });
    expect(critical.rows.every((r) => r.priority === 'CRITICAL' || r.status !== 'NOT_READY')).toBe(
      true,
    );
  });
});
