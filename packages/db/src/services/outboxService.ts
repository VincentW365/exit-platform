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
  applyTestModeRedirect,
  backoffDelayMs,
  can,
  isRetryableError,
  maskDestination,
  parseTestMode,
  renderEmailHtml,
  testModeErrors,
  ProviderError,
  OUTBOX_MAX_ATTEMPTS,
  type Actor,
  type RecipientClassName,
  type TestModeConfig,
} from '@exit/domain';
import { getConfig } from '@exit/config';
import { getPrisma } from '../client.ts';
import type { PrismaClient } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';
import { getEmailProvider, type OutboundAttachment } from './emailProviders.ts';
import { resolveEmailBannerForNotification } from './emailBannerService.ts';
import { tryDecryptValue } from '../secretBox.ts';
import { openException, autoResolveException } from './exceptionService.ts';
import { getSystemConfigValue } from './systemConfigService.ts';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

/** Map notification-record types to directory recipient classes. */
const TYPE_TO_RECIPIENT_CLASS: Record<string, RecipientClassName> = {
  IT_ACCESS_REMOVAL: 'IT_OFFBOARDING',
  FINANCE_OFFBOARDING: 'FINANCE_OFFBOARDING',
  LINE_MANAGER_HANDOVER: 'LINE_MANAGER',
  RETURN_ITEMS_CHECKLIST: 'HR_OFFBOARDING',
  RESIGNATION_ACCEPTANCE_LETTER: 'EMPLOYEE_PERSONAL',
  SAGICOR_GROUP_HEALTH_REMOVAL: 'SAGICOR_GROUP_HEALTH',
  NCB_GROUP_LIFE_REMOVAL: 'NCB_GROUP_LIFE',
  SURVEY_INVITATION_REFERENCE: 'EMPLOYEE_PERSONAL',
  // DEC-068: the signer is normally the departing employee.
  SIGNATURE_REQUEST: 'EMPLOYEE_PERSONAL',
  MANUAL_EXCEPTION_NOTIFICATION: 'EMPLOYEE_PERSONAL',
  // Directive 6.3 N: configurable provider purposes.
  PAYROLL_OR_BANK_NOTIFICATION: 'PAYROLL_BANK',
  OTHER_EXTERNAL_OFFBOARDING_NOTIFICATION: 'OTHER_APPROVED_EXTERNAL',
};

export function recipientClassForType(notificationType: string): RecipientClassName {
  return TYPE_TO_RECIPIENT_CLASS[notificationType] ?? 'HR_OFFBOARDING';
}

/**
 * Read the rendered PDF a notification carries (DEC-054). The bytes live in
 * object storage; this verifies them against the checksum recorded when the
 * document was rendered, so a tampered or missing object fails the send
 * instead of quietly mailing nothing.
 */
async function loadDocumentAttachment(documentId: string): Promise<OutboundAttachment[]> {
  const doc = await getPrisma().documentInstance.findUnique({
    where: { id: documentId },
    select: {
      documentType: true,
      version: true,
      pdfObjectKey: true,
      pdfChecksum: true,
      case: { select: { caseNumber: true } },
    },
  });
  if (!doc?.pdfObjectKey || !doc.pdfChecksum) {
    throw new ProviderError('CONFIG_INVALID', 'The document has no rendered PDF to attach.');
  }
  const { readVerifiedPdf } = await import('./renderService.ts');
  const bytes = await readVerifiedPdf(doc.pdfObjectKey, doc.pdfChecksum);
  return [
    {
      fileName: `${doc.case.caseNumber}-${doc.documentType.toLowerCase()}-v${doc.version}.pdf`,
      mimeType: 'application/pdf',
      bytes,
    },
  ];
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
  // Directory recipient OR a per-case HR-entered destination (Directive 6.3
  // O: id null, mask from the record's encrypted case recipient).
  recipient: { id: string | null; destinationMask: string },
  workflowVersion: number,
  // Null actor = the deterministic rules engine enqueued it (AUTO_SEND).
  actor: Actor | null,
  correlationId: string,
  // Directive 6.3 R/U: deferred dispatch (e.g. termination IT email at
  // effective time minus one hour). Defaults to immediate.
  scheduledAt?: Date | null,
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
      ...(scheduledAt ? { scheduledAt, nextAttemptAt: scheduledAt } : {}),
    },
  });
  await appendAudit(tx, {
    eventType: 'OUTBOX_ENQUEUED',
    actorType: actor ? 'USER' : 'SYSTEM',
    ...(actor ? { actorId: actor.userId, effectiveRoles: actor.roles } : {}),
    objectType: 'NotificationOutbox',
    objectId: outbox.id,
    caseId: record.caseId,
    result: 'SUCCESS',
    correlationId,
    metadata: {
      notificationType: record.notificationType,
      provider,
      destinationMask: recipient.destinationMask,
      scheduledAt: scheduledAt?.toISOString() ?? null,
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
  // Read once per pass: a mid-pass change should not split a batch between
  // rehearsal and real delivery.
  const testMode = await currentTestMode();

  const due = await prisma.notificationOutbox.findMany({
    where: { status: { in: ['PENDING', 'FAILED_RETRYABLE'] }, nextAttemptAt: { lte: now } },
    orderBy: { scheduledAt: 'asc' },
    take: 20,
    include: {
      notificationRecord: {
        select: {
          id: true,
          caseId: true,
          bodySnapshot: true,
          status: true,
          notificationType: true,
          caseRecipientCiphertext: true,
          recipientName: true,
          caseRecipientMask: true,
          signatureRequestId: true,
          ccCiphertext: true,
          bccCiphertext: true,
          attachedDocumentId: true,
        },
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
        destination =
          tryDecryptValue(rc.destinationCiphertext) ?? unreadable('The recipient address');
      } else if (item.notificationRecord.caseRecipientCiphertext) {
        // Directive 6.3 O: HR-entered case-only recipient, decrypted in
        // memory only - same posture as the directory path.
        destination =
          tryDecryptValue(item.notificationRecord.caseRecipientCiphertext) ??
          unreadable('The recipient address');
      } else {
        throw new ProviderError('RECIPIENT_INVALID', 'No recipient configuration recorded.');
      }

      // Directive 6.3 T: issue the secure confirmation link(s) and place them
      // into the OUTGOING body only - the stored snapshot keeps the marker
      // and the database keeps only hashes.
      const { issueTokensForRecordTx } = await import('./ackTokenService.ts');
      let outgoingBody = item.notificationRecord.bodySnapshot ?? '';
      const links = await prisma.$transaction((tx) =>
        issueTokensForRecordTx(
          tx,
          {
            id: item.notificationRecord.id,
            caseId: item.notificationRecord.caseId,
            notificationType: item.notificationRecord.notificationType,
          },
          now,
        ),
      );
      if (links.length > 0) {
        const linkBlock = links
          .map((l) => {
            if (l.purpose === 'ACKNOWLEDGE_RECEIPT') return `Acknowledge receipt: ${l.url}`;
            if (l.purpose === 'COMPLETE_RETURN_CHECKLIST')
              return `Complete the exit checklist: ${l.url}`;
            return `Confirm the action is completed: ${l.url}`;
          })
          .join('\n');
        outgoingBody = outgoingBody.includes('[link inserted at send time]')
          ? outgoingBody.replace('[link inserted at send time]', linkBlock)
          : `${outgoingBody}\n\n${linkBlock}`;
      }

      // DEC-068: the same discipline for a signing link. The request already
      // holds its token; dispatch resolves the live URL into the outgoing
      // body only. A request that ended in the meantime fails the send rather
      // than mailing a dead link.
      if (item.notificationRecord.signatureRequestId) {
        const { signingUrlForDispatch, SIGNING_LINK_MARKER } =
          await import('./signatureService.ts');
        const url = await signingUrlForDispatch(item.notificationRecord.signatureRequestId);
        if (!url)
          throw new ProviderError(
            'RECIPIENT_INVALID',
            'The signing request is no longer active, so no link could be sent.',
          );
        outgoingBody = outgoingBody.includes(SIGNING_LINK_MARKER)
          ? outgoingBody.replaceAll(SIGNING_LINK_MARKER, url)
          : `${outgoingBody}\n\n${url}`;
      }

      // DEC-054: copied recipients and the rendered document this email
      // carries. Both are decrypted / read here and held in memory only.
      const cc: string[] = item.notificationRecord.ccCiphertext
        ? (JSON.parse(
            tryDecryptValue(item.notificationRecord.ccCiphertext) ?? unreadable('A copied address'),
          ) as string[])
        : [];
      const bcc: string[] = item.notificationRecord.bccCiphertext
        ? (JSON.parse(
            tryDecryptValue(item.notificationRecord.bccCiphertext) ??
              unreadable('A copied address'),
          ) as string[])
        : [];
      const attachments = item.notificationRecord.attachedDocumentId
        ? await loadDocumentAttachment(item.notificationRecord.attachedDocumentId)
        : [];

      // Rehearsal mode (directive section 8): every message is diverted to
      // one nominated mailbox, marked, and told in its own body who it would
      // have reached. Nothing else about the flow changes.
      const outgoing = applyTestModeRedirect(
        { subject: item.subjectSnapshot, body: outgoingBody, destination, cc, bcc },
        testMode,
      );
      if (outgoing.redirected) {
        await appendAudit(prisma, {
          eventType: 'NOTIFICATION_REDIRECTED_TEST_MODE',
          actorType: 'SYSTEM',
          objectType: 'NotificationOutbox',
          objectId: item.id,
          caseId: item.notificationRecord.caseId,
          result: 'SUCCESS',
          correlationId: item.correlationId,
          // Masks only, on both sides of the diversion.
          metadata: {
            intendedRecipients: outgoing.intendedMasks,
            redirectedTo: maskDestination(outgoing.destination),
          },
        });
      }

      // DEC-067: the banner image travels in an HTML part built from the
      // OUTGOING text (after any rehearsal redirect), so both parts say the
      // same thing. A banner that cannot be resolved is logged, not fatal.
      const banner = await resolveEmailBannerForNotification({
        caseId: item.notificationRecord.caseId,
        notificationType: item.notificationRecord.notificationType,
        correlationId: item.correlationId,
      });
      const html = renderEmailHtml({ bodyText: outgoing.body, banner: banner?.image ?? null });

      const sendResult = await provider.send({
        outboxId: item.id,
        subject: outgoing.subject,
        body: outgoing.body,
        html,
        inlineImages: banner?.inline ? [banner.inline] : undefined,
        bannerCapture: banner
          ? {
              objectKey: banner.ref.objectKey,
              checksum: banner.ref.checksum,
              mimeType: banner.ref.mimeType,
              alt: banner.ref.altText,
              width: banner.ref.width,
              height: banner.ref.height,
              kind: banner.kind,
            }
          : null,
        destination: outgoing.destination,
        cc: outgoing.cc?.length ? outgoing.cc : undefined,
        bcc: outgoing.bcc?.length ? outgoing.bcc : undefined,
        // A rehearsal still carries the letter: HR is checking the real thing.
        attachments: attachments.length ? attachments : undefined,
        correlationId: item.correlationId,
      });

      await prisma.notificationOutbox.updateMany({
        where: { id: item.id, status: 'CLAIMED' },
        data: {
          status: 'SUBMITTED',
          submittedAt: now,
          providerMessageRef: sendResult.providerMessageRef,
          // Email log (routing directive): intended vs actual, in masks.
          intendedToMask: maskDestination(outgoing.intendedTo),
          intendedCcMasks: outgoing.intendedCc.map(maskDestination),
          intendedBccMasks: outgoing.intendedBcc.map(maskDestination),
          actualToMask: maskDestination(outgoing.destination),
          wasTestMode: outgoing.redirected,
          lastErrorDetail: null,
          // CAPTURED (dev) or SUBMITTED - never DELIVERED without provider
          // delivery evidence (B.5/B.6).
          deliveryStatus: sendResult.deliveryStatus,
          lastErrorCode: null,
          rowVersion: { increment: 1 },
        },
      });
      // Directive 6.3 U: the record's own evidence chain starts at SENT.
      // Sending is never completion (AC invariant 17) - just delivery
      // evidence. Legacy manual-send records are untouched.
      const marked = await prisma.notificationRecord.updateMany({
        where: { id: item.notificationRecord.id, status: 'APPROVED' },
        data: { status: 'SENT', sentAt: now, rowVersion: { increment: 1 } },
      });
      if (marked.count > 0) {
        await appendAudit(prisma, {
          eventType: 'NOTIFICATION_SENT',
          actorType: 'SYSTEM',
          objectType: 'NotificationRecord',
          objectId: item.notificationRecord.id,
          caseId: item.notificationRecord.caseId,
          result: 'SUCCESS',
          correlationId: item.correlationId,
          metadata: { deliveryStatus: sendResult.deliveryStatus },
        });
      }
      // The checklist carries its own "sent" record so the case view and the
      // metrics can report on it without reading the outbox.
      if (item.notificationRecord.notificationType === 'RETURN_ITEMS_CHECKLIST') {
        const { markChecklistSent } = await import('./returnItemsService.ts');
        await markChecklistSent(prisma, item.notificationRecord.caseId, {
          name: item.notificationRecord.recipientName,
          mask: item.notificationRecord.caseRecipientMask,
        });
      }
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
      // A short, safe sentence for the email log. Provider messages can carry
      // an address, so only our own normalized text is stored.
      const detail =
        e instanceof ProviderError && e.message && e.message !== e.code
          ? e.message.slice(0, 300)
          : 'The provider did not accept the message.';
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
          lastErrorDetail: detail,
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
        // Directive 6.3: the record itself reads "Could not send" for HR.
        const failedMark = await prisma.notificationRecord.updateMany({
          where: { id: item.notificationRecord.id, status: 'APPROVED' },
          data: {
            status: 'FAILED',
            failReason: `automatic dispatch failed (${code})`,
            rowVersion: { increment: 1 },
          },
        });
        if (failedMark.count > 0) {
          await appendAudit(prisma, {
            eventType: 'NOTIFICATION_FAILED',
            actorType: 'SYSTEM',
            objectType: 'NotificationRecord',
            objectId: item.notificationRecord.id,
            caseId: item.notificationRecord.caseId,
            result: 'FAILURE',
            correlationId: item.correlationId,
            metadata: { errorCode: code },
          });
        }
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
/**
 * Rehearsal mode: read the current setting (directive section 8).
 * Visible to anyone who can see the outbox - a diversion that is on and
 * invisible is worse than no diversion at all.
 */
export async function getTestMode(actor: Actor): Promise<TestModeConfig> {
  if (!can(actor, 'outbox.view') && !can(actor, 'notifications.testMode'))
    throw ServiceError.forbidden();
  return parseTestMode(await getSystemConfigValue('notifications.testMode'));
}

/**
 * Read for the dispatcher and for banners; no actor, no authorization.
 *
 * A test/UAT deployment is a redirected environment by definition: that is
 * what distinguishes it from production. The stored setting can name the
 * mailbox and the note, but it cannot turn the redirect OFF there - a UAT
 * environment that quietly starts delivering to real people would be the
 * worst possible failure of this feature. Configuration refuses to load
 * without TEST_EMAIL in that environment, so a mailbox always exists.
 */
export async function currentTestMode(): Promise<TestModeConfig> {
  const stored = parseTestMode(await getSystemConfigValue('notifications.testMode'));
  const config = getConfig();
  if (config.appEnvironment !== 'test') return stored;
  return {
    enabled: true,
    redirectTo: stored.redirectTo || (config.TEST_EMAIL ?? ''),
    note: stored.note ?? 'Test/UAT environment: every message is redirected.',
  };
}

/** True when this deployment forces redirection regardless of the setting. */
export function testModeIsForced(): boolean {
  return getConfig().appEnvironment === 'test';
}

/**
 * Turn rehearsal mode on or off. Turning it ON validates the mailbox against
 * the environment's own destination rules, so a development rehearsal can
 * never be pointed at a deliverable address. Turning it OFF is always allowed
 * - nothing should stand between an administrator and resuming real delivery.
 */
export async function setTestMode(
  actor: Actor,
  input: { enabled: boolean; redirectTo: string; note?: string },
): Promise<TestModeConfig> {
  if (!can(actor, 'notifications.testMode')) throw ServiceError.forbidden();
  if (!input.enabled && testModeIsForced())
    throw ServiceError.validation([
      'This is a test/UAT environment: redirection cannot be turned off here. Deploy with APP_ENVIRONMENT=production to deliver to real recipients.',
    ]);
  const cfg: TestModeConfig = {
    enabled: input.enabled,
    redirectTo: (input.redirectTo ?? '').trim(),
    note: input.note?.trim() || undefined,
  };
  const errors = testModeErrors(cfg, getConfig().isProduction ? 'production' : 'development');
  if (errors.length) throw ServiceError.validation(errors);

  const prisma = getPrisma();
  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    await tx.systemConfig.upsert({
      where: { key: 'notifications.testMode' },
      create: {
        key: 'notifications.testMode',
        value: cfg as never,
        reason: cfg.enabled ? 'Rehearsal mode enabled.' : 'Rehearsal mode disabled.',
        updatedById: actor.userId,
      },
      update: {
        value: cfg as never,
        reason: cfg.enabled ? 'Rehearsal mode enabled.' : 'Rehearsal mode disabled.',
        updatedById: actor.userId,
      },
    });
    await appendAudit(tx, {
      eventType: 'NOTIFICATION_TEST_MODE_CHANGED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'SystemConfig',
      objectId: 'notifications.testMode',
      result: 'SUCCESS',
      correlationId,
      metadata: {
        enabled: cfg.enabled,
        redirectMask: cfg.redirectTo ? maskDestination(cfg.redirectTo) : null,
      },
    });
  });
  return cfg;
}

/**
 * The email log (routing directive): one row per message the platform tried
 * to send, with what routing intended, what actually happened, and whether it
 * was a test. Addresses stay masked - the log answers "did this go to the
 * right place" without becoming a directory of everyone's email.
 */
export async function listEmailLog(
  actor: Actor,
  filter: { status?: string; testOnly?: boolean; caseNumber?: string } = {},
) {
  if (!can(actor, 'outbox.view')) throw ServiceError.forbidden();
  const rows = await getPrisma().notificationOutbox.findMany({
    where: {
      ...(filter.status ? { status: filter.status as never } : {}),
      ...(filter.testOnly ? { wasTestMode: true } : {}),
      ...(filter.caseNumber
        ? {
            notificationRecord: {
              is: {
                case: {
                  is: { caseNumber: { contains: filter.caseNumber, mode: 'insensitive' } },
                },
              },
            },
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
    include: {
      notificationRecord: {
        select: {
          notificationType: true,
          subjectSnapshot: true,
          case: { select: { caseNumber: true, employeeDisplayName: true } },
        },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    generatedAt: r.createdAt,
    submittedAt: r.submittedAt,
    caseNumber: r.notificationRecord.case.caseNumber,
    employee: r.notificationRecord.case.employeeDisplayName,
    notificationType: r.notificationRecord.notificationType,
    subject: r.subjectSnapshot || r.notificationRecord.subjectSnapshot || '',
    // "Intended" is what routing decided. Before a send attempt the queue row
    // still carries that intent, so fall back to it rather than show blank.
    intendedToMask: r.intendedToMask ?? r.destinationMask,
    intendedCcMasks: r.intendedCcMasks,
    intendedBccMasks: r.intendedBccMasks,
    actualToMask: r.actualToMask,
    status: r.status,
    deliveryStatus: r.deliveryStatus,
    wasTestMode: r.wasTestMode,
    attempts: r.attempts,
    errorCode: r.lastErrorCode,
    errorDetail: r.lastErrorDetail,
  }));
}

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

/**
 * A saved value this site's data key cannot read is a permanent recipient
 * failure, named as such (DEC-073): retrying cannot help, and the reason must
 * reach the person who can fix it.
 */
function unreadable(what: string): never {
  throw new ProviderError(
    'RECIPIENT_INVALID',
    `${what} cannot be read with this site's data key: SESSION_SECRET or DATA_KEY changed since it was saved, or the database was seeded under a different one.`,
  );
}
