/**
 * Task engine actions and department work queues (Directive 3 sections D, I, J).
 *
 * Authorization model:
 *  - HR roles act on HR tasks of cases they can see (restricted cases need
 *    explicit participation);
 *  - IT_RESPONDER / FINANCE_RESPONDER act on released tasks of their
 *    department with MINIMUM task data - a task never grants case access;
 *  - LINE_MANAGER only ever sees tasks expressly assigned to them (H.6);
 *  - SYSTEM_ADMIN sees no queue and no task (R.8);
 *  - restricted cases stay undiscoverable: unauthorized access -> NOT_FOUND.
 */
import {
  can,
  canActOnCase,
  canViewCase,
  credentialFieldErrors,
  hasRole,
  lateMinutes,
  queueDepartmentsForActor,
  taskTransitionError,
  OPEN_TASK_STATUSES,
  type Actor,
  type AuditEventType,
  type CaseAccessContext,
  type TaskAction,
  type TaskDepartment,
} from '@exit/domain';
import { z } from 'zod';
import { getPrisma } from '../client.ts';
import type { Prisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, auditDenied, newCorrelationId } from './auditService.ts';
import { autoResolveException, openException } from './exceptionService.ts';
import { recalcInstanceCounts, releaseEligibleTasks } from './workflowService.ts';

// --- shared loading and authorization ----------------------------------------

async function loadTask(taskId: string) {
  const t = await getPrisma().workflowTask.findUnique({
    where: { id: taskId },
    include: {
      instance: { select: { id: true, status: true, definitionVersion: true } },
      case: {
        select: {
          id: true,
          caseNumber: true,
          status: true,
          classification: true,
          ownerId: true,
          departureType: true,
          employeeDisplayName: true,
          effectiveSeparationAt: true,
          participants: {
            where: { removedAt: null },
            select: { userId: true, participantRole: true },
          },
        },
      },
    },
  });
  if (!t) throw ServiceError.notFound();
  const ctx: CaseAccessContext = {
    ownerId: t.case.ownerId,
    classification: t.case.classification,
    participantUserIds: t.case.participants.map((p) => p.userId),
  };
  return { t, ctx };
}

type TaskAccess = 'HR_FULL' | 'DEPARTMENT' | 'NONE';

/**
 * D.3 / J.1-J.4: who may see/act on a task. Department users get access to
 * RELEASED tasks only (NOT_READY tasks would disclose work prematurely - H.8).
 */
function taskAccessFor(
  actor: Actor,
  t: Awaited<ReturnType<typeof loadTask>>['t'],
  ctx: CaseAccessContext,
): TaskAccess {
  if (canViewCase(actor, ctx) && hasRole(actor, 'HR_MANAGER', 'HR_OFFICER')) return 'HR_FULL';
  // Read-only oversight sees tasks through the case view, not the queue.
  if (canViewCase(actor, ctx) && hasRole(actor, 'AUDITOR', 'PRIVACY_OFFICER')) return 'HR_FULL';
  const released = t.status !== 'NOT_READY';
  if (!released) return 'NONE';
  if (t.department === 'IT' && hasRole(actor, 'IT_RESPONDER')) return 'DEPARTMENT';
  if (t.department === 'FINANCE' && hasRole(actor, 'FINANCE_RESPONDER')) return 'DEPARTMENT';
  if (
    t.department === 'LINE_MANAGER' &&
    hasRole(actor, 'LINE_MANAGER') &&
    t.assigneeId === actor.userId
  )
    return 'DEPARTMENT';
  return 'NONE';
}

/** May the actor perform WORK on the task (not just read it)? */
function canWorkOnTask(
  actor: Actor,
  t: Awaited<ReturnType<typeof loadTask>>['t'],
  ctx: CaseAccessContext,
): boolean {
  switch (t.department) {
    case 'HR':
      // HR-Manager-only obligations (final approvals) exclude officers.
      if (t.requiredRole === 'HR_MANAGER' && !hasRole(actor, 'HR_MANAGER')) return false;
      return (
        hasRole(actor, 'HR_MANAGER', 'HR_OFFICER') &&
        canViewCase(actor, ctx) &&
        canActOnCase(actor, 'workflow.view', ctx)
      );
    case 'IT':
      return hasRole(actor, 'IT_RESPONDER');
    case 'FINANCE':
      return hasRole(actor, 'FINANCE_RESPONDER');
    case 'LINE_MANAGER':
      return hasRole(actor, 'LINE_MANAGER') && t.assigneeId === actor.userId;
  }
}

/** Minimum-data DTO for department users (J.3 / H.4-H.6 / R.1). */
function taskDto(t: Awaited<ReturnType<typeof loadTask>>['t'], access: TaskAccess) {
  const base = {
    id: t.id,
    taskCode: t.taskCode,
    title: t.title,
    description: t.description,
    department: t.department,
    requiredRole: t.requiredRole,
    status: t.status,
    priority: t.priority,
    taskKind: t.taskKind,
    confidential: t.confidential,
    required: t.required,
    waiverAllowed: t.waiverAllowed,
    assigneeId: t.assigneeId,
    releaseAt: t.releaseAt,
    dueAt: t.dueAt,
    originalDueAt: t.originalDueAt,
    dueRule: t.dueRule,
    dueRecalcReason: t.dueRecalcReason,
    startedAt: t.startedAt,
    blockedAt: t.blockedAt,
    blockedReason: t.blockedReason,
    blockerOwner: t.blockerOwner,
    completedAt: t.completedAt,
    completionNote: t.completionNote,
    lateMinutes: t.lateMinutes,
    waivedAt: t.waivedAt,
    waiverReason: t.waiverReason,
    evidenceKind: t.evidenceKind,
    evidenceAttachmentId: t.evidenceAttachmentId,
    escalationLevel: t.escalationLevel,
    accessSystems: t.accessSystems,
    accessSystemsCompleted: t.accessSystemsCompleted,
    accessSystemsUnresolved: t.accessSystemsUnresolved,
    accessResult: t.accessResult,
    earlyCompletionReason: t.earlyCompletionReason,
    incidentRef: t.incidentRef,
    // The minimum case/employee reference needed to perform the work.
    caseNumber: t.case.caseNumber,
    employeeDisplayName: t.case.employeeDisplayName,
    effectiveSeparationAt: t.taskKind === 'ACCESS_REVOCATION' ? t.case.effectiveSeparationAt : null,
    dependsOnCodes: t.dependsOnCodes,
  };
  if (access === 'HR_FULL') {
    return {
      ...base,
      caseId: t.case.id,
      departureType: t.case.departureType, // "where authorized" (J)
      instanceStatus: t.instance.status,
    };
  }
  // Department view: no case link, no departure type, no case content.
  return { ...base, caseId: null, departureType: null, instanceStatus: null };
}

export async function getTask(actor: Actor, taskId: string) {
  const { t, ctx } = await loadTask(taskId);
  const access = taskAccessFor(actor, t, ctx);
  if (access === 'NONE') {
    await auditDenied(actor, 'ACCESS_DENIED', 'WorkflowTask', taskId);
    throw ServiceError.notFound(); // no existence leak (J.4/J.5)
  }
  return {
    task: taskDto(t, access),
    access,
    /** Computed server-side so page render stays pure. */
    overdue:
      t.dueAt !== null &&
      t.dueAt.getTime() < Date.now() &&
      ['READY', 'IN_PROGRESS', 'BLOCKED'].includes(t.status),
    canWork: canWorkOnTask(actor, t, ctx),
    canWaive:
      canActOnCase(actor, 'task.hrManage', ctx) &&
      t.waiverAllowed &&
      t.taskKind !== 'ACCESS_REVOCATION',
    canReassign: canActOnCase(actor, 'task.hrManage', ctx),
    canCorrect: canActOnCase(actor, 'task.correct', ctx) && t.status === 'COMPLETED',
    // Directive 6.1 (G/H): queue lifecycle capabilities.
    canClaim:
      canWorkOnTask(actor, t, ctx) &&
      t.assigneeId === null &&
      t.status === 'READY' &&
      t.department !== 'LINE_MANAGER',
    canAssign:
      (canActOnCase(actor, 'task.hrManage', ctx) || canWorkOnTask(actor, t, ctx)) &&
      t.assigneeId === null &&
      ['READY', 'IN_PROGRESS', 'BLOCKED'].includes(t.status),
    canReturn:
      (canActOnCase(actor, 'task.hrManage', ctx) || t.assigneeId === actor.userId) &&
      t.assigneeId !== null &&
      ['READY', 'IN_PROGRESS', 'BLOCKED'].includes(t.status),
    assigneeName: t.assigneeId
      ? ((
          await getPrisma().user.findUnique({
            where: { id: t.assigneeId },
            select: { displayName: true },
          })
        )?.displayName ?? null)
      : null,
  };
}

// --- task actions (section D) ------------------------------------------------

const noteSchema = z.string().trim().max(2000).optional();

async function transition(
  actor: Actor,
  taskId: string,
  action: TaskAction,
  fields: {
    reason?: string;
    note?: string;
    blockerOwner?: string;
    assigneeId?: string;
    evidenceAttachmentId?: string;
  } = {},
) {
  const { t, ctx } = await loadTask(taskId);
  const access = taskAccessFor(actor, t, ctx);
  if (access === 'NONE') throw ServiceError.notFound();

  // Authority per action.
  const hrManage = canActOnCase(actor, 'task.hrManage', ctx);
  if (action === 'waive' || action === 'reassign' || action === 'cancel') {
    if (!hrManage) throw ServiceError.forbidden();
  } else if (!canWorkOnTask(actor, t, ctx)) {
    throw ServiceError.forbidden();
  }
  if (!['ACTIVE', 'CLEARANCE_PENDING'].includes(t.instance.status))
    throw ServiceError.conflict('The workflow is not active.');

  const transitionErr = taskTransitionError(action, t, actor, fields.reason);
  if (transitionErr) throw ServiceError.validation([transitionErr]);

  // D.14/D.15: task comments carry safe operational information only.
  const credErrors = credentialFieldErrors({
    'Completion note': fields.note,
    'Blocker reason': fields.reason,
  });
  if (credErrors.length) throw ServiceError.validation(credErrors);

  // Directive 6.1 (G/M): reassignment validates the target and records who
  // had the work before - the audit answers who-had/who-has/why/when.
  let assignmentMeta: Record<string, unknown> = {};
  if (action === 'reassign') {
    const target = await validateAssignmentTarget(t.department, fields.assigneeId ?? '');
    const prisma = getPrisma();
    const prev = t.assigneeId
      ? await prisma.user.findUnique({
          where: { id: t.assigneeId },
          select: { displayName: true },
        })
      : null;
    assignmentMeta = {
      previousAssigneeId: t.assigneeId,
      previousAssigneeName: prev?.displayName ?? null,
      newAssigneeId: target.id,
      newAssigneeName: target.displayName,
      dueAt: t.dueAt,
    };
  }

  const now = new Date();
  const correlationId = newCorrelationId();
  const data: Record<string, unknown> = { rowVersion: { increment: 1 } };
  let eventType: AuditEventType = 'TASK_STARTED';
  switch (action) {
    case 'start':
      Object.assign(data, { status: 'IN_PROGRESS', startedAt: now, startedById: actor.userId });
      eventType = 'TASK_STARTED';
      break;
    case 'complete': {
      if (t.taskKind === 'ACCESS_REVOCATION')
        throw ServiceError.validation([
          'Access-revocation tasks are completed through the access-revocation form.',
        ]);
      if (t.evidenceKind === 'NOTE' && !fields.note?.trim())
        throw ServiceError.validation(['A completion note is required as evidence for this task.']);
      if (t.evidenceKind === 'ATTACHMENT' && !fields.evidenceAttachmentId && !fields.note?.trim())
        throw ServiceError.validation([
          'Attach evidence (or record a note explaining where it is held).',
        ]);
      Object.assign(data, {
        status: 'COMPLETED',
        completedAt: now,
        completedById: actor.userId,
        completionNote: fields.note ?? null,
        evidenceAttachmentId: fields.evidenceAttachmentId ?? null,
        lateMinutes: lateMinutes(t.dueAt, now),
      });
      eventType = 'TASK_COMPLETED';
      break;
    }
    case 'block':
      Object.assign(data, {
        status: 'BLOCKED',
        blockedAt: now,
        blockedReason: fields.reason,
        blockerOwner: fields.blockerOwner?.slice(0, 200) ?? null,
      });
      eventType = 'TASK_BLOCKED';
      break;
    case 'unblock': {
      Object.assign(data, { status: 'IN_PROGRESS', blockedAt: null });
      // D.7: SLA pause while blocked only where the definition says so.
      if (t.blockPausesSla && t.blockedAt && t.dueAt) {
        const pausedMs = now.getTime() - t.blockedAt.getTime();
        Object.assign(data, {
          dueAt: new Date(t.dueAt.getTime() + pausedMs),
          dueRecalcReason: `SLA paused ${Math.round(pausedMs / 60_000)} minute(s) while blocked`,
          dueCalculatedAt: now,
        });
      }
      eventType = 'TASK_UNBLOCKED';
      break;
    }
    case 'waive':
      Object.assign(data, {
        status: 'WAIVED',
        waivedAt: now,
        waivedById: actor.userId,
        waiverReason: fields.reason,
      });
      eventType = 'TASK_WAIVED';
      break;
    case 'reassign':
      Object.assign(data, { assigneeId: fields.assigneeId ?? null });
      eventType = 'TASK_REASSIGNED';
      break;
    case 'cancel':
      Object.assign(data, { status: 'CANCELLED', cancelledAt: now, cancelReason: fields.reason });
      eventType = 'TASK_CANCELLED';
      break;
  }

  await getPrisma().$transaction(async (tx) => {
    const updated = await tx.workflowTask.updateMany({
      where: { id: taskId, rowVersion: t.rowVersion, status: t.status },
      data,
    });
    if (updated.count === 0)
      throw ServiceError.conflict('The task was changed by someone else; reload and retry.');
    await appendAudit(tx, {
      eventType,
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'WorkflowTask',
      objectId: taskId,
      caseId: t.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        taskCode: t.taskCode,
        action,
        reason: fields.reason ?? null,
        assigneeId: fields.assigneeId ?? null,
        ...assignmentMeta,
      },
    });
  });

  // Ripples: dependency release, counters, exception hygiene.
  if (action === 'complete' || action === 'waive') {
    await releaseEligibleTasks(t.caseId, now);
    await autoResolveException(
      t.caseId,
      t.taskKind === 'ACCESS_REVOCATION' ? 'CRITICAL_ACCESS_OVERDUE' : 'TASK_OVERDUE',
      t.id,
      `Task ${action === 'waive' ? 'waived' : 'completed'}.`,
    );
    await autoResolveException(t.caseId, 'TASK_BLOCKED', t.id, 'Task resolved.');
  }
  if (action === 'unblock') {
    await autoResolveException(t.caseId, 'TASK_BLOCKED', t.id, 'Blocker cleared.');
  }
  if (action === 'block') {
    await openException(t.caseId, {
      exceptionType: 'TASK_BLOCKED',
      severity: t.taskKind === 'ACCESS_REVOCATION' ? 'CRITICAL' : 'INFO',
      title: `Task blocked: ${t.title}`,
      detail: fields.reason,
      refType: 'WorkflowTask',
      refId: t.id,
      ownerDepartment: t.department as TaskDepartment,
    });
  }
  await recalcInstanceCounts(t.instanceId, now);
}

export const startTask = (actor: Actor, taskId: string) => transition(actor, taskId, 'start');
export const completeTask = (
  actor: Actor,
  taskId: string,
  note?: string,
  evidenceAttachmentId?: string,
) => {
  const parsed = noteSchema.safeParse(note);
  if (!parsed.success) throw ServiceError.validation(['Note is limited to 2000 characters.']);
  return transition(actor, taskId, 'complete', { note: parsed.data, evidenceAttachmentId });
};
export const blockTask = (actor: Actor, taskId: string, reason: string, blockerOwner?: string) =>
  transition(actor, taskId, 'block', { reason, blockerOwner });
export const unblockTask = (actor: Actor, taskId: string) => transition(actor, taskId, 'unblock');
export const waiveTask = (actor: Actor, taskId: string, reason: string) =>
  transition(actor, taskId, 'waive', { reason });
export const reassignTask = (actor: Actor, taskId: string, assigneeId: string, reason: string) =>
  transition(actor, taskId, 'reassign', { assigneeId, reason });

// --- Directive 6.1 (G/H/I): department-queue claim / assign / return ---------

/** Roles allowed to hold work in each department (generic routing model). */
const DEPARTMENT_ASSIGNEE_ROLES: Record<TaskDepartment, readonly string[]> = {
  HR: ['HR_OFFICER', 'HR_MANAGER'],
  IT: ['IT_RESPONDER'],
  FINANCE: ['FINANCE_RESPONDER'],
  LINE_MANAGER: ['LINE_MANAGER'],
};

async function validateAssignmentTarget(department: TaskDepartment, userId: string) {
  if (!userId) throw ServiceError.validation(['Select the person to assign.']);
  const target = await getPrisma().user.findUnique({
    where: { id: userId },
    include: { roleAssignments: { where: { revokedAt: null }, select: { role: true } } },
  });
  if (!target || !target.isActive)
    throw ServiceError.validation(['The selected user does not exist or is inactive.']);
  const allowed = DEPARTMENT_ASSIGNEE_ROLES[department];
  if (!target.roleAssignments.some((r) => allowed.includes(r.role as string)))
    throw ServiceError.validation([
      `The assignee must hold a ${department} responder role (${allowed.join(' or ')}).`,
    ]);
  return { id: target.id, displayName: target.displayName };
}

/**
 * G: a department responder claims an UNASSIGNED, released task from the
 * queue. SLA/due dates never change; the exact revocation deadline stands.
 */
export async function claimTask(actor: Actor, taskId: string): Promise<void> {
  const { t, ctx } = await loadTask(taskId);
  const access = taskAccessFor(actor, t, ctx);
  if (access === 'NONE') {
    await auditDenied(actor, 'ACCESS_DENIED', 'WorkflowTask', taskId);
    throw ServiceError.notFound();
  }
  if (!canWorkOnTask(actor, t, ctx)) throw ServiceError.forbidden();
  if (t.assigneeId)
    throw ServiceError.validation([
      'The task is already assigned; ask for a reassignment or a return to the queue.',
    ]);
  if (t.status !== 'READY')
    throw ServiceError.validation(['Only released, not-yet-started tasks can be claimed.']);
  if (!['ACTIVE', 'CLEARANCE_PENDING'].includes(t.instance.status))
    throw ServiceError.conflict('The workflow is not active.');
  const prisma = getPrisma();
  const me = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: { displayName: true },
  });
  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    const updated = await tx.workflowTask.updateMany({
      where: { id: taskId, rowVersion: t.rowVersion, status: t.status, assigneeId: null },
      data: { assigneeId: actor.userId, rowVersion: { increment: 1 } },
    });
    if (updated.count === 0)
      throw ServiceError.conflict('The task was claimed by someone else; refresh the queue.');
    await appendAudit(tx, {
      eventType: 'TASK_CLAIMED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'WorkflowTask',
      objectId: taskId,
      caseId: t.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        taskCode: t.taskCode,
        newAssigneeId: actor.userId,
        newAssigneeName: me?.displayName ?? null,
        dueAt: t.dueAt,
      },
    });
  });
}

/**
 * G/H: assign an UNASSIGNED task to a named responder. The HR Manager may
 * assign any open task; a department responder may distribute unassigned
 * work within their own department.
 */
export async function assignTask(
  actor: Actor,
  taskId: string,
  assigneeUserId: string,
  reason: string,
): Promise<void> {
  const { t, ctx } = await loadTask(taskId);
  const access = taskAccessFor(actor, t, ctx);
  if (access === 'NONE') {
    await auditDenied(actor, 'ACCESS_DENIED', 'WorkflowTask', taskId);
    throw ServiceError.notFound();
  }
  const hrManage = canActOnCase(actor, 'task.hrManage', ctx);
  if (!hrManage && !canWorkOnTask(actor, t, ctx)) throw ServiceError.forbidden();
  if (!reason.trim()) throw ServiceError.validation(['A reason is required (audited).']);
  if (t.assigneeId)
    throw ServiceError.validation(['The task is already assigned; use reassignment instead.']);
  if (!['READY', 'IN_PROGRESS', 'BLOCKED'].includes(t.status))
    throw ServiceError.validation(['Only open tasks can be assigned.']);
  if (!['ACTIVE', 'CLEARANCE_PENDING'].includes(t.instance.status))
    throw ServiceError.conflict('The workflow is not active.');
  const target = await validateAssignmentTarget(t.department, assigneeUserId);
  const correlationId = newCorrelationId();
  await getPrisma().$transaction(async (tx) => {
    const updated = await tx.workflowTask.updateMany({
      where: { id: taskId, rowVersion: t.rowVersion, status: t.status, assigneeId: null },
      data: { assigneeId: target.id, rowVersion: { increment: 1 } },
    });
    if (updated.count === 0)
      throw ServiceError.conflict('The task was changed by someone else; reload and retry.');
    await appendAudit(tx, {
      eventType: 'TASK_ASSIGNED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'WorkflowTask',
      objectId: taskId,
      caseId: t.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        taskCode: t.taskCode,
        previousAssigneeId: null,
        newAssigneeId: target.id,
        newAssigneeName: target.displayName,
        reason,
        dueAt: t.dueAt,
      },
    });
  });
}

/**
 * G: the current assignee (or the HR Manager) returns a task to its
 * department queue. Work history is preserved; the SLA clock never resets.
 */
export async function returnTaskToQueue(
  actor: Actor,
  taskId: string,
  reason: string,
): Promise<void> {
  const { t, ctx } = await loadTask(taskId);
  const access = taskAccessFor(actor, t, ctx);
  if (access === 'NONE') {
    await auditDenied(actor, 'ACCESS_DENIED', 'WorkflowTask', taskId);
    throw ServiceError.notFound();
  }
  const hrManage = canActOnCase(actor, 'task.hrManage', ctx);
  if (!hrManage && t.assigneeId !== actor.userId) throw ServiceError.forbidden();
  if (!reason.trim()) throw ServiceError.validation(['A reason is required (audited).']);
  if (!t.assigneeId) throw ServiceError.validation(['The task is not assigned to anyone.']);
  if (!['READY', 'IN_PROGRESS', 'BLOCKED'].includes(t.status))
    throw ServiceError.validation(['Only open tasks can be returned to the queue.']);
  const credErrors = credentialFieldErrors({ 'Return reason': reason });
  if (credErrors.length) throw ServiceError.validation(credErrors);
  const prisma = getPrisma();
  const prev = await prisma.user.findUnique({
    where: { id: t.assigneeId },
    select: { displayName: true },
  });
  const wasInProgress = t.status === 'IN_PROGRESS';
  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    const updated = await tx.workflowTask.updateMany({
      where: { id: taskId, rowVersion: t.rowVersion, status: t.status },
      data: {
        assigneeId: null,
        // Not progressing while unowned; startedAt/startedById stay as history.
        ...(wasInProgress ? { status: 'READY' } : {}),
        rowVersion: { increment: 1 },
      },
    });
    if (updated.count === 0)
      throw ServiceError.conflict('The task was changed by someone else; reload and retry.');
    await appendAudit(tx, {
      eventType: 'TASK_RETURNED_TO_QUEUE',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'WorkflowTask',
      objectId: taskId,
      caseId: t.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        taskCode: t.taskCode,
        previousAssigneeId: t.assigneeId,
        previousAssigneeName: prev?.displayName ?? null,
        reason,
        dueAt: t.dueAt,
        wasInProgress,
      },
    });
  });
}

/** D.12/D.13: authorized correction of a completed task - append-only record. */
export async function correctCompletedTask(
  actor: Actor,
  taskId: string,
  input: {
    field: 'completionNote' | 'evidenceAttachmentId';
    correctedValue: string;
    reason: string;
    clearanceEffect?: string;
  },
) {
  const { t, ctx } = await loadTask(taskId);
  if (taskAccessFor(actor, t, ctx) === 'NONE') throw ServiceError.notFound();
  if (!canActOnCase(actor, 'task.correct', ctx)) throw ServiceError.forbidden();
  if (t.status !== 'COMPLETED')
    throw ServiceError.conflict('Only completed tasks can be corrected.');
  if (!input.reason.trim()) throw ServiceError.validation(['A correction reason is required.']);
  const credErrors = credentialFieldErrors({ 'Corrected value': input.correctedValue });
  if (credErrors.length) throw ServiceError.validation(credErrors);

  const originalValue =
    input.field === 'completionNote' ? t.completionNote : t.evidenceAttachmentId;
  const correlationId = newCorrelationId();
  await getPrisma().$transaction(async (tx) => {
    await tx.taskCorrection.create({
      data: {
        taskId,
        field: input.field,
        originalValue: originalValue ?? null,
        correctedValue: input.correctedValue,
        reason: input.reason,
        clearanceEffect: input.clearanceEffect ?? 'No effect on clearance readiness.',
        actorId: actor.userId,
      },
    });
    await tx.workflowTask.updateMany({
      where: { id: taskId, status: 'COMPLETED', rowVersion: t.rowVersion },
      data: { [input.field]: input.correctedValue, rowVersion: { increment: 1 } },
    });
    await appendAudit(tx, {
      eventType: 'TASK_CORRECTED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'WorkflowTask',
      objectId: taskId,
      caseId: t.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { taskCode: t.taskCode, field: input.field, reason: input.reason },
    });
  });
}

// --- exact-time access revocation (section I) --------------------------------

export const accessCompletionSchema = z.object({
  systemsCompleted: z.array(z.string().trim().min(1).max(120)).default([]),
  systemsUnresolved: z.array(z.string().trim().min(1).max(120)).default([]),
  note: z.string().trim().min(1).max(2000),
  earlyCompletionReason: z.string().trim().max(500).optional(),
  incidentRef: z.string().trim().max(120).optional(),
});

export async function updateAccessSystems(actor: Actor, taskId: string, systems: string[]) {
  const { t, ctx } = await loadTask(taskId);
  if (taskAccessFor(actor, t, ctx) === 'NONE') throw ServiceError.notFound();
  if (!canWorkOnTask(actor, t, ctx)) throw ServiceError.forbidden();
  if (t.taskKind !== 'ACCESS_REVOCATION')
    throw ServiceError.validation(['Not an access-revocation task.']);
  if (!OPEN_TASK_STATUSES.includes(t.status))
    throw ServiceError.conflict('The task is no longer open.');
  const clean = systems.map((s) => s.trim()).filter((s) => s.length > 0 && s.length <= 120);
  if (clean.length === 0) throw ServiceError.validation(['At least one system is required.']);
  const credErrors = credentialFieldErrors({ Systems: clean.join('; ') });
  if (credErrors.length) throw ServiceError.validation(credErrors);

  await getPrisma().$transaction(async (tx) => {
    const updated = await tx.workflowTask.updateMany({
      where: { id: taskId, rowVersion: t.rowVersion },
      data: { accessSystems: clean, rowVersion: { increment: 1 } },
    });
    if (updated.count === 0) throw ServiceError.conflict('The task changed; reload and retry.');
    await appendAudit(tx, {
      eventType: 'ACCESS_SYSTEMS_UPDATED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'WorkflowTask',
      objectId: taskId,
      caseId: t.caseId,
      result: 'SUCCESS',
      correlationId: newCorrelationId(),
      metadata: { taskCode: t.taskCode, systemCount: clean.length },
    });
  });
}

/**
 * I.3-I.10: record manual completion evidence. Early completion needs a
 * reason; lateness is measured and stored; unresolved systems keep the task
 * incomplete (BLOCKED) with a CRITICAL exception - clearance stays blocked
 * unless HR_MANAGER approves a security exception.
 */
export async function completeAccessTask(actor: Actor, taskId: string, rawInput: unknown) {
  const parsed = accessCompletionSchema.safeParse(rawInput);
  if (!parsed.success)
    throw ServiceError.validation(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  const input = parsed.data;

  const { t, ctx } = await loadTask(taskId);
  if (taskAccessFor(actor, t, ctx) === 'NONE') throw ServiceError.notFound();
  if (!canWorkOnTask(actor, t, ctx)) throw ServiceError.forbidden();
  if (t.taskKind !== 'ACCESS_REVOCATION')
    throw ServiceError.validation(['Not an access-revocation task.']);
  if (!OPEN_TASK_STATUSES.includes(t.status) || t.status === 'NOT_READY')
    throw ServiceError.conflict('The task is not open for completion.');

  const credErrors = credentialFieldErrors({
    'Completion note': input.note,
    Systems: [...input.systemsCompleted, ...input.systemsUnresolved].join('; '),
  });
  if (credErrors.length) throw ServiceError.validation(credErrors);

  const now = new Date();
  const due = t.dueAt;
  const early = due !== null && now.getTime() < due.getTime();
  if (early && !input.earlyCompletionReason?.trim())
    throw ServiceError.validation([
      'Completing access revocation BEFORE the effective time requires a recorded authorized reason (I.3).',
    ]);
  const unresolved = input.systemsUnresolved;
  const fullyDone = unresolved.length === 0;
  const delay = lateMinutes(due, now);
  const result = fullyDone
    ? early
      ? 'COMPLETED_EARLY'
      : (delay ?? 0) > 0
        ? 'COMPLETED_LATE'
        : 'COMPLETED_ON_TIME'
    : 'PARTIAL';

  const correlationId = newCorrelationId();
  await getPrisma().$transaction(async (tx) => {
    const updated = await tx.workflowTask.updateMany({
      where: { id: taskId, rowVersion: t.rowVersion },
      data: {
        status: fullyDone ? 'COMPLETED' : 'BLOCKED',
        ...(fullyDone
          ? { completedAt: now, completedById: actor.userId, lateMinutes: delay }
          : {
              blockedAt: now,
              blockedReason: `Systems not yet removed: ${unresolved.join('; ')}`,
              blockerOwner: 'IT',
            }),
        completionNote: input.note,
        accessSystemsCompleted: input.systemsCompleted,
        accessSystemsUnresolved: unresolved,
        accessResult: result,
        earlyCompletionReason: input.earlyCompletionReason ?? null,
        incidentRef: input.incidentRef ?? null,
        rowVersion: { increment: 1 },
      },
    });
    if (updated.count === 0) throw ServiceError.conflict('The task changed; reload and retry.');
    await appendAudit(tx, {
      eventType: fullyDone ? 'ACCESS_REVOCATION_COMPLETED' : 'ACCESS_REVOCATION_PARTIAL',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'WorkflowTask',
      objectId: taskId,
      caseId: t.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        taskCode: t.taskCode,
        accessResult: result,
        lateMinutes: delay ?? 0,
        unresolvedCount: unresolved.length,
        incidentRef: input.incidentRef ?? null,
      },
    });
  });

  if (fullyDone) {
    await autoResolveException(
      t.caseId,
      'CRITICAL_ACCESS_OVERDUE',
      t.id,
      `Access revocation completed (${result}, delay ${delay ?? 0} min).`,
    );
    await autoResolveException(t.caseId, 'TASK_BLOCKED', t.id, 'Access revocation completed.');
    await releaseEligibleTasks(t.caseId, now);
  } else {
    // I.10: blocker + incident/exception; clearance remains blocked.
    await openException(t.caseId, {
      exceptionType: 'TASK_BLOCKED',
      severity: 'CRITICAL',
      title: `Access revocation incomplete: ${unresolved.length} system(s) unresolved`,
      detail: `Unresolved: ${unresolved.join('; ')}${input.incidentRef ? ` (incident ${input.incidentRef})` : ''}`,
      refType: 'WorkflowTask',
      refId: t.id,
      ownerDepartment: 'IT',
    });
  }
  await recalcInstanceCounts(t.instanceId, now);
  return { result, lateMinutes: delay };
}

// --- department work queues (section J) --------------------------------------

export const queueFilterSchema = z.object({
  department: z.enum(['HR', 'IT', 'FINANCE', 'LINE_MANAGER']).optional(),
  view: z
    .enum([
      'ready',
      'inProgress',
      'blocked',
      'dueToday',
      'dueThisWeek',
      'overdue',
      'criticalOverdue',
      'completed',
      'reassigned',
      'waived',
      'assignedToMe',
      'unassigned',
      'all',
      // Directive 6.1 (G): quick views - myTasks aliases assignedToMe;
      // critical covers CRITICAL priority or escalated open work.
      'myTasks',
      'critical',
    ])
    .default('all'),
  departureType: z
    .enum(['RESIGNATION_WITH_NOTICE', 'IMMEDIATE_RESIGNATION', 'TERMINATION'])
    .optional(),
  location: z.string().trim().max(100).optional(),
  q: z.string().trim().max(100).optional(),
});
export type QueueFilter = z.infer<typeof queueFilterSchema>;

export async function listMyQueue(actor: Actor, rawFilter: unknown = {}) {
  if (!can(actor, 'queue.view')) throw ServiceError.forbidden();
  const parsed = queueFilterSchema.safeParse(rawFilter);
  if (!parsed.success) throw ServiceError.validation(['Invalid queue filter.']);
  const f = parsed.data;

  const departments = queueDepartmentsForActor(actor);
  if (departments.length === 0) return { departments: [], rows: [] };
  const selected =
    f.department && departments.includes(f.department) ? [f.department] : departments;

  const isHr = hasRole(actor, 'HR_MANAGER', 'HR_OFFICER');
  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const endOfWeek = new Date(now.getTime() + 7 * 86_400_000);

  // Per-department authorization shaping (J.1/J.2, H.4-H.6, R.8).
  const deptClauses = selected.map((d) => {
    if (d === 'HR') {
      return {
        department: 'HR' as const,
        case: {
          is: {
            OR: [
              { classification: 'CONFIDENTIAL' as const },
              { participants: { some: { userId: actor.userId, removedAt: null } } },
              { ownerId: actor.userId },
            ],
          },
        },
      };
    }
    if (d === 'LINE_MANAGER')
      return { department: 'LINE_MANAGER' as const, assigneeId: actor.userId };
    return { department: d };
  });

  const statusFilter: Prisma.WorkflowTaskWhereInput = (() => {
    switch (f.view) {
      case 'ready':
        return { status: 'READY' as const };
      case 'inProgress':
        return { status: 'IN_PROGRESS' as const };
      case 'blocked':
        return { status: 'BLOCKED' as const };
      case 'completed':
        return { status: 'COMPLETED' as const };
      case 'waived':
        return { status: 'WAIVED' as const };
      case 'dueToday':
        return {
          status: { in: ['READY', 'IN_PROGRESS', 'BLOCKED'] as const },
          dueAt: { lte: endOfToday },
        };
      case 'dueThisWeek':
        return {
          status: { in: ['READY', 'IN_PROGRESS', 'BLOCKED'] as const },
          dueAt: { lte: endOfWeek },
        };
      case 'overdue':
        return {
          status: { in: ['READY', 'IN_PROGRESS', 'BLOCKED'] as const },
          dueAt: { lt: now },
        };
      case 'criticalOverdue':
        return {
          status: { in: ['READY', 'IN_PROGRESS', 'BLOCKED'] as const },
          dueAt: { lt: now },
          taskKind: 'ACCESS_REVOCATION' as const,
        };
      case 'assignedToMe':
      case 'myTasks':
        return { assigneeId: actor.userId, status: { notIn: ['NOT_READY'] as const } };
      case 'critical':
        return {
          status: { in: ['READY', 'IN_PROGRESS', 'BLOCKED'] as const },
          OR: [{ priority: 'CRITICAL' as const }, { escalationLevel: { gt: 0 } }],
        };
      case 'unassigned':
        return { assigneeId: null, status: { in: ['READY', 'IN_PROGRESS', 'BLOCKED'] as const } };
      case 'reassigned':
        return { status: { notIn: ['NOT_READY'] as const }, NOT: { assigneeId: null } };
      case 'all':
        return { status: { in: ['READY', 'IN_PROGRESS', 'BLOCKED'] as const } };
    }
  })();

  const rows = await getPrisma().workflowTask.findMany({
    where: {
      AND: [
        { OR: deptClauses },
        // Department users never see unreleased work (H.8).
        { status: { not: 'NOT_READY' } },
        { instance: { is: { status: { in: ['ACTIVE', 'ON_HOLD', 'CLEARANCE_PENDING'] } } } },
        statusFilter,
        ...(f.departureType && isHr ? [{ case: { is: { departureType: f.departureType } } }] : []),
        ...(f.location && isHr ? [{ case: { is: { location: f.location } } }] : []),
        ...(f.q
          ? [
              {
                OR: [
                  { title: { contains: f.q, mode: 'insensitive' as const } },
                  { case: { is: { caseNumber: { contains: f.q, mode: 'insensitive' as const } } } },
                ],
              },
            ]
          : []),
      ],
    },
    orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { priority: 'desc' }],
    take: 200,
    include: {
      case: {
        select: {
          id: true,
          caseNumber: true,
          classification: true,
          ownerId: true,
          departureType: true,
          location: true,
          employeeDisplayName: true,
          participants: { where: { removedAt: null }, select: { userId: true } },
        },
      },
    },
  });

  // Directive 6.1 (G): responders see WHO holds each task, not just a UUID.
  const assigneeIds = [...new Set(rows.map((t) => t.assigneeId).filter((v): v is string => !!v))];
  const assigneeNames = new Map(
    (
      await getPrisma().user.findMany({
        where: { id: { in: assigneeIds } },
        select: { id: true, displayName: true },
      })
    ).map((u) => [u.id, u.displayName]),
  );

  return {
    departments,
    rows: rows.map((t) => {
      const ctx: CaseAccessContext = {
        ownerId: t.case.ownerId,
        classification: t.case.classification,
        participantUserIds: t.case.participants.map((p) => p.userId),
      };
      const hrFull = isHr && canViewCase(actor, ctx);
      const overdueMinutes =
        t.dueAt && t.dueAt.getTime() < now.getTime() && OPEN_TASK_STATUSES.includes(t.status)
          ? Math.round((now.getTime() - t.dueAt.getTime()) / 60_000)
          : 0;
      return {
        id: t.id,
        title: t.title,
        department: t.department,
        status: t.status,
        priority: t.priority,
        taskKind: t.taskKind,
        confidential: t.confidential,
        dueAt: t.dueAt,
        overdueMinutes,
        blockedReason: t.blockedReason,
        assigneeId: t.assigneeId,
        assigneeName: t.assigneeId ? (assigneeNames.get(t.assigneeId) ?? null) : null,
        assignedToMe: t.assigneeId === actor.userId,
        canClaimHere:
          t.assigneeId === null && t.status === 'READY' && t.department !== 'LINE_MANAGER',
        caseNumber: t.case.caseNumber,
        employeeDisplayName: t.case.employeeDisplayName,
        nextAction:
          t.status === 'READY'
            ? 'Start the task'
            : t.status === 'IN_PROGRESS'
              ? t.taskKind === 'ACCESS_REVOCATION'
                ? 'Record access-revocation completion'
                : 'Complete with evidence'
              : t.status === 'BLOCKED'
                ? 'Clear the blocker'
                : 'Review',
        departureType: hrFull ? t.case.departureType : null,
        location: hrFull ? t.case.location : null,
        caseId: hrFull ? t.case.id : null,
      };
    }),
  };
}
