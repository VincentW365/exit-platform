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
  autoSendBlockers,
  can,
  canActOnCase,
  contentChecksum,
  extractPlaceholders,
  formatDateOnly,
  formatInstant,
  isSendControlLevel,
  maskDestination,
  notificationIdempotencyKey,
  notificationTransitionError,
  recipientEmailErrors,
  resolveSendControl,
  substitute,
  templateContentErrors,
  hasMissingMarkers,
  APPLICABILITY_GATED_TYPES,
  DEFAULT_SEND_CONTROL,
  MANUAL_SEND_METHODS,
  NOTIFICATION_PLACEHOLDERS,
  NOTIFICATION_RECIPIENT_CLASS,
  NOTIFICATION_TYPES,
  type Actor,
  type AuditEventType,
  type NotificationAction,
  type NotificationType,
  type SendControlLevel,
} from '@exit/domain';
import { z } from 'zod';
import { getConfig } from '@exit/config';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { encryptValue } from '../secretBox.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';
import { loadCaseAccess } from './shared.ts';
import { autoResolveException, openException } from './exceptionService.ts';
import { cancelPendingOutboxTx, enqueueOutboxTx, recipientClassForType } from './outboxService.ts';
import { resolveRoute, resolveStaticTo } from './routingService.ts';
import { upsertRecipient } from './recipientService.ts';
import { getSystemConfigValue } from './systemConfigService.ts';

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

/**
 * HR signature block for a case: assigned officer, else the case owner. The
 * signature IMAGE (DEC-067) is added by the outbox to the HTML part; the
 * text block stays name and title only - never typed contact details.
 */
export async function hrSenderFor(caseId: string): Promise<{ name: string; title: string }> {
  const prisma = getPrisma();
  const c = await prisma.offboardingCase.findUnique({
    where: { id: caseId },
    select: { assignedOfficerId: true, ownerId: true },
  });
  const userId = c?.assignedOfficerId ?? c?.ownerId ?? null;
  if (!userId) return { name: '', title: '' };
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { displayName: true, workEmail: true },
  });
  if (!user) return { name: '', title: '' };
  const directory = user.workEmail
    ? await prisma.employeeSourceRecord.findFirst({
        where: { workEmail: user.workEmail },
        select: { jobTitle: true },
      })
    : null;
  return { name: user.displayName, title: directory?.jobTitle ?? 'Human Resources' };
}

// --- per-case notification records -------------------------------------------

function buildFieldValues(
  c: {
    caseNumber: string;
    employeeDisplayName: string;
    employeeSourceId: string;
    employeeNumber?: string | null;
    department: string;
    jobTitle?: string | null;
    effectiveSeparationAt: Date | null;
    confirmedLastDay: Date | null;
  },
  extras: {
    accessSystemsSummary?: string;
    manualNote?: string;
    hrSenderName?: string | null;
    hrSenderTitle?: string | null;
  },
): Record<string, string> {
  return {
    EMPLOYEE_LEGAL_NAME: c.employeeDisplayName,
    EMPLOYEE_FIRST_NAME: c.employeeDisplayName.split(/\s+/)[0] ?? c.employeeDisplayName,
    // The employer's own Employee #. Falls back to nothing rather than to
    // BambooHR's internal record id, which is not an employee number.
    EMPLOYEE_REFERENCE: c.employeeNumber ?? 'Not recorded in BambooHR',
    CASE_REFERENCE: c.caseNumber,
    DEPARTMENT: c.department,
    JOB_TITLE: c.jobTitle ?? '',
    // Signature block from the HR person accountable for the case.
    HR_SENDER_NAME: extras.hrSenderName ?? '',
    HR_SENDER_TITLE: extras.hrSenderTitle ?? '',
    EFFECTIVE_SEPARATION_DATE: c.effectiveSeparationAt
      ? formatDateOnly(c.effectiveSeparationAt)
      : '',
    EFFECTIVE_SEPARATION_TIME: c.effectiveSeparationAt
      ? formatInstant(c.effectiveSeparationAt)
      : '',
    // Immediate departures have no separate confirmed last day: the final
    // working date IS the effective separation date.
    CONFIRMED_LAST_WORKING_DATE: c.confirmedLastDay
      ? formatDateOnly(c.confirmedLastDay)
      : c.effectiveSeparationAt
        ? formatDateOnly(c.effectiveSeparationAt)
        : '',
    // Directive 6.3: v2 workflows carry no ACCESS_REVOCATION task, so the
    // standard access-scope summary applies unless a legacy task narrows it.
    ACCESS_SYSTEMS_SUMMARY:
      extras.accessSystemsSummary ||
      'Network account; Email; Business applications; Building access',
    SURVEY_EXPIRY_NOTE:
      'The survey link is provided separately and expires 14 days after it is sent.',
    MANUAL_NOTE: extras.manualNote ?? '',
    // Directive 6.3 T: the secure confirmation link exists only at dispatch
    // time; the stored snapshot keeps this marker.
    ACKNOWLEDGEMENT_LINK: '[link inserted at send time]',
  };
}

/** Directive 6.3 R/S: resolve the effective control level for one record. */
export async function effectiveSendControl(
  notificationType: NotificationType,
  caseClassification: 'CONFIDENTIAL' | 'RESTRICTED',
): Promise<SendControlLevel> {
  const configured = (await getSystemConfigValue('notifications.sendControl')) as Record<
    string,
    string
  > | null;
  const restrictedOverride = (await getSystemConfigValue(
    'notifications.sendControl.restrictedOverride',
  )) as string | null;
  return resolveSendControl({
    notificationType,
    configured,
    caseClassification,
    restrictedOverride,
  });
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
  const hrSender = await hrSenderFor(caseId);
  const values = buildFieldValues(c, {
    accessSystemsSummary: instance?.tasks[0]?.accessSystems.join('; '),
    manualNote: input.manualNote,
    hrSenderName: hrSender.name,
    hrSenderTitle: hrSender.title,
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

// --- Directive 6.3: derived email actions (K/R) ------------------------------

/** AG safety gates: purpose/cohort/feature-flag - retained above control levels. */
async function dispatchEligibility(caseId: string): Promise<boolean> {
  const prisma = getPrisma();
  const c = await prisma.offboardingCase.findUniqueOrThrow({
    where: { id: caseId },
    select: { recordPurpose: true, measurementCohort: true },
  });
  if (c.recordPurpose !== 'OPERATIONAL') return !getConfig().isProduction;
  if (c.measurementCohort === 'BASELINE') return false;
  const flag = await prisma.featureFlag.findUnique({ where: { key: 'automation.notifications' } });
  return flag?.enabled === true;
}

/**
 * Rules-engine entry point (Directive 6.3 K/R, correction 4): create the
 * notification for a derived email action and release it according to its
 * control level. Routine internal emails require ZERO HR clicks; HR
 * intervenes only through exceptions. Idempotent per case+type+event.
 */
export async function prepareDerivedNotification(args: {
  caseId: string;
  notificationType: NotificationType;
  derivedActionId: string;
  scheduledSendAt: Date | null;
  now: Date;
}): Promise<{ recordId: string | null; state: string }> {
  const prisma = getPrisma();
  const c = await prisma.offboardingCase.findUniqueOrThrow({ where: { id: args.caseId } });

  const template = await prisma.notificationTemplate.findFirst({
    where: { notificationType: args.notificationType, status: 'ACTIVE' },
  });
  const instance = await prisma.workflowInstance.findFirst({
    where: { caseId: args.caseId, status: { in: ['ACTIVE', 'ON_HOLD', 'CLEARANCE_PENDING'] } },
    include: {
      tasks: { where: { taskKind: 'ACCESS_REVOCATION' }, select: { accessSystems: true } },
    },
  });
  const hrSender = await hrSenderFor(args.caseId);
  const values = buildFieldValues(c, {
    accessSystemsSummary: instance?.tasks[0]?.accessSystems.join('; '),
    hrSenderName: hrSender.name,
    hrSenderTitle: hrSender.title,
  });

  // Centralized routing (email routing directive): the routing table says
  // which destinations this notification type is addressed to, and this turns
  // them into addresses. Static destinations come from the approved recipient
  // directory; dynamic ones (this employee's manager, the assigned officer)
  // come from the case. Nothing here names a mailbox.
  const routed = await resolveRoute(args.notificationType, {
    caseId: c.id,
    employeeSourceSystem: c.employeeSourceSystem,
    employeeWorkEmail: c.employeeWorkEmail,
    employeeDisplayName: c.employeeDisplayName,
    managerSourceId: c.managerSourceId,
    assignedOfficerId: c.assignedOfficerId,
    ownerId: c.ownerId,
  });
  // A per-case address (a manager, the employee) is held encrypted on the
  // record; a directory mailbox is referenced by its configuration row.
  const perCaseRecipient =
    routed.to && !routed.to.recipientConfigId
      ? { email: routed.to.email, name: routed.to.displayName }
      : null;
  const recipientClass =
    template?.recipientClass ?? NOTIFICATION_RECIPIENT_CLASS[args.notificationType];
  const idempotencyKey = notificationIdempotencyKey({
    caseId: args.caseId,
    notificationType: args.notificationType,
    recipientClass,
    workflowVersion: instance?.definitionVersion ?? 0,
    effectiveEventAt: c.effectiveSeparationAt,
  });

  // Idempotent re-derivation: a live record for the same event is reused.
  const existing = await prisma.notificationRecord.findUnique({ where: { idempotencyKey } });
  if (existing && existing.status !== 'CANCELLED' && existing.status !== 'SUPERSEDED') {
    return { recordId: existing.id, state: 'EXISTING' };
  }

  const controlLevel = await effectiveSendControl(
    args.notificationType,
    c.classification as 'CONFIDENTIAL' | 'RESTRICTED',
  );

  if (!template) {
    await openException(args.caseId, {
      exceptionType: 'AUTO_SEND_BLOCKED',
      severity: 'HIGH',
      title: `No active template for ${args.notificationType.replaceAll('_', ' ').toLowerCase()}`,
      detail:
        'The derived notification cannot be prepared until an ACTIVE template exists. Activate a template under Administration → Notification templates.',
      refType: 'CaseRequiredAction',
      refId: args.derivedActionId,
      ownerDepartment: 'HR',
    });
    return { recordId: null, state: 'BLOCKED_NO_TEMPLATE' };
  }

  const subject = substitute(template.subjectTemplate, values);
  const body = substitute(template.bodyTemplate, values);

  // The configuration row behind a static destination, for display and for
  // the enqueue path. A dynamic destination has none by definition.
  const recipientRow = routed.to?.recipientConfigId
    ? await prisma.recipientConfig.findUnique({ where: { id: routed.to.recipientConfigId } })
    : null;
  const routeCc = routed.cc;
  const routeBcc = routed.bcc;

  const correlationId = newCorrelationId();
  const record = await prisma.$transaction(async (tx) => {
    const row = await tx.notificationRecord.create({
      data: {
        caseId: args.caseId,
        notificationType: args.notificationType,
        templateId: template.id,
        templateVersion: template.version,
        recipientClass,
        status: 'DRAFT',
        idempotencyKey:
          existing && (existing.status === 'CANCELLED' || existing.status === 'SUPERSEDED')
            ? `${idempotencyKey}:r${args.now.getTime()}`
            : idempotencyKey,
        subjectSnapshot: subject,
        bodySnapshot: body,
        contentChecksum: contentChecksum(`${subject}\n${body}`),
        fieldSnapshot: values,
        origin: 'DERIVED',
        derivedActionId: args.derivedActionId,
        controlLevel,
        scheduledSendAt: args.scheduledSendAt,
        recipientConfigId: perCaseRecipient ? null : (recipientRow?.id ?? null),
        recipientName:
          perCaseRecipient?.name ?? recipientRow?.contactName ?? recipientRow?.displayName ?? null,
        recipientOrg: recipientRow?.organizationName ?? null,
        recipientKind: perCaseRecipient
          ? 'INTERNAL'
          : recipientRow
            ? recipientRow.isExternal
              ? 'EXTERNAL'
              : 'INTERNAL'
            : null,
        caseRecipientCiphertext: perCaseRecipient ? encryptValue(perCaseRecipient.email) : null,
        caseRecipientMask: perCaseRecipient ? maskDestination(perCaseRecipient.email) : null,
        ccCiphertext: routeCc.length
          ? encryptValue(JSON.stringify(routeCc.map((r) => r.email)))
          : null,
        ccNames: routeCc.map((r) => r.displayName ?? r.label),
        ccMasks: routeCc.map((r) => maskDestination(r.email)),
        bccCiphertext: routeBcc.length
          ? encryptValue(JSON.stringify(routeBcc.map((r) => r.email)))
          : null,
        bccNames: routeBcc.map((r) => r.displayName ?? r.label),
        bccMasks: routeBcc.map((r) => maskDestination(r.email)),
        applicabilityNote: APPLICABILITY_GATED_TYPES.includes(args.notificationType)
          ? 'Derived from the confirmed benefits applicability on the case (Directive 6.3 V).'
          : null,
        ...(APPLICABILITY_GATED_TYPES.includes(args.notificationType) && c.benefitsConfirmedById
          ? {
              applicabilityConfirmedById: c.benefitsConfirmedById,
              applicabilityConfirmedAt: c.benefitsConfirmedAt,
            }
          : {}),
        createdById: c.ownerId,
      },
    });
    await appendAudit(tx, {
      eventType: 'NOTIFICATION_AUTO_PREPARED',
      actorType: 'SYSTEM',
      objectType: 'NotificationRecord',
      objectId: row.id,
      caseId: args.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        notificationType: args.notificationType,
        templateVersion: template.version,
        controlLevel,
        ruleKey: 'derived-action',
        scheduledSendAt: args.scheduledSendAt?.toISOString() ?? null,
      },
    });
    // Move to the review queue; the state order itself never relaxes.
    await tx.notificationRecord.update({
      where: { id: row.id },
      data: { status: 'PENDING_APPROVAL', rowVersion: { increment: 1 } },
    });
    return row;
  });

  // Missing recipient is an actionable HR exception - never a silent skip
  // and never a meaningless dropdown (correction 5).
  if (!routed.to) {
    await openException(args.caseId, {
      exceptionType: 'RECIPIENT_MISSING',
      severity: 'HIGH',
      title: `Recipient required: ${subject.slice(0, 80)}`,
      // The routing table already knows WHICH destination failed, so the
      // exception can say so instead of offering a generic apology.
      detail:
        routed.unresolved.join(' ') ||
        'No approved recipient is configured for this notification. Enter one on the case (this case only) or save an approved recipient for future cases.',
      refType: 'NotificationRecord',
      refId: record.id,
      ownerDepartment: 'HR',
    });
    return { recordId: record.id, state: 'RECIPIENT_REQUIRED' };
  }

  if (controlLevel !== 'AUTO_SEND') {
    // HR_REVIEW_THEN_SEND: waits in "Needs your review" - the HR person
    // executing the approved case releases it to the outbox (DEC-066).
    return { recordId: record.id, state: 'AWAITING_REVIEW' };
  }

  const released = await attemptAutoRelease(record.id, args.now);
  return { recordId: record.id, state: released ? 'AUTO_RELEASED' : 'BLOCKED' };
}

/**
 * AUTO_SEND release (Directive R): approve + enqueue with no human actor when
 * every condition holds; otherwise an actionable exception. SYSTEM-actor
 * audit events keep automation MORE auditable, not less (AB).
 */
export async function attemptAutoRelease(recordId: string, now: Date): Promise<boolean> {
  const prisma = getPrisma();
  const record = await prisma.notificationRecord.findUnique({
    where: { id: recordId },
    include: { case: { select: { classification: true, recordPurpose: true } } },
  });
  if (!record || record.status !== 'PENDING_APPROVAL') return false;

  const controlLevel = isSendControlLevel(record.controlLevel)
    ? record.controlLevel
    : DEFAULT_SEND_CONTROL[record.notificationType];
  const template = await prisma.notificationTemplate.findFirst({
    where: { notificationType: record.notificationType, status: 'ACTIVE' },
  });
  // A per-case recipient (an HR-entered address, or the manager this notice
  // is addressed to) always wins over the shared directory mailbox.
  // Centralized routing decides whether a shared mailbox is even the right
  // answer: a route addressed to a PERSON on this case has no department
  // inbox to fall back to, so an unresolved one stays unresolved rather than
  // quietly posting someone's departure to a shared address.
  const routeResolved = await resolveStaticTo(record.notificationType);
  const resolved = record.caseRecipientCiphertext
    ? { id: null, destinationMask: record.caseRecipientMask ?? '(case recipient)' }
    : 'reason' in routeResolved
      ? { reason: 'NO_RECIPIENT' as const }
      : routeResolved;
  const recipientResolved = 'destination' in resolved || !!record.caseRecipientCiphertext;

  const blockers = autoSendBlockers({
    controlLevel,
    recipientResolved,
    recipientApprovedAndVerified: 'destination' in resolved || !!record.caseRecipientCiphertext,
    templateActive: !!template,
    bodyComplete:
      !hasMissingMarkers(record.subjectSnapshot ?? '') &&
      !hasMissingMarkers(record.bodySnapshot ?? ''),
    applicabilityConfirmed: APPLICABILITY_GATED_TYPES.includes(record.notificationType)
      ? record.applicabilityConfirmedAt !== null
      : true,
  });
  if (!(await dispatchEligibility(record.caseId))) {
    blockers.push('Automation is not enabled for this record purpose/cohort.');
  }
  if (blockers.length > 0) {
    await openException(record.caseId, {
      exceptionType: 'AUTO_SEND_BLOCKED',
      severity: 'WARNING',
      title: `Automatic sending blocked: ${(record.subjectSnapshot ?? record.notificationType).slice(0, 80)}`,
      detail: `The notification stays in review until resolved: ${blockers.join(' ')}`,
      refType: 'NotificationRecord',
      refId: record.id,
      ownerDepartment: 'HR',
    });
    return false;
  }

  const enqueueRecipient =
    'destination' in resolved
      ? { id: resolved.id, destinationMask: resolved.destinationMask }
      : { id: null, destinationMask: record.caseRecipientMask ?? '(case recipient)' };
  const instance = await prisma.workflowInstance.findFirst({
    where: { caseId: record.caseId },
    orderBy: { activatedAt: 'desc' },
    select: { definitionVersion: true },
  });
  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    const u = await tx.notificationRecord.updateMany({
      where: { id: record.id, status: 'PENDING_APPROVAL', rowVersion: record.rowVersion },
      data: { status: 'APPROVED', approvedAt: now, rowVersion: { increment: 1 } },
    });
    if (u.count === 0) throw ServiceError.conflict('The record changed during auto-release.');
    await enqueueOutboxTx(
      tx,
      record,
      enqueueRecipient,
      instance?.definitionVersion ?? 0,
      null,
      correlationId,
      record.scheduledSendAt && record.scheduledSendAt.getTime() > now.getTime()
        ? record.scheduledSendAt
        : null,
    );
    await appendAudit(tx, {
      eventType: 'NOTIFICATION_AUTO_APPROVED',
      actorType: 'SYSTEM',
      objectType: 'NotificationRecord',
      objectId: record.id,
      caseId: record.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        notificationType: record.notificationType,
        controlLevel,
        scheduledSendAt: record.scheduledSendAt?.toISOString() ?? null,
      },
    });
  });
  await autoResolveException(
    record.caseId,
    'AUTO_SEND_BLOCKED',
    record.id,
    'Automatic sending conditions satisfied.',
  );
  return true;
}

export const caseRecipientSchema = z.object({
  recipientName: z.string().trim().min(1).max(200),
  organization: z.string().trim().min(1).max(200),
  email: z.string().trim().min(3).max(320),
  saveForFuture: z.boolean().default(false),
});

/**
 * Directive 6.3 O (correction 6): HR enters a missing recipient for THIS
 * case without HR-Manager approval; saving for future cases goes through the
 * controlled directory lifecycle (approval + verification).
 */
export async function setCaseRecipient(actor: Actor, recordId: string, rawInput: unknown) {
  const parsed = caseRecipientSchema.safeParse(rawInput);
  if (!parsed.success)
    throw ServiceError.validation(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  const input = parsed.data;
  const prisma = getPrisma();
  const record = await prisma.notificationRecord.findUnique({ where: { id: recordId } });
  if (!record) throw ServiceError.notFound();
  const { ctx } = await loadCaseAccess(actor, record.caseId);
  if (!canActOnCase(actor, 'notification.enterRecipient', ctx)) throw ServiceError.forbidden();
  if (
    [
      'MANUALLY_SENT',
      'SENT',
      'ACKNOWLEDGED',
      'CONFIRMED_COMPLETE',
      'CANCELLED',
      'SUPERSEDED',
    ].includes(record.status)
  )
    throw ServiceError.conflict('The notification is already sent or closed.');

  const errors = recipientEmailErrors({
    email: input.email,
    name: input.recipientName,
    organization: input.organization,
  });
  // Environment discipline: development recipients stay non-deliverable.
  const { destinationErrors } = await import('@exit/domain');
  errors.push(
    ...destinationErrors(input.email, getConfig().isProduction ? 'production' : 'development'),
  );
  if (errors.length) throw ServiceError.validation(errors);

  const recipientClass = NOTIFICATION_RECIPIENT_CLASS[record.notificationType];
  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    const u = await tx.notificationRecord.updateMany({
      where: { id: recordId, rowVersion: record.rowVersion },
      data: {
        recipientName: input.recipientName,
        recipientOrg: input.organization,
        recipientKind: recipientClass === 'INTERNAL_DEPARTMENT' ? 'INTERNAL' : 'EXTERNAL',
        caseRecipientCiphertext: encryptValue(input.email),
        caseRecipientMask: maskDestination(input.email),
        rowVersion: { increment: 1 },
      },
    });
    if (u.count === 0) throw ServiceError.conflict('The record changed; reload and retry.');
    await appendAudit(tx, {
      eventType: 'NOTIFICATION_RECIPIENT_SET',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'NotificationRecord',
      objectId: recordId,
      caseId: record.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        scope: 'CASE_ONLY',
        destinationMask: maskDestination(input.email),
        organization: input.organization,
      },
    });
  });
  await autoResolveException(
    record.caseId,
    'RECIPIENT_MISSING',
    recordId,
    'HR entered a recipient for this case.',
  );

  // SAVE FOR FUTURE USE: controlled directory entry (authority + audit).
  if (input.saveForFuture) {
    if (!can(actor, 'recipients.editBusiness')) {
      throw ServiceError.forbidden(
        'Saving a recipient for future cases requires recipient-directory authority.',
      );
    }
    await upsertRecipient(actor, {
      recipientClass: recipientClassForType(record.notificationType),
      displayName: `${input.organization} — ${input.recipientName}`,
      destination: input.email,
      allowedTypes: [record.notificationType],
      changeReason: `Entered from case notification ${recordId} (save for future cases).`,
      organizationName: input.organization,
      contactName: input.recipientName,
    });
  }

  // A now-complete AUTO_SEND record may release immediately.
  if (record.origin === 'DERIVED' && record.status === 'PENDING_APPROVAL') {
    await attemptAutoRelease(recordId, new Date());
  }
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
  markSent: 'NOTIFICATION_SENT',
  acknowledge: 'NOTIFICATION_ACKNOWLEDGED',
  confirmComplete: 'NOTIFICATION_COMPLETION_CONFIRMED',
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

  // The automated evidence chain has dedicated writers (outbox dispatch,
  // token redemption, HR-recorded evidence) - never this human path.
  if (action === 'markSent' || action === 'acknowledge' || action === 'confirmComplete')
    throw ServiceError.validation(['This transition is recorded by the system, not manually.']);

  // DEC-066 (single authorization gate): the HR Manager approved the case,
  // and that approval covered every communication the plan showed -
  // external providers and the employee included. Releasing one is the
  // operational work of the HR person executing the case, whatever the
  // recipient class or the (possibly legacy) control level says.
  const permission =
    action === 'approve' || action === 'return'
      ? ('notification.approveInternal' as const)
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

  // Stage 4 (Directive 4 B.1): automatic dispatch eligibility is resolved
  // BEFORE the transaction; the outbox row is created INSIDE it.
  let enqueueRecipient: { id: string | null; destinationMask: string } | null = null;
  let workflowVersion = 0;
  if (action === 'approve') {
    // Fixed defaults 4-6 (AG): TEST/TRAINING may use the capture provider;
    // OPERATIONAL requires the notifications flag AND never BASELINE (live
    // activation is additionally pilot-gated at startup/provider level).
    if (await dispatchEligibility(record.caseId)) {
      // Routing decides the mailbox; a per-case address still wins below.
      const resolved = await resolveStaticTo(record.notificationType);
      if ('destination' in resolved) {
        enqueueRecipient = { id: resolved.id, destinationMask: resolved.destinationMask };
      } else if (record.caseRecipientCiphertext) {
        // Directive 6.3 O: the HR-entered case-only recipient dispatches too.
        enqueueRecipient = {
          id: null,
          destinationMask: record.caseRecipientMask ?? '(case recipient)',
        };
      }
      if (enqueueRecipient) {
        const instance = await prisma.workflowInstance.findFirst({
          where: { caseId: record.caseId },
          orderBy: { activatedAt: 'desc' },
          select: { definitionVersion: true },
        });
        workflowVersion = instance?.definitionVersion ?? 0;
      }
    }
  }

  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    const updated = await tx.notificationRecord.updateMany({
      where: { id: recordId, status: record.status, rowVersion: record.rowVersion },
      data,
    });
    if (updated.count === 0)
      throw ServiceError.conflict('The notification was changed; reload and retry.');

    if (action === 'approve' && enqueueRecipient) {
      const scheduledAt =
        record.scheduledSendAt && record.scheduledSendAt.getTime() > now.getTime()
          ? record.scheduledSendAt
          : null;
      await enqueueOutboxTx(
        tx,
        record,
        enqueueRecipient,
        workflowVersion,
        actor,
        correlationId,
        scheduledAt,
      );
    }
    if (action === 'recordManualSend' || action === 'cancel') {
      // B.8/B.9: manual sending or cancellation stops automatic dispatch.
      await cancelPendingOutboxTx(
        tx,
        record.id,
        action === 'recordManualSend' ? 'manually sent' : 'notification cancelled',
      );
    }

    await appendAudit(tx, {
      eventType: NOTIF_EVENT[action],
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'NotificationRecord',
      objectId: recordId,
      caseId: record.caseId,
      result: 'SUCCESS',
      correlationId,
      // Method + destination REFERENCE only; never an address (K.7).
      metadata: {
        notificationType: record.notificationType,
        action,
        method: fields.method ?? null,
        destinationRef: fields.destinationRef ?? null,
        reason: fields.reason ?? null,
        autoDispatchEnqueued: action === 'approve' ? enqueueRecipient !== null : undefined,
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
    include: {
      captures: { select: { id: true, capturedAt: true, note: true } },
      // What actually travelled with the message, so the communications trail
      // answers "who was copied" and "what was attached" without a query.
      attachedDocument: {
        select: { id: true, documentType: true, version: true, pdfChecksum: true },
      },
    },
  });
  return {
    caseNumber: c.caseNumber,
    recordPurpose: c.recordPurpose,
    records,
    canPrepare:
      canActOnCase(actor, 'notification.prepare', ctx) &&
      ['ACTIVE', 'ON_HOLD', 'CLEARANCE_REVIEW'].includes(c.status),
    canApproveInternal: canActOnCase(actor, 'notification.approveInternal', ctx),
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
