/**
 * Final clearance gate and case completion (Directive 3 section O).
 *
 * Readiness is evaluated from database facts by the pure domain gate;
 * exit-survey completion is never an input (fixed default 20). Only
 * HR_MANAGER approves final clearance; the approval writes an immutable
 * clearance record bound to a snapshot checksum.
 */
import {
  canActOnCase,
  checkTransition,
  clearanceChecksum,
  evaluateClearance,
  letterTypeForDeparture,
  unresolvedItems,
  CLEARANCE_MEANING,
  FORM_LIVE_STATUSES,
  LIVE_INSTANCE_STATUSES,
  type Actor,
  type ClearanceFacts,
} from '@exit/domain';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';
import { loadCaseAccess } from './shared.ts';
import { openException } from './exceptionService.ts';

const LIVE_DOC_STATUSES = [
  'DRAFT',
  'VALIDATION_FAILED',
  'PENDING_APPROVAL',
  'RETURNED',
  'APPROVED',
  'RENDERING',
  'RENDERED',
  'MANUALLY_ISSUED',
  'ISSUED_BY_EMAIL',
  'RENDER_FAILED',
] as const;

/** Gather the clearance facts for a case's live workflow. */
export async function computeClearanceFacts(caseId: string): Promise<{
  facts: ClearanceFacts;
  instanceId: string;
} | null> {
  const prisma = getPrisma();
  const c = await prisma.offboardingCase.findUnique({ where: { id: caseId } });
  if (!c) return null;
  const instance = await prisma.workflowInstance.findFirst({
    where: { caseId, status: { in: [...LIVE_INSTANCE_STATUSES] } },
    include: { tasks: true },
  });
  if (!instance) return null;

  const letterType = letterTypeForDeparture(c.departureType);
  const [
    letter,
    form,
    assets,
    criticalOpen,
    securityApproved,
    approvedAssetExceptions,
    emailRecords,
    requiredEmailActions,
    resolvedEmailExceptions,
  ] = await Promise.all([
    letterType
      ? prisma.documentInstance.findFirst({
          where: { caseId, documentType: letterType, status: { in: [...LIVE_DOC_STATUSES] } },
          orderBy: { version: 'desc' },
        })
      : Promise.resolve(null),
    prisma.actionFormVersion.findFirst({
      where: { caseId, status: { in: [...FORM_LIVE_STATUSES] } },
      orderBy: { version: 'desc' },
    }),
    prisma.assetRecoveryItem.findMany({
      where: { caseId },
      select: { id: true, status: true, requiredForClearance: true },
    }),
    prisma.caseException.count({ where: { caseId, status: 'OPEN', severity: 'CRITICAL' } }),
    prisma.caseException.count({
      where: { caseId, status: 'RESOLVED', securityExceptionApproved: true },
    }),
    // Directive 6.3 logic-audit fix: exception coverage is PER ITEM.
    prisma.caseException.findMany({
      where: { caseId, status: 'RESOLVED', exceptionType: 'ASSET_UNRESOLVED' },
      select: { refId: true },
    }),
    prisma.notificationRecord.findMany({
      where: { caseId, origin: 'DERIVED' },
      select: {
        id: true,
        notificationType: true,
        status: true,
        sentAt: true,
        manualSentAt: true,
        acknowledgedAt: true,
        completionConfirmedAt: true,
      },
    }),
    prisma.caseRequiredAction.findMany({
      where: { caseId, kind: 'EMAIL_ACTION', supersededAt: null },
      select: { actionKey: true, applicable: true, refId: true },
    }),
    prisma.caseException.findMany({
      where: {
        caseId,
        status: 'RESOLVED',
        exceptionType: {
          in: ['ACKNOWLEDGEMENT_OVERDUE', 'AUTO_SEND_BLOCKED', 'RECIPIENT_MISSING'],
        },
      },
      select: { refId: true, exceptionType: true, securityExceptionApproved: true },
    }),
  ]);

  // Directive 6.3 AA: fold record evidence + applicability into per-action
  // facts. IT exceptions must be management-approved (security posture);
  // Finance/provider exceptions need documented resolution.
  const emailActions = emailRecords.map((r) => {
    const isIt = r.notificationType === 'IT_ACCESS_REMOVAL';
    const covering = resolvedEmailExceptions.filter((e) => e.refId === r.id);
    return {
      notificationType: r.notificationType,
      applicable:
        requiredEmailActions.find((a) => a.refId === r.id)?.applicable ??
        !['CANCELLED', 'SUPERSEDED'].includes(r.status),
      sentAt: r.sentAt ?? r.manualSentAt,
      acknowledgedAt: r.acknowledgedAt,
      completionConfirmedAt: r.completionConfirmedAt,
      exceptionApproved: isIt
        ? covering.some((e) => e.securityExceptionApproved)
        : covering.length > 0,
    };
  });

  const returnChecklistRow = await prisma.returnItemsChecklist.findUnique({
    where: { caseId },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  });

  const benefitsUnresolvedCount = [
    c.groupHealthApplicability,
    c.groupLifeApplicability,
    c.otherProviderApplicability,
  ].filter((v) => v === 'UNKNOWN').length;

  const facts: ClearanceFacts = {
    departureType: c.departureType,
    tasks: instance.tasks.map((t) => ({
      taskCode: t.taskCode,
      title: t.title,
      required: t.required,
      status: t.status,
      taskKind: t.taskKind,
      department: t.department,
    })),
    letterStatus: letter?.status ?? null,
    letterRequired: letterType !== null,
    actionFormStatus: form?.status ?? null,
    assets,
    approvedUnresolvedAssetIds: approvedAssetExceptions
      .map((e) => e.refId)
      .filter((id): id is string => id !== null),
    openCriticalExceptionCount: criticalOpen,
    accessSecurityExceptionApproved: securityApproved > 0,
    emailActions,
    benefitsUnresolvedCount,
    returnChecklist: returnChecklistRow
      ? {
          submitted: returnChecklistRow.submittedAt !== null,
          unresolvedLabels: unresolvedItems(returnChecklistRow.items).map((i) => i.label),
        }
      : null,
  };
  return { facts, instanceId: instance.id };
}

/** Recompute and persist readiness on the live instance (worker + services). */
export async function refreshClearanceReadiness(caseId: string): Promise<boolean | null> {
  const computed = await computeClearanceFacts(caseId);
  if (!computed) return null;
  const readiness = evaluateClearance(computed.facts);
  await getPrisma().workflowInstance.updateMany({
    where: { id: computed.instanceId },
    data: {
      clearanceReady: readiness.ok,
      readinessDetail: JSON.parse(JSON.stringify(readiness.items)),
      readinessCheckedAt: new Date(),
      rowVersion: { increment: 1 },
    },
  });
  return readiness.ok;
}

/** O: full clearance review view for the case page. */
export async function getClearanceView(actor: Actor, caseId: string) {
  const { c, ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'workflow.view', ctx)) throw ServiceError.forbidden();
  const computed = await computeClearanceFacts(caseId);
  const prisma = getPrisma();
  const [exceptions, notifications, records, survey] = await Promise.all([
    prisma.caseException.findMany({
      where: { caseId },
      orderBy: [{ status: 'asc' }, { severity: 'desc' }],
      take: 50,
    }),
    prisma.notificationRecord.findMany({
      where: { caseId },
      select: { id: true, notificationType: true, status: true, manualSentAt: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.clearanceRecord.findMany({ where: { caseId }, orderBy: { createdAt: 'desc' } }),
    prisma.surveyInvitation.findFirst({
      where: { caseId },
      select: { status: true, responseChannel: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  const readiness = computed ? evaluateClearance(computed.facts) : null;
  return {
    caseNumber: c.caseNumber,
    caseStatus: c.status,
    readiness,
    facts: computed?.facts ?? null,
    exceptions,
    notifications,
    clearanceRecords: records,
    surveyStatus: survey
      ? `${survey.status}${survey.responseChannel ? ` (${survey.responseChannel})` : ''}`
      : 'No invitation',
    canRequest: canActOnCase(actor, 'clearance.request', ctx) && c.status === 'ACTIVE',
    canApprove: canActOnCase(actor, 'clearance.approve', ctx) && c.status === 'CLEARANCE_REVIEW',
    canReturn: canActOnCase(actor, 'clearance.approve', ctx) && c.status === 'CLEARANCE_REVIEW',
  };
}

/** ACTIVE -> CLEARANCE_REVIEW, only when every gate condition passes (O). */
export async function requestClearance(actor: Actor, caseId: string) {
  const { c, ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'clearance.request', ctx)) throw ServiceError.forbidden();
  const check = checkTransition('requestClearance', c.status, undefined);
  if (!check.ok) throw ServiceError.validation([check.error ?? 'Invalid transition.']);

  const computed = await computeClearanceFacts(caseId);
  if (!computed) throw ServiceError.conflict('No live workflow exists for this case.');
  const readiness = evaluateClearance(computed.facts);
  if (!readiness.ok) {
    await openException(caseId, {
      exceptionType: 'CLEARANCE_BLOCKED',
      severity: 'WARNING',
      title: 'Clearance requested while requirements are incomplete',
      detail: readiness.items
        .filter((i) => !i.ok)
        .map((i) => `${i.label}: ${i.detail}`)
        .join(' | ')
        .slice(0, 1900),
      refType: 'WorkflowInstance',
      refId: computed.instanceId,
      ownerDepartment: 'HR',
    });
    throw ServiceError.validation(
      readiness.items.filter((i) => !i.ok).map((i) => `${i.label}: ${i.detail}`),
    );
  }

  const correlationId = newCorrelationId();
  await getPrisma().$transaction(async (tx) => {
    const updated = await tx.offboardingCase.updateMany({
      where: { id: caseId, status: 'ACTIVE', version: c.version },
      data: { status: 'CLEARANCE_REVIEW', version: { increment: 1 } },
    });
    if (updated.count === 0) throw ServiceError.conflict('The case was changed; reload and retry.');
    await tx.workflowInstance.updateMany({
      where: { id: computed.instanceId, status: 'ACTIVE' },
      data: { status: 'CLEARANCE_PENDING', rowVersion: { increment: 1 } },
    });
    await tx.caseStatusHistory.create({
      data: {
        caseId,
        fromStatus: c.status,
        toStatus: 'CLEARANCE_REVIEW',
        actorId: actor.userId,
        correlationId,
      },
    });
    await appendAudit(tx, {
      eventType: 'CLEARANCE_REQUESTED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'WorkflowInstance',
      objectId: computed.instanceId,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { caseNumber: c.caseNumber },
    });
  });
  await refreshClearanceReadiness(caseId);
}

/** CLEARANCE_REVIEW -> ACTIVE when review finds outstanding work. */
export async function returnFromClearance(actor: Actor, caseId: string, reason: string) {
  const { c, ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'clearance.approve', ctx)) throw ServiceError.forbidden();
  const check = checkTransition('clearanceReturn', c.status, reason);
  if (!check.ok) throw ServiceError.validation([check.error ?? 'Invalid transition.']);

  const correlationId = newCorrelationId();
  await getPrisma().$transaction(async (tx) => {
    const updated = await tx.offboardingCase.updateMany({
      where: { id: caseId, status: 'CLEARANCE_REVIEW', version: c.version },
      data: { status: 'ACTIVE', version: { increment: 1 } },
    });
    if (updated.count === 0) throw ServiceError.conflict('The case was changed; reload and retry.');
    await tx.workflowInstance.updateMany({
      where: { caseId, status: 'CLEARANCE_PENDING' },
      data: { status: 'ACTIVE', rowVersion: { increment: 1 } },
    });
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
      eventType: 'CLEARANCE_RETURNED',
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

/**
 * O: HR_MANAGER final clearance approval - re-verifies the gate, then writes
 * the immutable clearance record and completes the case and workflow.
 */
export async function approveFinalClearance(actor: Actor, caseId: string) {
  const { c, ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'clearance.approve', ctx)) throw ServiceError.forbidden();
  const check = checkTransition('complete', c.status, undefined);
  if (!check.ok) throw ServiceError.validation([check.error ?? 'Invalid transition.']);

  const computed = await computeClearanceFacts(caseId);
  if (!computed) throw ServiceError.conflict('No live workflow exists for this case.');
  const readiness = evaluateClearance(computed.facts);
  if (!readiness.ok)
    throw ServiceError.validation(
      readiness.items.filter((i) => !i.ok).map((i) => `${i.label}: ${i.detail}`),
    );

  const prisma = getPrisma();
  const [actorUser, approvedExceptions, instance] = await Promise.all([
    prisma.user.findUnique({ where: { id: actor.userId } }),
    prisma.caseException.findMany({
      where: {
        caseId,
        status: 'RESOLVED',
        OR: [{ securityExceptionApproved: true }, { exceptionType: 'ASSET_UNRESOLVED' }],
      },
      select: { id: true, exceptionType: true, resolution: true, resolvedAt: true },
    }),
    prisma.workflowInstance.findUnique({ where: { id: computed.instanceId } }),
  ]);
  if (!instance) throw ServiceError.conflict('Workflow instance not found.');

  const now = new Date();
  const snapshot = {
    caseNumber: c.caseNumber,
    workflowVersion: instance.definitionVersion,
    workflowChecksum: instance.configChecksum,
    readiness: readiness.items,
    counts: {
      requiredTaskCount: instance.requiredTaskCount,
      completedTaskCount: instance.completedTaskCount,
      waivedTaskCount: instance.waivedTaskCount,
    },
    approvedExceptions: approvedExceptions.map((e) => ({
      id: e.id,
      type: e.exceptionType,
      resolvedAt: e.resolvedAt?.toISOString() ?? null,
    })),
    approvedAt: now.toISOString(),
  };
  const checksum = clearanceChecksum(snapshot);
  const correlationId = newCorrelationId();

  await prisma.$transaction(async (tx) => {
    const updated = await tx.offboardingCase.updateMany({
      where: { id: caseId, status: 'CLEARANCE_REVIEW', version: c.version },
      data: {
        status: 'COMPLETED',
        version: { increment: 1 },
        closedAt: now,
        closeReason: 'Final clearance approved.',
      },
    });
    if (updated.count === 0) throw ServiceError.conflict('The case was changed; reload and retry.');
    const wf = await tx.workflowInstance.updateMany({
      where: { id: computed.instanceId, status: 'CLEARANCE_PENDING' },
      data: {
        status: 'COMPLETED',
        completedAt: now,
        clearanceReady: true,
        rowVersion: { increment: 1 },
      },
    });
    if (wf.count === 0) throw ServiceError.conflict('The workflow changed; reload and retry.');
    // The seeded "final clearance review" tracking task is completed BY this
    // approval (it is non-required, so it never gates itself).
    await tx.workflowTask.updateMany({
      where: {
        instanceId: computed.instanceId,
        taskCode: { contains: 'FINAL_CLEARANCE' },
        status: { in: ['NOT_READY', 'READY', 'IN_PROGRESS', 'BLOCKED'] },
      },
      data: {
        status: 'COMPLETED',
        completedAt: now,
        completedById: actor.userId,
        completionNote: 'Completed by the final clearance approval.',
        rowVersion: { increment: 1 },
      },
    });
    await tx.clearanceRecord.create({
      data: {
        caseId,
        workflowInstanceId: computed.instanceId,
        workflowVersion: instance.definitionVersion,
        decision: 'APPROVED',
        actorId: actor.userId,
        actorDisplayName: actorUser?.displayName ?? '(unknown)',
        actorRole: 'HR_MANAGER',
        meaning: CLEARANCE_MEANING,
        snapshot: JSON.parse(JSON.stringify(snapshot)),
        unresolvedApprovedExceptions: JSON.parse(JSON.stringify(snapshot.approvedExceptions)),
        checksum,
        correlationId,
      },
    });
    await tx.caseStatusHistory.create({
      data: {
        caseId,
        fromStatus: c.status,
        toStatus: 'COMPLETED',
        actorId: actor.userId,
        correlationId,
      },
    });
    await appendAudit(tx, {
      eventType: 'CLEARANCE_APPROVED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'ClearanceRecord',
      objectId: computed.instanceId,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        caseNumber: c.caseNumber,
        checksum,
        workflowVersion: instance.definitionVersion,
        approvedExceptionCount: approvedExceptions.length,
      },
    });
  });
}
