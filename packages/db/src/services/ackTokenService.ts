/**
 * No-login acknowledgement tokens (Directive 6.3 T).
 *
 * Departments confirm receipt/completion of automated offboarding emails
 * through single-purpose secure links - no application account required.
 * Discipline mirrors the exit-survey tokens: 256-bit CSPRNG values, hash-only
 * storage, single-use atomic claims, neutral failures, worker-driven expiry
 * that nulls the hash so links die instantly. A token never exposes the case:
 * redemption reveals only the action reference the email already carried.
 */
import {
  actionTokenExpiry,
  actionTokenMatchesHash,
  allowedTokenPurposes,
  generateActionToken,
  hashActionToken,
  isPlausibleActionToken,
  type ActionTokenPurpose,
  type Actor,
  type NotificationType,
} from '@exit/domain';
import { getConfig } from '@exit/config';
import { getPrisma } from '../client.ts';
import type { PrismaClient } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';
import { autoResolveException } from './exceptionService.ts';

type Tx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

export interface IssuedTokenLink {
  purpose: ActionTokenPurpose;
  url: string;
}

/**
 * Issue the allowed token(s) for one notification record at dispatch time.
 * Returns the raw links for embedding in the outgoing email body - the raw
 * value is never stored; only the hash persists.
 */
export async function issueTokensForRecordTx(
  tx: Tx,
  record: { id: string; caseId: string; notificationType: string },
  now: Date,
): Promise<IssuedTokenLink[]> {
  const purposes = allowedTokenPurposes(record.notificationType as NotificationType);
  const base = getConfig().APP_BASE_URL.replace(/\/$/, '');
  const links: IssuedTokenLink[] = [];
  for (const purpose of purposes) {
    // Revoke any previous live token for the same purpose (re-dispatch case).
    await tx.actionToken.updateMany({
      where: { notificationRecordId: record.id, purpose, usedAt: null, revokedAt: null },
      data: {
        tokenHash: null,
        revokedAt: now,
        revokedReason: 'superseded by a newly issued link',
        rowVersion: { increment: 1 },
      },
    });
    const raw = generateActionToken();
    const token = await tx.actionToken.create({
      data: {
        notificationRecordId: record.id,
        purpose,
        tokenHash: hashActionToken(raw),
        issuedAt: now,
        expiresAt: actionTokenExpiry({
          notificationType: record.notificationType as NotificationType,
          issuedAt: now,
        }),
      },
    });
    await appendAudit(tx, {
      eventType: 'ACK_TOKEN_ISSUED',
      actorType: 'SYSTEM',
      objectType: 'ActionToken',
      objectId: token.id,
      caseId: record.caseId,
      result: 'SUCCESS',
      correlationId: newCorrelationId(),
      metadata: { purpose, expiresAt: token.expiresAt.toISOString() },
    });
    // The checklist link opens a form, not the acknowledgement page.
    const path = purpose === 'COMPLETE_RETURN_CHECKLIST' ? 'checklist' : 'ack';
    links.push({ purpose, url: `${base}/${path}/${raw}` });
  }
  return links;
}

/**
 * Public read: what does this token allow? Neutral null on ANY invalid,
 * expired, used or revoked token - the page must not reveal why.
 */
export async function getActionByToken(rawToken: string): Promise<{
  tokenId: string;
  purpose: ActionTokenPurpose;
  actionLabel: string;
  caseReference: string;
  /** Server-side only: lets the checklist form load the right case. */
  caseId: string;
  alreadyDone: boolean;
} | null> {
  if (!isPlausibleActionToken(rawToken)) return null;
  const prisma = getPrisma();
  const token = await prisma.actionToken.findUnique({
    where: { tokenHash: hashActionToken(rawToken) },
    include: {
      notificationRecord: {
        select: {
          id: true,
          notificationType: true,
          subjectSnapshot: true,
          status: true,
          case: { select: { id: true, caseNumber: true } },
        },
      },
    },
  });
  if (!token || !token.tokenHash) return null;
  if (!actionTokenMatchesHash(rawToken, token.tokenHash)) return null;
  if (token.revokedAt || token.usedAt) return null;
  if (token.expiresAt.getTime() < Date.now()) return null;
  return {
    tokenId: token.id,
    purpose: token.purpose,
    actionLabel: token.notificationRecord.subjectSnapshot ?? 'Offboarding notification',
    // The email already carries the case reference; nothing broader leaks.
    caseReference: token.notificationRecord.case.caseNumber,
    caseId: token.notificationRecord.case.id,
    alreadyDone:
      token.purpose === 'COMPLETE_RETURN_CHECKLIST'
        ? false
        : token.purpose === 'ACKNOWLEDGE_RECEIPT'
          ? token.notificationRecord.status === 'ACKNOWLEDGED' ||
            token.notificationRecord.status === 'CONFIRMED_COMPLETE'
          : token.notificationRecord.status === 'CONFIRMED_COMPLETE',
  };
}

/**
 * Public redemption: single-use atomic claim. Acknowledges receipt or
 * confirms completion on the linked notification record and auto-resolves the
 * matching overdue exception. Neutral null result on any failure.
 */
export async function redeemActionToken(
  rawToken: string,
  note?: string,
): Promise<{ ok: true; purpose: ActionTokenPurpose } | null> {
  if (!isPlausibleActionToken(rawToken)) return null;
  const trimmedNote = note?.trim().slice(0, 500) || null;
  const prisma = getPrisma();
  const now = new Date();
  const token = await prisma.actionToken.findUnique({
    where: { tokenHash: hashActionToken(rawToken) },
    include: {
      notificationRecord: {
        select: { id: true, caseId: true, status: true, rowVersion: true },
      },
    },
  });
  if (!token || !token.tokenHash || token.revokedAt || token.usedAt) return null;
  if (token.expiresAt.getTime() < now.getTime()) return null;

  const record = token.notificationRecord;
  const eligible =
    token.purpose === 'ACKNOWLEDGE_RECEIPT'
      ? ['SENT', 'MANUALLY_SENT'].includes(record.status)
      : ['SENT', 'ACKNOWLEDGED', 'MANUALLY_SENT'].includes(record.status);
  if (!eligible) return null;

  const correlationId = newCorrelationId();
  const outcome = await prisma.$transaction(async (tx) => {
    // Single-use atomic claim: null the hash so replays die instantly.
    const claimed = await tx.actionToken.updateMany({
      where: { id: token.id, usedAt: null, revokedAt: null, rowVersion: token.rowVersion },
      data: {
        tokenHash: null,
        usedAt: now,
        usedNote: trimmedNote,
        rowVersion: { increment: 1 },
      },
    });
    if (claimed.count === 0) return null;

    if (token.purpose === 'ACKNOWLEDGE_RECEIPT') {
      await tx.notificationRecord.updateMany({
        where: { id: record.id, status: { in: ['SENT', 'MANUALLY_SENT'] } },
        data: {
          status: 'ACKNOWLEDGED',
          acknowledgedAt: now,
          acknowledgedVia: 'TOKEN',
          rowVersion: { increment: 1 },
        },
      });
      await appendAudit(tx, {
        eventType: 'NOTIFICATION_ACKNOWLEDGED',
        actorType: 'SYSTEM',
        objectType: 'NotificationRecord',
        objectId: record.id,
        caseId: record.caseId,
        result: 'SUCCESS',
        correlationId,
        metadata: { via: 'TOKEN' },
      });
    } else {
      await tx.notificationRecord.updateMany({
        where: { id: record.id, status: { in: ['SENT', 'ACKNOWLEDGED', 'MANUALLY_SENT'] } },
        data: {
          status: 'CONFIRMED_COMPLETE',
          acknowledgedAt: record.status === 'SENT' ? now : undefined,
          acknowledgedVia: record.status === 'SENT' ? 'TOKEN' : undefined,
          completionConfirmedAt: now,
          rowVersion: { increment: 1 },
        },
      });
      await appendAudit(tx, {
        eventType: 'NOTIFICATION_COMPLETION_CONFIRMED',
        actorType: 'SYSTEM',
        objectType: 'NotificationRecord',
        objectId: record.id,
        caseId: record.caseId,
        result: 'SUCCESS',
        correlationId,
        metadata: { via: 'TOKEN' },
      });
    }
    await appendAudit(tx, {
      eventType: 'ACK_TOKEN_USED',
      actorType: 'SYSTEM',
      objectType: 'ActionToken',
      objectId: token.id,
      caseId: record.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { purpose: token.purpose },
    });
    return { ok: true as const, purpose: token.purpose };
  });

  if (outcome) {
    await autoResolveException(
      record.caseId,
      'ACKNOWLEDGEMENT_OVERDUE',
      record.id,
      'Confirmation received through the secure link.',
    );
  }
  return outcome;
}

/** Revoke every live token for a record (cancel/supersede/case closure). */
export async function revokeTokensForRecordTx(
  tx: Tx,
  notificationRecordId: string,
  caseId: string,
  reason: string,
): Promise<number> {
  const revoked = await tx.actionToken.updateMany({
    where: { notificationRecordId, usedAt: null, revokedAt: null },
    data: {
      tokenHash: null,
      revokedAt: new Date(),
      revokedReason: reason.slice(0, 300),
      rowVersion: { increment: 1 },
    },
  });
  if (revoked.count > 0) {
    await appendAudit(tx, {
      eventType: 'ACK_TOKEN_REVOKED',
      actorType: 'SYSTEM',
      objectType: 'NotificationRecord',
      objectId: notificationRecordId,
      caseId,
      result: 'SUCCESS',
      correlationId: newCorrelationId(),
      metadata: { reason, count: revoked.count },
    });
  }
  return revoked.count;
}

/**
 * HR-recorded evidence path (Directive T alternative): CONFIRMED BY
 * EMAIL / PHONE / OTHER with an evidence note, audited with the actor.
 */
export async function recordManualEvidence(
  actor: Actor,
  recordId: string,
  input: { kind: 'ACKNOWLEDGED' | 'COMPLETED'; channel: 'EMAIL' | 'PHONE' | 'OTHER'; note: string },
) {
  const prisma = getPrisma();
  const record = await prisma.notificationRecord.findUnique({ where: { id: recordId } });
  if (!record) throw ServiceError.notFound();
  const { loadCaseAccess } = await import('./shared.ts');
  const { canActOnCase } = await import('@exit/domain');
  const { ctx } = await loadCaseAccess(actor, record.caseId);
  if (!canActOnCase(actor, 'notification.recordEvidence', ctx)) throw ServiceError.forbidden();
  if (!input.note.trim()) throw ServiceError.validation(['An evidence note is required.']);
  if (input.note.length > 1000)
    throw ServiceError.validation(['The evidence note is limited to 1000 characters.']);

  const now = new Date();
  const eligible =
    input.kind === 'ACKNOWLEDGED'
      ? ['SENT', 'MANUALLY_SENT'].includes(record.status)
      : ['SENT', 'ACKNOWLEDGED', 'MANUALLY_SENT'].includes(record.status);
  if (!eligible)
    throw ServiceError.conflict(
      'Evidence can be recorded once the notification has been sent (and not after completion).',
    );

  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    const u = await tx.notificationRecord.updateMany({
      where: { id: recordId, rowVersion: record.rowVersion },
      data:
        input.kind === 'ACKNOWLEDGED'
          ? {
              status: 'ACKNOWLEDGED',
              acknowledgedAt: now,
              acknowledgedVia: 'HR_RECORDED',
              completionEvidenceNote: input.note.trim(),
              completionRecordedById: actor.userId,
              rowVersion: { increment: 1 },
            }
          : {
              status: 'CONFIRMED_COMPLETE',
              acknowledgedAt: record.acknowledgedAt ?? now,
              acknowledgedVia: record.acknowledgedVia ?? 'HR_RECORDED',
              completionConfirmedAt: now,
              completionEvidenceNote: input.note.trim(),
              completionRecordedById: actor.userId,
              rowVersion: { increment: 1 },
            },
    });
    if (u.count === 0) throw ServiceError.conflict('The record changed; reload and retry.');
    await appendAudit(tx, {
      eventType:
        input.kind === 'ACKNOWLEDGED'
          ? 'NOTIFICATION_ACKNOWLEDGED'
          : 'NOTIFICATION_COMPLETION_CONFIRMED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'NotificationRecord',
      objectId: recordId,
      caseId: record.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { via: 'HR_RECORDED', channel: input.channel },
    });
  });
  await autoResolveException(
    record.caseId,
    'ACKNOWLEDGEMENT_OVERDUE',
    recordId,
    'HR recorded confirmation evidence.',
  );
}

/** Worker sweep: expire overdue live tokens (nulls the hash, audited). */
export async function expireActionTokens(now: Date = new Date()): Promise<number> {
  const prisma = getPrisma();
  const stale = await prisma.actionToken.findMany({
    where: { tokenHash: { not: null }, usedAt: null, revokedAt: null, expiresAt: { lt: now } },
    include: { notificationRecord: { select: { caseId: true } } },
    take: 100,
  });
  let expired = 0;
  for (const t of stale) {
    const u = await prisma.actionToken.updateMany({
      where: { id: t.id, rowVersion: t.rowVersion },
      data: { tokenHash: null, rowVersion: { increment: 1 } },
    });
    if (u.count === 0) continue;
    await appendAudit(prisma, {
      eventType: 'ACK_TOKEN_EXPIRED',
      actorType: 'SYSTEM',
      objectType: 'ActionToken',
      objectId: t.id,
      caseId: t.notificationRecord.caseId,
      result: 'SUCCESS',
      correlationId: newCorrelationId(),
      metadata: { purpose: t.purpose },
    });
    expired += 1;
  }
  return expired;
}
