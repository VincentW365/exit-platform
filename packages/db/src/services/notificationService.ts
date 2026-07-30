/**
 * Controlled notification preparation (Directive 3 section K).
 *
 * No live email is ever sent. Records document preparation, HR approval and
 * MANUAL sending. The delivery interface is provider-neutral; the only
 * adapter in this increment is a development capture adapter that never
 * represents a notification as externally delivered and is refused in
 * production configuration (fail closed).
 */
import {
  can,
  canActOnCase,
  contentChecksum,
  extractPlaceholders,
  formatDateOnly,
  formatInstant,
  notificationIdempotencyKey,
  notificationTransitionError,
  requiresManagerApproval,
  substitute,
  templateContentErrors,
  hasMissingMarkers,
  APPLICABILITY_GATED_TYPES,
  MANUAL_SEND_METHODS,
  NOTIFICATION_PLACEHOLDERS,
  NOTIFICATION_RECIPIENT_CLASS,
  NOTIFICATION_TYPES,
  type Actor,
  type AuditEventType,
  type NotificationAction,
  type NotificationType,
} from '@exit/domain';
import { z } from 'zod';
import { getConfig } from '@exit/config';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';
import { loadCaseAccess } from './shared.ts';

// --- provider-neutral delivery boundary (K.12-K.15) --------------------------

export interface NotificationDeliveryAdapter {
  readonly mode: 'dev-capture';
  /** Capture a prepared notification locally. NEVER an external delivery. */
  capture(recordId: string, subject: string, body: string, note: string): Promise<void>;
}

class DevCaptureAdapter implements NotificationDeliveryAdapter {
  readonly mode = 'dev-capture' as const;
  async capture(recordId: string, subject: string, body: string, note: string): Promise<void> {
    await getPrisma().notificationCapture.create({
      data: { recordId, subject, body, note },
    });
  }
}

let adapter: NotificationDeliveryAdapter | undefined;

/** K.15: production startup must fail closed on a development capture adapter. */
export function getDeliveryAdapter(): NotificationDeliveryAdapter {
  if (getConfig().isProduction) {
    throw new Error(
      'FATAL: the development notification capture adapter is not permitted in production. ' +
        'Live delivery is a later, decision-gated increment (K.15/K.16).',
    );
  }
  adapter ??= new DevCaptureAdapter();
  return adapter;
}

// --- template management -----------------------------------------------------

export async function listNotificationTemplates(actor: Actor) {
  if (!can(actor, 'template.view')) throw ServiceError.forbidden();
  return getPrisma().notificationTemplate.findMany({
    orderBy: [{ notificationType: 'asc' }, { version: 'desc' }],
  });
}

// --- per-case notification records -------------------------------------------

function buildFieldValues(
  c: {
    caseNumber: string;
    employeeDisplayName: string;
    employeeSourceId: string;
    department: string;
    effectiveSeparationAt: Date | null;
    confirmedLastDay: Date | null;
  },
  extras: { accessSystemsSummary?: string; manualNote?: string; handoverDueDate?: Date | null },
): Record<string, string> {
  return {
    EMPLOYEE_LEGAL_NAME: c.employeeDisplayName,
    EMPLOYEE_REFERENCE: c.employeeSourceId,
    CASE_REFERENCE: c.caseNumber,
    DEPARTMENT: c.department,
    EFFECTIVE_SEPARATION_DATE: c.effectiveSeparationAt
      ? formatDateOnly(c.effectiveSeparationAt)
      : '',
    EFFECTIVE_SEPARATION_TIME: c.effectiveSeparationAt
      ? `${formatInstant(c.effectiveSeparationAt)} (America/Jamaica)`
      : '',
    // Immediate departures have no separate confirmed last day: the final
    // working date IS the effective separation date.
    CONFIRMED_LAST_WORKING_DATE: c.confirmedLastDay
      ? formatDateOnly(c.confirmedLastDay)
      : c.effectiveSeparationAt
        ? formatDateOnly(c.effectiveSeparationAt)
        : '',
    HANDOVER_DUE_DATE: extras.handoverDueDate
      ? formatDateOnly(extras.handoverDueDate)
      : c.effectiveSeparationAt
        ? formatDateOnly(c.effectiveSeparationAt)
        : '',
    ACCESS_SYSTEMS_SUMMARY: extras.accessSystemsSummary ?? '',
    SURVEY_EXPIRY_NOTE:
      'The survey link is provided separately and expires 14 days after it is sent.',
    MANUAL_NOTE: extras.manualNote ?? '',
  };
}

export const prepareNotificationSchema = z.object({
  notificationType: z.enum(NOTIFICATION_TYPES),
  applicabilityNote: z.string().trim().max(500).optional(),
  manualNote: z.string().trim().max(1000).optional(),
});

/** K.1/K.9/K.10: prepare a draft from the ACTIVE template - never automatic. */
export async function prepareNotification(actor: Actor, caseId: string, rawInput: unknown) {
  const parsed = prepareNotificationSchema.safeParse(rawInput);
  if (!parsed.success)
    throw ServiceError.validation(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  const input = parsed.data;
  const { c, ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'notification.prepare', ctx)) throw ServiceError.forbidden();
  if (!['ACTIVE', 'ON_HOLD', 'CLEARANCE_REVIEW'].includes(c.status))
    throw ServiceError.conflict('Notifications are prepared on active cases.');

  // K.9/K.10: Sagicor/NCB are NOT universally applicable - explicit HR
  // confirmation with a note is required before a record exists.
  if (APPLICABILITY_GATED_TYPES.includes(input.notificationType)) {
    if (!input.applicabilityNote?.trim())
      throw ServiceError.validation([
        'External provider notifications require a recorded applicability confirmation (K.9).',
      ]);
  }

  const prisma = getPrisma();
  const template = await prisma.notificationTemplate.findFirst({
    where: { notificationType: input.notificationType, status: 'ACTIVE' },
  });
  if (!template)
    throw ServiceError.validation([
      `No ACTIVE notification template exists for ${input.notificationType}.`,
    ]);

  const instance = await prisma.workflowInstance.findFirst({
    where: { caseId, status: { in: ['ACTIVE', 'ON_HOLD', 'CLEARANCE_PENDING'] } },
    include: {
      tasks: {
        where: { taskKind: 'ACCESS_REVOCATION' },
        select: { accessSystems: true, dueAt: true },
      },
    },
  });
  const handoverTask = await prisma.workflowTask.findFirst({
    where: { caseId, department: 'LINE_MANAGER', taskCode: { contains: 'HANDOVER' } },
    select: { dueAt: true },
    orderBy: { sortOrder: 'asc' },
  });

  const values = buildFieldValues(c, {
    accessSystemsSummary: instance?.tasks[0]?.accessSystems.join('; '),
    manualNote: input.manualNote,
    handoverDueDate: handoverTask?.dueAt ?? null,
  });
  const subject = substitute(template.subjectTemplate, values);
  const body = substitute(template.bodyTemplate, values);
  if (hasMissingMarkers(subject) || hasMissingMarkers(body))
    throw ServiceError.validation([
      'The case is missing data this notification needs (look for [MISSING:...] markers in the preview).',
    ]);

  const idempotencyKey = notificationIdempotencyKey({
    caseId,
    notificationType: input.notificationType,
    recipientClass: template.recipientClass,
    workflowVersion: instance?.definitionVersion ?? 0,
    effectiveEventAt: c.effectiveSeparationAt,
  });

  // K.11: duplicate prevention via the idempotency key.
  const existing = await prisma.notificationRecord.findUnique({ where: { idempotencyKey } });
  if (existing && existing.status !== 'CANCELLED' && existing.status !== 'SUPERSEDED')
    throw ServiceError.conflict(
      `A ${input.notificationType} notification already exists for this case and effective event.`,
    );

  const correlationId = newCorrelationId();
  return prisma.$transaction(async (tx) => {
    const record = await tx.notificationRecord.create({
      data: {
        caseId,
        notificationType: input.notificationType,
        templateId: template.id,
        templateVersion: template.version,
        recipientClass: template.recipientClass,
        status: 'DRAFT',
        idempotencyKey:
          existing && (existing.status === 'CANCELLED' || existing.status === 'SUPERSEDED')
            ? `${idempotencyKey}:r${Date.now()}`
            : idempotencyKey,
        subjectSnapshot: subject,
        bodySnapshot: body,
        contentChecksum: contentChecksum(`${subject}\n${body}`),
        fieldSnapshot: values,
        applicabilityNote: input.applicabilityNote ?? null,
        ...(APPLICABILITY_GATED_TYPES.includes(input.notificationType)
          ? { applicabilityConfirmedById: actor.userId, applicabilityConfirmedAt: new Date() }
          : {}),
        createdById: actor.userId,
      },
    });
    await appendAudit(tx, {
      eventType: 'NOTIFICATION_PREPARED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'NotificationRecord',
      objectId: record.id,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        notificationType: input.notificationType,
        templateVersion: template.version,
        recipientClass: template.recipientClass,
      },
    });
    return record;
  });
}

const NOTIF_EVENT: Record<NotificationAction, AuditEventType> = {
  submit: 'NOTIFICATION_SUBMITTED',
  approve: 'NOTIFICATION_APPROVED',
  return: 'NOTIFICATION_RETURNED',
  markReady: 'NOTIFICATION_READY',
  recordManualSend: 'NOTIFICATION_MANUALLY_SENT',
  cancel: 'NOTIFICATION_CANCELLED',
  fail: 'NOTIFICATION_FAILED',
  supersede: 'NOTIFICATION_SUPERSEDED',
};

export async function transitionNotification(
  actor: Actor,
  recordId: string,
  action: NotificationAction,
  fields: {
    reason?: string;
    method?: string;
    destinationRef?: string;
    sentNote?: string;
  } = {},
) {
  const prisma = getPrisma();
  const record = await prisma.notificationRecord.findUnique({ where: { id: recordId } });
  if (!record) throw ServiceError.notFound();
  const { ctx } = await loadCaseAccess(actor, record.caseId); // undiscoverable -> NOT_FOUND

  // K.2/K.3: approval authority depends on the recipient class.
  const permission =
    action === 'approve' || action === 'return'
      ? requiresManagerApproval(record.recipientClass)
        ? ('notification.approveExternal' as const)
        : ('notification.approveInternal' as const)
      : action === 'recordManualSend' || action === 'markReady'
        ? ('notification.recordSend' as const)
        : ('notification.prepare' as const);
  if (!canActOnCase(actor, permission, ctx)) throw ServiceError.forbidden();

  const transitionErr = notificationTransitionError(action, record.status, fields.reason);
  if (transitionErr) throw ServiceError.validation([transitionErr]);

  const now = new Date();
  const data: Record<string, unknown> = { rowVersion: { increment: 1 } };
  switch (action) {
    case 'submit':
      data.status = 'PENDING_APPROVAL';
      break;
    case 'approve':
      Object.assign(data, { status: 'APPROVED', approvedById: actor.userId, approvedAt: now });
      break;
    case 'return':
      Object.assign(data, { status: 'DRAFT', invalidationReason: fields.reason });
      break;
    case 'markReady':
      // Fixed default 15: HR approval precedes "ready to send".
      Object.assign(data, { status: 'READY_FOR_MANUAL_SEND', readyAt: now });
      break;
    case 'recordManualSend': {
      const method = fields.method ?? '';
      if (!(MANUAL_SEND_METHODS as readonly string[]).includes(method))
        throw ServiceError.validation(['A valid manual-send method is required.']);
      if (!fields.destinationRef?.trim())
        throw ServiceError.validation([
          'An approved destination reference is required (never a personal address).',
        ]);
      Object.assign(data, {
        status: 'MANUALLY_SENT',
        manualSentById: actor.userId,
        manualSentAt: now,
        sentMethod: method,
        destinationRef: fields.destinationRef.slice(0, 200),
        sentNote: fields.sentNote?.slice(0, 500) ?? null,
      });
      break;
    }
    case 'cancel':
      Object.assign(data, { status: 'CANCELLED', cancelReason: fields.reason });
      break;
    case 'fail':
      Object.assign(data, { status: 'FAILED', failReason: fields.reason });
      break;
    case 'supersede':
      Object.assign(data, { status: 'SUPERSEDED', supersededReason: fields.reason });
      break;
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.notificationRecord.updateMany({
      where: { id: recordId, status: record.status, rowVersion: record.rowVersion },
      data,
    });
    if (updated.count === 0)
      throw ServiceError.conflict('The notification was changed; reload and retry.');
    await appendAudit(tx, {
      eventType: NOTIF_EVENT[action],
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'NotificationRecord',
      objectId: recordId,
      caseId: record.caseId,
      result: 'SUCCESS',
      correlationId: newCorrelationId(),
      // Method + destination REFERENCE only; never an address (K.7).
      metadata: {
        notificationType: record.notificationType,
        action,
        method: fields.method ?? null,
        destinationRef: fields.destinationRef ?? null,
        reason: fields.reason ?? null,
      },
    });
  });
}

/**
 * K.13: TRAINING/TEST records may exercise the capture adapter. The record's
 * status is NOT changed - a capture is not a delivery.
 */
export async function captureNotificationForDev(actor: Actor, recordId: string) {
  const prisma = getPrisma();
  const record = await prisma.notificationRecord.findUnique({
    where: { id: recordId },
    include: { case: { select: { recordPurpose: true } } },
  });
  if (!record) throw ServiceError.notFound();
  const { ctx } = await loadCaseAccess(actor, record.caseId);
  if (!canActOnCase(actor, 'notification.recordSend', ctx)) throw ServiceError.forbidden();
  if (record.case.recordPurpose === 'OPERATIONAL')
    throw ServiceError.validation([
      'The development capture adapter only operates for TRAINING and TEST records (K.13).',
    ]);
  if (record.status !== 'READY_FOR_MANUAL_SEND' && record.status !== 'APPROVED')
    throw ServiceError.conflict('Only approved notifications can be captured.');

  await getDeliveryAdapter().capture(
    recordId,
    record.subjectSnapshot ?? '',
    record.bodySnapshot ?? '',
    'Captured by the DEVELOPMENT adapter. This is NOT an external delivery.',
  );
  await appendAudit(prisma, {
    eventType: 'NOTIFICATION_DEV_CAPTURED',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'NotificationRecord',
    objectId: recordId,
    caseId: record.caseId,
    result: 'SUCCESS',
    correlationId: newCorrelationId(),
    metadata: { notificationType: record.notificationType, adapter: 'dev-capture' },
  });
}

/** Case notification list for authorized viewers. */
export async function listCaseNotifications(actor: Actor, caseId: string) {
  const { c, ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'notification.view', ctx)) throw ServiceError.forbidden();
  const records = await getPrisma().notificationRecord.findMany({
    where: { caseId },
    orderBy: { createdAt: 'desc' },
    include: { captures: { select: { id: true, capturedAt: true, note: true } } },
  });
  return {
    caseNumber: c.caseNumber,
    recordPurpose: c.recordPurpose,
    records,
    canPrepare:
      canActOnCase(actor, 'notification.prepare', ctx) &&
      ['ACTIVE', 'ON_HOLD', 'CLEARANCE_REVIEW'].includes(c.status),
    canApproveInternal: canActOnCase(actor, 'notification.approveInternal', ctx),
    canApproveExternal: canActOnCase(actor, 'notification.approveExternal', ctx),
    canRecordSend: canActOnCase(actor, 'notification.recordSend', ctx),
  };
}

/**
 * K.5: material case changes invalidate affected drafts/approvals. Sent and
 * historical records are untouched. Called from the case-correction ripple.
 */
export async function supersedeNotificationsForCaseChange(caseId: string, reason: string) {
  const prisma = getPrisma();
  const affected = await prisma.notificationRecord.findMany({
    where: {
      caseId,
      status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'READY_FOR_MANUAL_SEND'] },
    },
    select: { id: true, status: true, rowVersion: true },
  });
  for (const r of affected) {
    const updated = await prisma.notificationRecord.updateMany({
      where: { id: r.id, status: r.status, rowVersion: r.rowVersion },
      data: {
        status: 'SUPERSEDED',
        supersededReason: reason,
        approvalInvalidatedAt:
          r.status === 'APPROVED' || r.status === 'READY_FOR_MANUAL_SEND' ? new Date() : null,
        invalidationReason: reason,
        rowVersion: { increment: 1 },
      },
    });
    if (updated.count > 0) {
      await appendAudit(prisma, {
        eventType: 'NOTIFICATION_SUPERSEDED',
        actorType: 'SYSTEM',
        objectType: 'NotificationRecord',
        objectId: r.id,
        caseId,
        result: 'SUCCESS',
        correlationId: newCorrelationId(),
        metadata: { reason, priorStatus: r.status },
      });
    }
  }
  return affected.length;
}

/** Template body validation shared with seeding (deterministic templates). */
export function notificationTemplateErrors(
  type: NotificationType,
  subjectTemplate: string,
  bodyTemplate: string,
): string[] {
  const allowed = NOTIFICATION_PLACEHOLDERS[type];
  const errors = [
    ...templateContentErrors(subjectTemplate, allowed),
    ...templateContentErrors(bodyTemplate, allowed),
  ];
  for (const p of [...extractPlaceholders(subjectTemplate), ...extractPlaceholders(bodyTemplate)]) {
    if (!allowed.includes(p))
      errors.push(`Placeholder ${p} exceeds the minimum-data declaration for ${type} (K.16).`);
  }
  if (NOTIFICATION_RECIPIENT_CLASS[type] === 'EXTERNAL_PROVIDER') {
    // External providers never receive departure details.
    for (const banned of ['reason', 'termination', 'resignation', 'dismiss']) {
      if (bodyTemplate.toLowerCase().includes(banned))
        errors.push(`External-provider template must not mention "${banned}" (minimum data).`);
    }
  }
  return errors;
}
