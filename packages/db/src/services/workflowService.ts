/**
 * Workflow instances (Directive 3 sections C, E, F-H).
 *
 * Deterministic instantiation pinned to one definition version + checksum;
 * duplicate activation is impossible (status-guarded update + partial unique
 * index); holds pause only eligible tasks; every change is audited.
 */
import {
  activationConfirmationErrors,
  canActOnCase,
  checkTransition,
  computeTaskDue,
  computeTaskRelease,
  taskReadyToRelease,
  DEP_SATISFYING_STATUSES,
  LIVE_INSTANCE_STATUSES,
  OPEN_TASK_STATUSES,
  type Actor,
  type CaseAnchorDates,
} from '@exit/domain';
import { getPrisma } from '../client.ts';
import type { PrismaClient } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';
import { getActiveCalendarInfo } from './adminService.ts';
import { assertFeatureAllowed, loadCaseAccess } from './shared.ts';
import { getActiveDefinitionForType } from './workflowDefinitionService.ts';
import { openException } from './exceptionService.ts';

export const WORKFLOW_ENGINE_FLAG = 'automation.workflowEngine';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

function anchorDates(
  c: {
    receivedAt: Date;
    effectiveSeparationAt: Date | null;
    confirmedLastDay: Date | null;
  },
  activationAt: Date,
): CaseAnchorDates {
  return {
    receivedAt: c.receivedAt,
    activationAt,
    effectiveSeparationAt: c.effectiveSeparationAt,
    confirmedLastDay: c.confirmedLastDay,
  };
}

// --- preview (B.8 / C.1) -----------------------------------------------------

/** Read-only preview of the tasks that WOULD be created at activation. */
export async function previewWorkflowForCase(actor: Actor, caseId: string) {
  const { c, ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'workflow.view', ctx)) throw ServiceError.forbidden();
  const def = await getActiveDefinitionForType(c.departureType);
  if (!def) {
    return {
      definition: null,
      tasks: [],
      warning: 'No ACTIVE workflow definition exists for this departure type.',
    };
  }
  const { calendar, version: calendarVersion } = await getActiveCalendarInfo();
  const dates = anchorDates(c, new Date());
  const tasks = def.taskDefs.map((t) => {
    const due = computeTaskDue(t, dates, calendar);
    const releaseAt = computeTaskRelease(t, dates);
    return {
      taskCode: t.taskCode,
      sortOrder: t.sortOrder,
      title: t.title,
      description: t.description,
      department: t.department,
      requiredRole: t.requiredRole,
      taskKind: t.taskKind,
      priority: t.priority,
      confidential: t.confidential,
      required: t.required,
      waiverAllowed: t.waiverAllowed,
      waiverAuthority: t.waiverAuthority,
      dependsOnCodes: t.dependsOnCodes,
      pausesOnHold: t.pausesOnHold,
      blockPausesSla: t.blockPausesSla,
      evidenceKind: t.evidenceKind,
      evidenceNote: t.evidenceNote,
      slaNote: t.slaNote,
      escalationNote: t.escalationNote,
      dueAt: due.dueAt,
      dueRule: due.rule,
      releaseAt,
    };
  });
  return {
    definition: {
      id: def.id,
      name: def.name,
      version: def.version,
      workflowType: def.workflowType,
      configChecksum: def.configChecksum,
      calendarVersion,
    },
    tasks,
    warning: null,
  };
}

// --- activation (C.2 / C.3) --------------------------------------------------

export async function activateCase(actor: Actor, caseId: string) {
  const { c, ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'case.activate', ctx)) throw ServiceError.forbidden();
  const check = checkTransition('activate', c.status, undefined);
  if (!check.ok) throw ServiceError.validation([check.error ?? 'Invalid transition.']);

  // Fixed defaults 9-11: OPERATIONAL/BASELINE automation stays disabled.
  await assertFeatureAllowed(c, WORKFLOW_ENGINE_FLAG);

  if (!c.effectiveSeparationAt) {
    await openException(caseId, {
      exceptionType: 'INVALID_CASE_DATE',
      severity: 'HIGH',
      title: 'Workflow activation refused: effective separation time missing',
      refType: 'OffboardingCase',
      refId: caseId,
      ownerDepartment: 'HR',
    });
    throw ServiceError.validation([
      'The exact effective separation date and time must be approved before activation.',
    ]);
  }

  // Directive 6.1 (E/F/J): activation requires the assignment plan - an
  // operational HR Officer, resolved manager routing (or audited override),
  // and the six confirmations recorded after the last manager change.
  if (!c.assignedOfficerId) {
    throw ServiceError.validation([
      'An HR Officer must be assigned before activation (Assignment tab; HR Manager assigns).',
    ]);
  }
  if (!c.managerUserId) {
    throw ServiceError.validation([
      'MISSING MANAGER — ACTION REQUIRED: derive the manager from the directory or assign an audited alternate on the Assignment tab before activation.',
    ]);
  }
  const confirmationBlockers = activationConfirmationErrors(
    (c.activationConfirmations ?? null) as never,
    c.managerChangeFlaggedAt ?? null,
  );
  if (confirmationBlockers.length) throw ServiceError.validation(confirmationBlockers);

  const def = await getActiveDefinitionForType(c.departureType);
  if (!def) {
    await openException(caseId, {
      exceptionType: 'WORKFLOW_ACTIVATION_FAILURE',
      severity: 'HIGH',
      title: `No ACTIVE workflow definition for ${c.departureType}`,
      refType: 'OffboardingCase',
      refId: caseId,
      ownerDepartment: 'HR',
    });
    throw ServiceError.validation([
      'No ACTIVE workflow definition exists for this departure type; activate one first.',
    ]);
  }

  const { calendar, version: calendarVersion } = await getActiveCalendarInfo();
  const now = new Date();
  const dates = anchorDates(c, now);
  const correlationId = newCorrelationId();

  const instanceId = await getPrisma().$transaction(async (tx) => {
    // Duplicate-activation guard 1: status-guarded case update.
    const updated = await tx.offboardingCase.updateMany({
      where: { id: caseId, status: 'APPROVED', version: c.version },
      data: { status: 'ACTIVE', version: { increment: 1 } },
    });
    if (updated.count === 0)
      throw ServiceError.conflict('The case changed (or was already activated); reload and retry.');

    // Duplicate-activation guard 2: partial unique index on live instances.
    const instance = await tx.workflowInstance.create({
      data: {
        caseId,
        definitionId: def.id,
        definitionVersion: def.version,
        workflowType: def.workflowType,
        configChecksum: def.configChecksum,
        status: 'ACTIVE',
        activatedById: actor.userId,
        activatedAt: now,
        correlationId,
        requiredTaskCount: def.taskDefs.filter((t) => t.required).length,
      },
    });

    for (const t of def.taskDefs) {
      const due = computeTaskDue(t, dates, calendar);
      const releaseAt = computeTaskRelease(t, dates);
      await tx.workflowTask.create({
        data: {
          instanceId: instance.id,
          caseId,
          taskDefId: t.id,
          taskCode: t.taskCode,
          sortOrder: t.sortOrder,
          title: t.title,
          description: t.description,
          department: t.department,
          requiredRole: t.requiredRole,
          taskKind: t.taskKind,
          priority: t.priority,
          confidential: t.confidential,
          required: t.required,
          waiverAllowed: t.waiverAllowed,
          waiverAuthority: t.waiverAuthority,
          status: 'NOT_READY',
          // Directive 6.1 (F): manager-owned tasks route automatically to the
          // confirmed manager; IT/Finance start in their department queues.
          assigneeId: t.department === 'LINE_MANAGER' ? c.managerUserId : null,
          dependsOnCodes: t.dependsOnCodes,
          pausesOnHold: t.pausesOnHold,
          blockPausesSla: t.blockPausesSla,
          releaseAt,
          dueAt: due.dueAt,
          originalDueAt: due.dueAt,
          dueRule: due.rule,
          dueSourceAt: due.sourceAt,
          dueCalendarVersion: calendarVersion,
          dueCalculatedAt: now,
          evidenceKind: t.evidenceKind,
          // Access categories reviewed/extended by IT during preparation (I).
          accessSystems:
            t.taskKind === 'ACCESS_REVOCATION'
              ? ['Network account', 'Email', 'Business applications', 'Building access']
              : [],
        },
      });
    }

    // Handover record (section M): manager-owned; required when the workflow
    // carries a required handover completion obligation.
    const handoverRequired = def.taskDefs.some(
      (t) => t.department === 'LINE_MANAGER' && t.required && t.taskCode.includes('HANDOVER'),
    );
    // Directive 6.1 (F): the confirmed manager becomes the MANAGER participant
    // automatically (assignment-scoped access to exactly this case).
    const managerParticipant = c.participants.find((p) => p.participantRole === 'MANAGER');
    if (c.managerUserId && !managerParticipant) {
      const alreadyParticipating = c.participants.some((p) => p.userId === c.managerUserId);
      if (!alreadyParticipating) {
        await tx.caseParticipant.create({
          data: {
            caseId,
            userId: c.managerUserId,
            participantRole: 'MANAGER',
            reason: 'Auto-added at activation: confirmed manager routing (Directive 6.1 F).',
            addedById: actor.userId,
          },
        });
        await appendAudit(tx, {
          eventType: 'CASE_PARTICIPANT_ADDED',
          actorType: 'USER',
          actorId: actor.userId,
          effectiveRoles: actor.roles,
          objectType: 'CaseParticipant',
          objectId: c.managerUserId,
          caseId,
          result: 'SUCCESS',
          correlationId,
          metadata: {
            caseNumber: c.caseNumber,
            participantRole: 'MANAGER',
            reason: 'Auto-added at activation: confirmed manager routing.',
          },
        });
      }
    }
    await tx.handoverRecord.upsert({
      where: { caseId },
      create: {
        caseId,
        requiredForClearance: handoverRequired,
        managerId: c.managerUserId ?? managerParticipant?.userId ?? null,
      },
      update: {},
    });

    // Asset recovery items sourced from employee-issued assets (L / T.12).
    const issued = await tx.issuedAsset.findMany({
      where: { employeeSourceId: c.employeeSourceId, active: true },
    });
    for (const a of issued) {
      const existing = await tx.assetRecoveryItem.findFirst({
        where: { caseId, issuedAssetId: a.id },
      });
      if (!existing) {
        await tx.assetRecoveryItem.create({
          data: {
            caseId,
            issuedAssetId: a.id,
            assetType: a.assetType,
            label: a.catalogueLabel,
            identifier: a.identifier,
            serialNumber: a.serialNumber,
            responsibleDepartment:
              a.assetType === 'LAPTOP' || a.assetType === 'MOBILE_PHONE' ? 'IT' : 'HR',
            expectedReturnAt: c.confirmedLastDay ?? c.effectiveSeparationAt,
            requiredForClearance: true,
          },
        });
      }
    }

    await tx.caseStatusHistory.create({
      data: {
        caseId,
        fromStatus: c.status,
        toStatus: 'ACTIVE',
        actorId: actor.userId,
        correlationId,
      },
    });
    await appendAudit(tx, {
      eventType: 'WORKFLOW_ACTIVATED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'WorkflowInstance',
      objectId: instance.id,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        caseNumber: c.caseNumber,
        workflowType: def.workflowType,
        definitionVersion: def.version,
        configChecksum: def.configChecksum,
        assignedOfficerId: c.assignedOfficerId,
        managerUserId: c.managerUserId,
        managerSource: c.managerSource,
        taskCount: def.taskDefs.length,
        assetItemsCreated: issued.length,
      },
    });
    return instance.id;
  });

  // Initial release pass + instance counters (immediate departures release
  // security tasks at once - G.1).
  await releaseEligibleTasks(caseId, new Date());
  await recalcInstanceCounts(instanceId, new Date());
  return { instanceId };
}

// --- task release and counters -----------------------------------------------

/** Idempotent release pass (D.1/D.2). Called by services and the worker. */
export async function releaseEligibleTasks(caseId: string, now: Date): Promise<number> {
  const prisma = getPrisma();
  const instance = await prisma.workflowInstance.findFirst({
    where: { caseId, status: { in: [...LIVE_INSTANCE_STATUSES] } },
    include: { tasks: true },
  });
  if (!instance || instance.status === 'ON_HOLD') return 0;
  const satisfied = new Set(
    instance.tasks.filter((t) => DEP_SATISFYING_STATUSES.includes(t.status)).map((t) => t.taskCode),
  );
  let released = 0;
  for (const t of instance.tasks) {
    if (t.status !== 'NOT_READY') continue;
    if (!taskReadyToRelease(t, satisfied, now)) continue;
    const u = await prisma.workflowTask.updateMany({
      where: { id: t.id, status: 'NOT_READY' },
      data: { status: 'READY', releasedAt: now, rowVersion: { increment: 1 } },
    });
    released += u.count;
  }
  return released;
}

/** Recompute the denormalized instance counters (section C fields). */
export async function recalcInstanceCounts(instanceId: string, now: Date): Promise<void> {
  const prisma = getPrisma();
  const instance = await prisma.workflowInstance.findUnique({
    where: { id: instanceId },
    include: { tasks: true },
  });
  if (!instance) return;
  const required = instance.tasks.filter((t) => t.required);
  const done = required.filter((t) => t.status === 'COMPLETED');
  const waived = required.filter((t) => t.status === 'WAIVED');
  const blocked = instance.tasks.filter((t) => t.status === 'BLOCKED');
  const overdue = instance.tasks.filter(
    (t) =>
      t.dueAt &&
      t.dueAt.getTime() < now.getTime() &&
      OPEN_TASK_STATUSES.includes(t.status) &&
      t.status !== 'NOT_READY',
  );
  const pct =
    required.length === 0
      ? 100
      : Math.round(((done.length + waived.length) / required.length) * 100);
  await prisma.workflowInstance.updateMany({
    where: { id: instanceId },
    data: {
      requiredTaskCount: required.length,
      completedTaskCount: done.length,
      waivedTaskCount: waived.length,
      blockedTaskCount: blocked.length,
      overdueTaskCount: overdue.length,
      completionPct: pct,
      rowVersion: { increment: 1 },
    },
  });
}

// --- hold / resume (E.3 / E.4) -----------------------------------------------

export async function holdCase(actor: Actor, caseId: string, reason: string) {
  const { c, ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'case.hold', ctx)) throw ServiceError.forbidden();
  const check = checkTransition('hold', c.status, reason);
  if (!check.ok) throw ServiceError.validation([check.error ?? 'Invalid transition.']);

  const now = new Date();
  const correlationId = newCorrelationId();
  await getPrisma().$transaction(async (tx) => {
    const updated = await tx.offboardingCase.updateMany({
      where: { id: caseId, status: 'ACTIVE', version: c.version },
      data: { status: 'ON_HOLD', version: { increment: 1 } },
    });
    if (updated.count === 0) throw ServiceError.conflict('The case was changed; reload and retry.');
    await tx.workflowInstance.updateMany({
      where: { caseId, status: 'ACTIVE' },
      data: { status: 'ON_HOLD', holdStartedAt: now, rowVersion: { increment: 1 } },
    });
    await tx.caseStatusHistory.create({
      data: {
        caseId,
        fromStatus: c.status,
        toStatus: 'ON_HOLD',
        actorId: actor.userId,
        reason,
        correlationId,
      },
    });
    await appendAudit(tx, {
      eventType: 'CASE_PLACED_ON_HOLD',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'OffboardingCase',
      objectId: caseId,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { caseNumber: c.caseNumber, reason },
    });
  });
}

export async function resumeCase(actor: Actor, caseId: string, reason: string) {
  const { c, ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'case.resume', ctx)) throw ServiceError.forbidden();
  const check = checkTransition('resume', c.status, reason);
  if (!check.ok) throw ServiceError.validation([check.error ?? 'Invalid transition.']);

  const now = new Date();
  const correlationId = newCorrelationId();
  await getPrisma().$transaction(async (tx) => {
    const updated = await tx.offboardingCase.updateMany({
      where: { id: caseId, status: 'ON_HOLD', version: c.version },
      data: { status: 'ACTIVE', version: { increment: 1 } },
    });
    if (updated.count === 0) throw ServiceError.conflict('The case was changed; reload and retry.');

    const instance = await tx.workflowInstance.findFirst({
      where: { caseId, status: 'ON_HOLD' },
      include: { tasks: true },
    });
    if (instance) {
      const heldMs = instance.holdStartedAt ? now.getTime() - instance.holdStartedAt.getTime() : 0;
      await tx.workflowInstance.updateMany({
        where: { id: instance.id },
        data: { status: 'ACTIVE', holdStartedAt: null, rowVersion: { increment: 1 } },
      });
      // E.3/E.4: shift due dates ONLY for pause-eligible open tasks; exact-time
      // security tasks and non-pausable tasks are untouched.
      if (heldMs > 0) {
        for (const t of instance.tasks) {
          if (!t.pausesOnHold || t.taskKind === 'ACCESS_REVOCATION') continue;
          if (!OPEN_TASK_STATUSES.includes(t.status) || !t.dueAt) continue;
          await tx.workflowTask.updateMany({
            where: { id: t.id },
            data: {
              dueAt: new Date(t.dueAt.getTime() + heldMs),
              dueRecalcReason: `case hold released after ${Math.round(heldMs / 60_000)} minute(s) (${reason})`,
              dueCalculatedAt: now,
              rowVersion: { increment: 1 },
            },
          });
        }
      }
    }

    await tx.caseStatusHistory.create({
      data: {
        caseId,
        fromStatus: c.status,
        toStatus: 'ACTIVE',
        actorId: actor.userId,
        reason,
        correlationId,
      },
    });
    await appendAudit(tx, {
      eventType: 'CASE_RESUMED_FROM_HOLD',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'OffboardingCase',
      objectId: caseId,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { caseNumber: c.caseNumber, reason },
    });
  });
  await releaseEligibleTasks(caseId, new Date());
}

// --- case closure hook (C.4 / C.5) -------------------------------------------

/**
 * Called INSIDE the case cancel/void transaction: incomplete tasks are
 * cancelled, history and completed evidence are preserved.
 */
export async function cancelLiveWorkflowForCaseTx(
  tx: Tx,
  caseId: string,
  actor: Actor,
  toStatus: 'CANCELLED' | 'VOIDED',
  reason: string,
  correlationId: string,
): Promise<void> {
  const instance = await tx.workflowInstance.findFirst({
    where: { caseId, status: { in: [...LIVE_INSTANCE_STATUSES] } },
    select: { id: true },
  });
  if (!instance) return;
  const now = new Date();
  await tx.workflowTask.updateMany({
    where: { instanceId: instance.id, status: { in: [...OPEN_TASK_STATUSES] } },
    data: {
      status: 'CANCELLED',
      cancelledAt: now,
      cancelReason: `case ${toStatus.toLowerCase()}: ${reason}`,
      rowVersion: { increment: 1 },
    },
  });
  await tx.workflowInstance.updateMany({
    where: { id: instance.id },
    data: {
      status: 'CANCELLED',
      cancelledAt: now,
      cancelReason: `case ${toStatus.toLowerCase()}: ${reason}`,
      rowVersion: { increment: 1 },
    },
  });
  // Open notification work stops with the case.
  await tx.notificationRecord.updateMany({
    where: {
      caseId,
      status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'READY_FOR_MANUAL_SEND'] },
    },
    data: {
      status: 'CANCELLED',
      cancelReason: `case ${toStatus.toLowerCase()}: ${reason}`,
      rowVersion: { increment: 1 },
    },
  });
  await appendAudit(tx, {
    eventType: 'WORKFLOW_CANCELLED_WITH_CASE',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'WorkflowInstance',
    objectId: instance.id,
    caseId,
    result: 'SUCCESS',
    correlationId,
    metadata: { toStatus, reason },
  });
}

// --- reopen (C.6) ------------------------------------------------------------

export async function reopenCase(actor: Actor, caseId: string, reason: string, plan: string) {
  const { c, ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'case.reopen', ctx)) throw ServiceError.forbidden();
  const check = checkTransition('reopen', c.status, reason);
  if (!check.ok) throw ServiceError.validation([check.error ?? 'Invalid transition.']);
  if (!plan.trim() || plan.length > 4000)
    throw ServiceError.validation(['A reactivation plan of 1-4000 characters is required (C.6).']);

  const correlationId = newCorrelationId();
  await getPrisma().$transaction(async (tx) => {
    const updated = await tx.offboardingCase.updateMany({
      where: { id: caseId, status: 'COMPLETED', version: c.version },
      data: { status: 'REOPENED', version: { increment: 1 }, closedAt: null, closeReason: null },
    });
    if (updated.count === 0) throw ServiceError.conflict('The case was changed; reload and retry.');
    // The completed workflow is preserved untouched; the plan is recorded as
    // an HR note plus audit evidence - never a silent overwrite.
    await tx.caseNote.create({
      data: {
        caseId,
        authorId: actor.userId,
        visibility: 'HR_AND_OVERSIGHT',
        body: `REACTIVATION PLAN (case reopened): ${plan}`,
      },
    });
    await tx.caseStatusHistory.create({
      data: {
        caseId,
        fromStatus: c.status,
        toStatus: 'REOPENED',
        actorId: actor.userId,
        reason,
        correlationId,
      },
    });
    await appendAudit(tx, {
      eventType: 'CASE_REOPENED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'OffboardingCase',
      objectId: caseId,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { caseNumber: c.caseNumber, reason, planRecorded: true },
    });
  });
}

// --- departure-type change after activation (C.7 / C.8) ----------------------

export async function changeDepartureTypeAfterActivation(
  actor: Actor,
  caseId: string,
  newType: 'RESIGNATION_WITH_NOTICE' | 'IMMEDIATE_RESIGNATION' | 'TERMINATION',
  reason: string,
) {
  const { c, ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'workflow.supersede', ctx)) throw ServiceError.forbidden();
  if (!reason.trim()) throw ServiceError.validation(['A reason is required (C.7).']);
  if (c.departureType === newType)
    throw ServiceError.validation(['The case already has this departure type.']);
  if (c.departureType === 'TERMINATION')
    throw ServiceError.validation([
      'A termination case cannot be re-typed; void it and create the correct case.',
    ]);
  if (!['ACTIVE', 'ON_HOLD'].includes(c.status))
    throw ServiceError.conflict('Departure type can only be corrected on an active case here.');

  const def = await getActiveDefinitionForType(newType);
  if (!def)
    throw ServiceError.validation([
      `No ACTIVE workflow definition exists for ${newType}; activate one first.`,
    ]);

  const { calendar, version: calendarVersion } = await getActiveCalendarInfo();
  const now = new Date();
  const correlationId = newCorrelationId();

  await getPrisma().$transaction(async (tx) => {
    const updated = await tx.offboardingCase.updateMany({
      where: { id: caseId, version: c.version },
      data: {
        departureType: newType,
        classification: newType === 'TERMINATION' ? 'RESTRICTED' : c.classification,
        version: { increment: 1 },
      },
    });
    if (updated.count === 0) throw ServiceError.conflict('The case was changed; reload and retry.');

    const oldInstance = await tx.workflowInstance.findFirst({
      where: { caseId, status: { in: [...LIVE_INSTANCE_STATUSES] } },
      include: { tasks: true },
    });
    type OldTask = NonNullable<typeof oldInstance>['tasks'][number];
    const carried = new Map<string, OldTask>();
    if (oldInstance) {
      // C.8: preserve the original workflow as SUPERSEDED; open tasks cancel.
      await tx.workflowTask.updateMany({
        where: { instanceId: oldInstance.id, status: { in: [...OPEN_TASK_STATUSES] } },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          cancelReason: `workflow superseded: departure type corrected (${reason})`,
          rowVersion: { increment: 1 },
        },
      });
      await tx.workflowInstance.updateMany({
        where: { id: oldInstance.id },
        data: {
          status: 'SUPERSEDED',
          supersededAt: now,
          supersededReason: reason,
          rowVersion: { increment: 1 },
        },
      });
      for (const t of oldInstance.tasks) {
        if (t.status === 'COMPLETED' || t.status === 'WAIVED') carried.set(t.taskCode, t);
      }
    }

    const dates = anchorDates(c, now);
    const instance = await tx.workflowInstance.create({
      data: {
        caseId,
        definitionId: def.id,
        definitionVersion: def.version,
        workflowType: def.workflowType,
        configChecksum: def.configChecksum,
        status: 'ACTIVE',
        activatedById: actor.userId,
        activatedAt: now,
        correlationId,
        requiredTaskCount: def.taskDefs.filter((t) => t.required).length,
      },
    });
    let carriedCount = 0;
    for (const t of def.taskDefs) {
      const due = computeTaskDue(t, dates, calendar);
      const releaseAt = computeTaskRelease(t, dates);
      // C.8: carry forward ONLY explicitly mapped completed evidence -
      // matching task codes between the two definitions.
      const prior = carried.get(t.taskCode);
      const carryForward = prior !== undefined;
      if (carryForward) carriedCount += 1;
      await tx.workflowTask.create({
        data: {
          instanceId: instance.id,
          caseId,
          taskDefId: t.id,
          taskCode: t.taskCode,
          sortOrder: t.sortOrder,
          title: t.title,
          description: t.description,
          department: t.department,
          requiredRole: t.requiredRole,
          taskKind: t.taskKind,
          priority: t.priority,
          confidential: t.confidential,
          required: t.required,
          waiverAllowed: t.waiverAllowed,
          waiverAuthority: t.waiverAuthority,
          status: carryForward ? prior!.status : 'NOT_READY',
          // Directive 6.1 (F): manager routing carries into the superseding
          // workflow (evidence keeps the ORIGINAL completing actor).
          assigneeId: carryForward
            ? prior!.assigneeId
            : t.department === 'LINE_MANAGER'
              ? c.managerUserId
              : null,
          dependsOnCodes: t.dependsOnCodes,
          pausesOnHold: t.pausesOnHold,
          blockPausesSla: t.blockPausesSla,
          releaseAt,
          dueAt: due.dueAt,
          originalDueAt: due.dueAt,
          dueRule: due.rule,
          dueSourceAt: due.sourceAt,
          dueCalendarVersion: calendarVersion,
          dueCalculatedAt: now,
          evidenceKind: t.evidenceKind,
          accessSystems:
            t.taskKind === 'ACCESS_REVOCATION'
              ? prior?.accessSystems?.length
                ? prior.accessSystems
                : ['Network account', 'Email', 'Business applications', 'Building access']
              : [],
          ...(carryForward
            ? {
                completedAt: prior!.completedAt,
                completedById: prior!.completedById,
                completionNote: prior!.completionNote
                  ? `${prior!.completionNote} [carried forward from superseded workflow]`
                  : '[carried forward from superseded workflow]',
                waivedAt: prior!.waivedAt,
                waivedById: prior!.waivedById,
                waiverReason: prior!.waiverReason,
                lateMinutes: prior!.lateMinutes,
                accessSystemsCompleted: prior!.accessSystemsCompleted,
                accessSystemsUnresolved: prior!.accessSystemsUnresolved,
                accessResult: prior!.accessResult,
              }
            : {}),
        },
      });
    }

    await appendAudit(tx, {
      eventType: 'WORKFLOW_SUPERSEDED_TYPE_CHANGE',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'WorkflowInstance',
      objectId: instance.id,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        caseNumber: c.caseNumber,
        oldType: c.departureType,
        newType,
        reason,
        carriedTaskCount: carriedCount,
        newDefinitionVersion: def.version,
      },
    });
  });
  await releaseEligibleTasks(caseId, new Date());
}

// --- effective-time change ripple (E.5 - E.7) --------------------------------

/**
 * Recalculate due dates for tasks anchored on the effective separation or
 * final working day after an approved change. Old due dates are retained
 * (originalDueAt + recalc reason); retrospective moves surface as exceptions.
 */
export async function recalcTasksForEffectiveChange(
  caseId: string,
  actor: Actor,
  reason: string,
): Promise<void> {
  const prisma = getPrisma();
  const c = await prisma.offboardingCase.findUnique({ where: { id: caseId } });
  if (!c) return;
  const instance = await prisma.workflowInstance.findFirst({
    where: { caseId, status: { in: [...LIVE_INSTANCE_STATUSES] } },
    include: { tasks: { include: { taskDef: true } } },
  });
  if (!instance) return;
  const { calendar, version: calendarVersion } = await getActiveCalendarInfo();
  const now = new Date();
  const dates = anchorDates(c, instance.activatedAt);
  const changes: { taskCode: string; oldDue: string | null; newDue: string | null }[] = [];

  for (const t of instance.tasks) {
    if (!OPEN_TASK_STATUSES.includes(t.status)) continue;
    const def = t.taskDef;
    if (!def) continue;
    if (def.dueBasis !== 'EFFECTIVE_SEPARATION' && def.dueBasis !== 'FINAL_WORKING_DAY') continue;
    const due = computeTaskDue(def, dates, calendar);
    const releaseAt = computeTaskRelease(def, dates);
    const oldDue = t.dueAt;
    if ((oldDue?.getTime() ?? null) === (due.dueAt?.getTime() ?? null)) continue;
    await prisma.workflowTask.updateMany({
      where: { id: t.id },
      data: {
        dueAt: due.dueAt,
        dueRule: due.rule,
        dueSourceAt: due.sourceAt,
        dueCalendarVersion: calendarVersion,
        dueCalculatedAt: now,
        dueRecalcReason: reason,
        releaseAt,
        rowVersion: { increment: 1 },
      },
    });
    changes.push({
      taskCode: t.taskCode,
      oldDue: oldDue?.toISOString() ?? null,
      newDue: due.dueAt?.toISOString() ?? null,
    });
    // E.6/E.7: a past due date moved into the future is retrospective - it
    // requires HR_MANAGER authority (enforced by the caller's permission) and
    // must be visible in the exception history.
    if (
      oldDue &&
      oldDue.getTime() < now.getTime() &&
      due.dueAt &&
      due.dueAt.getTime() > now.getTime()
    ) {
      await openException(caseId, {
        exceptionType: 'DUE_DATE_RETROSPECTIVE_CHANGE',
        severity: 'INFO',
        title: `Past due date moved forward: ${t.title}`,
        detail: `Old due ${oldDue.toISOString()}, new due ${due.dueAt.toISOString()}. Reason: ${reason}`,
        refType: 'WorkflowTask',
        refId: t.id,
        ownerDepartment: 'HR',
      });
    }
  }

  if (changes.length > 0) {
    await appendAudit(prisma, {
      eventType: 'TASK_DUE_DATES_RECALCULATED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'WorkflowInstance',
      objectId: instance.id,
      caseId,
      result: 'SUCCESS',
      correlationId: newCorrelationId(),
      metadata: { reason, changes: JSON.stringify(changes).slice(0, 3000) },
    });
  }
  await releaseEligibleTasks(caseId, now);
  await recalcInstanceCounts(instance.id, now);
}

/** Tasks that WOULD be affected by an effective-time change (E.5 preview). */
export async function previewEffectiveChangeImpact(actor: Actor, caseId: string) {
  const { ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'workflow.view', ctx)) return [];
  const instance = await getPrisma().workflowInstance.findFirst({
    where: { caseId, status: { in: [...LIVE_INSTANCE_STATUSES] } },
    include: { tasks: { include: { taskDef: true }, orderBy: { sortOrder: 'asc' } } },
  });
  if (!instance) return [];
  return instance.tasks
    .filter(
      (t) =>
        OPEN_TASK_STATUSES.includes(t.status) &&
        t.taskDef &&
        (t.taskDef.dueBasis === 'EFFECTIVE_SEPARATION' ||
          t.taskDef.dueBasis === 'FINAL_WORKING_DAY'),
    )
    .map((t) => ({
      id: t.id,
      title: t.title,
      department: t.department,
      status: t.status,
      dueAt: t.dueAt,
      dueRule: t.dueRule,
      basis: t.taskDef!.dueBasis,
    }));
}

// --- read model --------------------------------------------------------------

/** Full workflow view for actors with case visibility. */
export async function getCaseWorkflow(actor: Actor, caseId: string) {
  const { c, ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'workflow.view', ctx)) throw ServiceError.forbidden();
  const instances = await getPrisma().workflowInstance.findMany({
    where: { caseId },
    orderBy: { activatedAt: 'desc' },
    include: { tasks: { orderBy: { sortOrder: 'asc' } }, definition: { select: { name: true } } },
  });
  return {
    caseNumber: c.caseNumber,
    caseStatus: c.status,
    departureType: c.departureType,
    /** Server-side evaluation instant (render must stay pure). */
    now: new Date(),
    instances,
    canHold: canActOnCase(actor, 'case.hold', ctx) && c.status === 'ACTIVE',
    canResume: canActOnCase(actor, 'case.resume', ctx) && c.status === 'ON_HOLD',
    canActivate: canActOnCase(actor, 'case.activate', ctx) && c.status === 'APPROVED',
    canSupersede:
      canActOnCase(actor, 'workflow.supersede', ctx) && ['ACTIVE', 'ON_HOLD'].includes(c.status),
    canRequestClearance: canActOnCase(actor, 'clearance.request', ctx) && c.status === 'ACTIVE',
  };
}
