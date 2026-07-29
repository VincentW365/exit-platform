/**
 * Business audit writer and readers (REQ-SEC-024/025/032).
 * Events are append-only; a database trigger rejects UPDATE/DELETE.
 */
import { randomUUID } from 'node:crypto';
import { sanitizeMetadata, type Actor, type AuditDraft } from '@exit/domain';
import { can, canViewCase } from '@exit/domain';
import type { PrismaClient } from '../client.ts';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';

export const APP_VERSION = 'stage1-0.1.0';

/** Transaction-capable Prisma surface (works with both client and $transaction tx). */
export type Db = Pick<PrismaClient, 'auditEvent' | 'offboardingCase' | 'caseParticipant'>;

export function newCorrelationId(): string {
  return randomUUID();
}

/** Append an audit event. Call inside the same transaction as the change it evidences. */
export async function appendAudit(db: Db, draft: AuditDraft): Promise<void> {
  await db.auditEvent.create({
    data: {
      eventType: draft.eventType,
      actorType: draft.actorType,
      actorId: draft.actorId ?? null,
      effectiveRoles: [...(draft.effectiveRoles ?? [])],
      objectType: draft.objectType,
      objectId: draft.objectId,
      caseId: draft.caseId ?? null,
      result: draft.result,
      correlationId: draft.correlationId,
      metadata: sanitizeMetadata(draft.metadata),
      appVersion: APP_VERSION,
    },
  });
}

/** Best-effort denial record; never masks the original failure. */
export async function auditDenied(
  actor: Actor,
  eventType: AuditDraft['eventType'],
  objectType: string,
  objectId: string,
  caseId?: string,
): Promise<void> {
  try {
    await appendAudit(getPrisma(), {
      eventType,
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType,
      objectId,
      caseId: caseId ?? null,
      result: 'DENIED',
      correlationId: newCorrelationId(),
    });
  } catch {
    // Denial auditing must not turn an authorization failure into a crash.
  }
}

/** Case audit timeline for actors who can view the case. */
export async function listCaseAudit(actor: Actor, caseId: string) {
  const prisma = getPrisma();
  const c = await prisma.offboardingCase.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      ownerId: true,
      classification: true,
      participants: { where: { removedAt: null }, select: { userId: true } },
    },
  });
  if (!c) throw ServiceError.notFound();
  const ctx = {
    ownerId: c.ownerId,
    classification: c.classification,
    participantUserIds: c.participants.map((p) => p.userId),
  };
  if (!canViewCase(actor, ctx)) throw ServiceError.notFound();
  return prisma.auditEvent.findMany({
    where: { caseId },
    orderBy: { occurredAt: 'asc' },
    take: 500,
  });
}

/** Global oversight feed (AUDITOR / PRIVACY_OFFICER only). */
export async function listGlobalAudit(
  actor: Actor,
  filter: { eventType?: string; take?: number } = {},
) {
  if (!can(actor, 'audit.viewGlobal')) throw ServiceError.forbidden();
  return getPrisma().auditEvent.findMany({
    where: filter.eventType ? { eventType: filter.eventType } : undefined,
    orderBy: { occurredAt: 'desc' },
    take: Math.min(filter.take ?? 200, 500),
  });
}
