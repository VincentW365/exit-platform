/**
 * Transactional notification outbox (Directive 4 section B).
 *
 * The outbox record is created in the SAME transaction as the notification
 * approval, so an approved notification can never be lost between approval
 * and dispatch (B.1/B.2). Workers claim idempotently; duplicates are
 * impossible via the unique idempotency key (B.7); manual sending cancels
 * pending automatic dispatch in the same transaction (B.8).
 */
import {
  backoffDelayMs,
  can,
  isRetryableError,
  ProviderError,
  OUTBOX_MAX_ATTEMPTS,
  type Actor,
  type RecipientClassName,
} from '@exit/domain';
import { getConfig } from '@exit/config';
import { getPrisma } from '../client.ts';
import type { PrismaClient } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';
import { getEmailProvider } from './emailProviders.ts';
import { decryptValue } from '../secretBox.ts';
import { openException, autoResolveException } from './exceptionService.ts';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/** Map notification-record types to directory recipient classes. */
const TYPE_TO_RECIPIENT_CLASS: Record<string, RecipientClassName> = {
  IT_ACCESS_REMOVAL: 'IT_OFFBOARDING',
  FINANCE_OFFBOARDING: 'FINANCE_OFFBOARDING',
  LINE_MANAGER_HANDOVER: 'LINE_MANAGER',
  SAGICOR_GROUP_HEALTH_REMOVAL: 'SAGICOR_GROUP_HEALTH',
  NCB_GROUP_LIFE_REMOVAL: 'NCB_GROUP_LIFE',
  SURVEY_INVITATION_REFERENCE: 'EMPLOYEE_PERSONAL',
  MANUAL_EXCEPTION_NOTIFICATION: 'EMPLOYEE_PERSONAL',
};

export function recipientClassForType(notificationType: string): RecipientClassName {
  return TYPE_TO_RECIPIENT_CLASS[notificationType] ?? 'HR_OFFBOARDING';
}

/**
 * Called INSIDE the notification-approval transaction (B.1). Enqueues only
 * when a usable recipient configuration exists; otherwise dispatch stays
 * manual and the reason is returned for the caller to surface.
 */
export async function enqueueOutboxTx(
  tx: Tx,
  record: {
    id: string;
    caseId: string;
    notificationType: string;
    templateVersion: number;
    subjectSnapshot: string | null;
    contentChecksum: string | null;
    idempotencyKey: string;
  },
  recipient: { id: string; destinationMask: string },
  workflowVersion: number,
  actor: Actor,
  correlationId: string,
): Promise<string> {
  const provider = getConfig().EMAIL_MODE;
  const outbox = await tx.notificationOutbox.create({
    data: {
      notificationRecordId: record.id,
      provider,
      recipientClass: recipientClassForType(record.notificationType),
      recipientConfigId: recipient.id,
      destinationMask: recipient.destinationMask,
      subjectSnapshot: record.subjectSnapshot ?? '',
      contentChecksum: record.contentChecksum ?? '',
      templateVersion: record.templateVersion,
      workflowVersion,
      idempotencyKey: `outbox:${record.idempotencyKey}`,
      correlationId,
    },
  });
  await appendAudit(tx, {
    eventType: 'OUTBOX_ENQUEUED',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'NotificationOutbox',
    objectId: outbox.id,
    caseId: record.caseId,
    result: 'SUCCESS',
    correlationId,
    metadata: {
      notificationType: record.notificationType,
      provider,
      destinationMask: recipient.destinationMask,
    },
  });
  return outbox.id;
}

/** B.8: manual sending cancels any pending automatic dispatch - same tx. */
export async function cancelPendingOutboxTx(
  tx: Tx,
  notificationRecordId: string,
  reason: string,
): Promise<number> {
  const cancelled = await tx.notificationOutbox.updateMany({
    where: { notificationRecordId, status: { in: ['PENDING', 'FAILED_RETRYABLE'] } },
    data: { status: 'CANCELLED', cancelReason: reason, rowVersion: { increment: 1 } },
  });
  return cancelled.count;
}

/** B.9: authorized cancellation before provider submission. */
export async function cancelOutbox(actor: Actor, outboxId: string, reason: string) {
  if (!can(actor, 'outbox.view')) throw ServiceError.forbidden();
  if (!reason.trim()) throw ServiceError.validation(['A reason is required.']);
  const prisma = getPrisma();
  const cancelled = await prisma.notificationOutbox.updateMany({
    where: { id: outboxId, status: { in: ['PENDING', 'FAILED_RETRYABLE', 'CLAIMED'] } },
    data: { status: 'CANCELLED', cancelReason: reason, rowVersion: { increment: 1 } },
  });
  if (cancelled.count === 0)
    throw ServiceError.conflict('The record is no longer cancellable (already submitted?).');
  await appendAudit(prisma, {
    eventType: 'OUTBOX_CANCELLED',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'NotificationOutbox',
    objectId: outboxId,
    result: 'SUCCESS',
    correlationId: newCorrelationId(),
    metadata: { reason },
  });
}

/**
 * Worker pass (B.3): claim due records idempotently and dispatch through the
 * configured provider. `random` is injectable for deterministic backoff in
 * tests. Records for OPERATIONAL cases dispatch only when live automation is
 * active for the record's cohort - enforced at enqueue time.
 */
export async function processOutbox(
  now: Date = new Date(),
  random: () => number = Math.random,
): Promise<{ submitted: number; failed: number; deadLettered: number }> {
  const prisma = getPrisma();
  const provider = getEmailProvider();
  const result = { submitted: 0, failed: 0, deadLettered: 0 };

  const due = await prisma.notificationOutbox.findMany({
    where: { status: { in: ['PENDING', 'FAILED_RETRYABLE'] }, nextAttemptAt: { lte: now } },
    orderBy: { scheduledAt: 'asc' },
    take: 20,
    include: {
      notificationRecord: {
        select: { id: true, caseId: true, bodySnapshot: true, status: true },
      },
    },
  });

  for (const item of due) {
    // Safe idempotent claim: only one worker wins the row.
    const claimed = await prisma.notificationOutbox.updateMany({
      where: { id: item.id, status: item.status, rowVersion: item.rowVersion },
      data: {
        status: 'CLAIMED',
        claimedAt: now,
        attempts: { increment: 1 },
        rowVersion: { increment: 1 },
      },
    });
    if (claimed.count === 0) continue;
    const attempt = item.attempts + 1;

    // A notification manually sent or cancelled after enqueue never
    // dispatches automatically (B.8).
    if (
      item.notificationRecord.status === 'MANUALLY_SENT' ||
      item.notificationRecord.status === 'CANCELLED'
    ) {
      await prisma.notificationOutbox.updateMany({
        where: { id: item.id, status: 'CLAIMED' },
        data: {
          status: 'CANCELLED',
          cancelReason: `notification is ${item.notificationRecord.status}`,
          rowVersion: { increment: 1 },
        },
      });
      continue;
    }

    try {
      let destination = '';
      if (item.recipientConfigId) {
        const rc = await prisma.recipientConfig.findUnique({
          where: { id: item.recipientConfigId },
        });
        if (!rc || !rc.active || rc.approvalStatus !== 'APPROVED' || !rc.verifiedAt) {
          throw new ProviderError('RECIPIENT_INVALID', 'Recipient configuration is unusable.');
        }
        destination = decryptValue(rc.destinationCiphertext);
      } else {
        throw new ProviderError('RECIPIENT_INVALID', 'No recipient configuration recorded.');
      }

      const sendResult = await provider.send({
        outboxId: item.id,
        subject: item.subjectSnapshot,
        body: item.notificationRecord.bodySnapshot ?? '',
        destination,
        correlationId: item.correlationId,
      });

      await prisma.notificationOutbox.updateMany({
        where: { id: item.id, status: 'CLAIMED' },
        data: {
          status: 'SUBMITTED',
          submittedAt: now,
          providerMessageRef: sendResult.providerMessageRef,
          // CAPTURED (dev) or SUBMITTED - never DELIVERED without provider
          // delivery evidence (B.5/B.6).
          deliveryStatus: sendResult.deliveryStatus,
          lastErrorCode: null,
          rowVersion: { increment: 1 },
        },
      });
      await appendAudit(prisma, {
        eventType: 'OUTBOX_SUBMITTED',
        actorType: 'SYSTEM',
        objectType: 'NotificationOutbox',
        objectId: item.id,
        caseId: item.notificationRecord.caseId,
        result: 'SUCCESS',
        correlationId: item.correlationId,
        metadata: {
          provider: provider.mode,
          deliveryStatus: sendResult.deliveryStatus,
          attempt,
        },
      });
      await autoResolveException(
        item.notificationRecord.caseId,
        'NOTIFICATION_FAILED',
        item.id,
        'Outbox record dispatched.',
      );
      result.submitted += 1;
    } catch (e) {
      const code = e instanceof ProviderError ? e.code : 'NETWORK_ERROR';
      const retryable = isRetryableError(code);
      const exhausted = attempt >= OUTBOX_MAX_ATTEMPTS;
      const nextStatus =
        retryable && !exhausted
          ? 'FAILED_RETRYABLE'
          : exhausted && retryable
            ? 'DEAD_LETTER'
            : 'FAILED_PERMANENT';
      const retryAfter =
        e instanceof ProviderError && e.retryAfterMs !== undefined
          ? e.retryAfterMs
          : backoffDelayMs(attempt, random);
      await prisma.notificationOutbox.updateMany({
        where: { id: item.id, status: 'CLAIMED' },
        data: {
          status: nextStatus,
          lastErrorCode: code,
          nextAttemptAt: new Date(now.getTime() + retryAfter),
          rowVersion: { increment: 1 },
        },
      });
      await appendAudit(prisma, {
        eventType: 'OUTBOX_FAILED',
        actorType: 'SYSTEM',
        objectType: 'NotificationOutbox',
        objectId: item.id,
        caseId: item.notificationRecord.caseId,
        result: 'FAILURE',
        correlationId: item.correlationId,
        metadata: { errorCode: code, attempt, nextStatus },
      });
      if (nextStatus === 'DEAD_LETTER' || nextStatus === 'FAILED_PERMANENT') {
        // B.10: failed records surface in the exception feed.
        await openException(item.notificationRecord.caseId, {
          exceptionType: 'NOTIFICATION_FAILED',
          severity: 'HIGH',
          title: `Notification dispatch ${nextStatus === 'DEAD_LETTER' ? 'dead-lettered' : 'failed permanently'}`,
          detail: `Outbox ${item.id}; error ${code}; ${attempt} attempt(s). Authorized resolution required.`,
          refType: 'NotificationOutbox',
          refId: item.id,
          ownerDepartment: 'HR',
        });
        result.deadLettered += 1;
      } else {
        result.failed += 1;
      }
    }
  }
  return result;
}

/** B.12: audited manual retry of a failed/dead-lettered record. */
export async function retryOutbox(actor: Actor, outboxId: string, reason: string) {
  if (!can(actor, 'outbox.resolve')) throw ServiceError.forbidden();
  if (!reason.trim()) throw ServiceError.validation(['A reason is required.']);
  const prisma = getPrisma();
  const updated = await prisma.notificationOutbox.updateMany({
    where: {
      id: outboxId,
      status: { in: ['FAILED_RETRYABLE', 'FAILED_PERMANENT', 'DEAD_LETTER'] },
    },
    data: {
      status: 'PENDING',
      nextAttemptAt: new Date(),
      attempts: 0,
      lastErrorCode: null,
      rowVersion: { increment: 1 },
    },
  });
  if (updated.count === 0) throw ServiceError.conflict('The record is not retryable.');
  await appendAudit(prisma, {
    eventType: 'OUTBOX_RETRIED',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'NotificationOutbox',
    objectId: outboxId,
    result: 'SUCCESS',
    correlationId: newCorrelationId(),
    metadata: { reason },
  });
}

/** B.11: dead-letter records need authorized resolution evidence. */
export async function resolveDeadLetter(actor: Actor, outboxId: string, resolution: string) {
  if (!can(actor, 'outbox.resolve')) throw ServiceError.forbidden();
  if (!resolution.trim()) throw ServiceError.validation(['A resolution note is required.']);
  const prisma = getPrisma();
  const row = await prisma.notificationOutbox.findUnique({ where: { id: outboxId } });
  if (!row) throw ServiceError.notFound();
  if (row.status !== 'DEAD_LETTER' && row.status !== 'FAILED_PERMANENT')
    throw ServiceError.conflict(
      'Only dead-lettered or permanently failed records need resolution.',
    );
  await prisma.notificationOutbox.updateMany({
    where: { id: outboxId, rowVersion: row.rowVersion },
    data: {
      resolvedById: actor.userId,
      resolvedAt: new Date(),
      resolutionNote: resolution,
      rowVersion: { increment: 1 },
    },
  });
  await appendAudit(prisma, {
    eventType: 'OUTBOX_DEAD_LETTER_RESOLVED',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'NotificationOutbox',
    objectId: outboxId,
    result: 'SUCCESS',
    correlationId: newCorrelationId(),
    metadata: { resolution },
  });
}

/** Outbox monitor (masked destinations only). */
export async function listOutbox(actor: Actor, filter: { status?: string } = {}) {
  if (!can(actor, 'outbox.view')) throw ServiceError.forbidden();
  return getPrisma().notificationOutbox.findMany({
    where: filter.status ? { status: filter.status as never } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      notificationRecord: {
        select: { notificationType: true, case: { select: { caseNumber: true } } },
      },
    },
  });
}
