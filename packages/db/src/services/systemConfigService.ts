/**
 * Technical system configuration (Directive 4 section I): values plus secret
 * REFERENCES only - a raw secret is never stored or displayed (I.7/I.8,
 * fixed defaults 9/10).
 */
import { can, type Actor } from '@exit/domain';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';

const SECRET_LIKE = /(password|secret|token|key)\s*[:=]/i;

export async function getSystemConfigValue(key: string): Promise<unknown> {
  const row = await getPrisma().systemConfig.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function listSystemConfig(actor: Actor) {
  if (!can(actor, 'admin.system') && !can(actor, 'privacy.view')) throw ServiceError.forbidden();
  return getPrisma().systemConfig.findMany({ orderBy: { key: 'asc' } });
}

export async function setSystemConfig(
  actor: Actor,
  key: string,
  value: unknown,
  reason: string,
  secretRef?: string,
) {
  if (!can(actor, 'admin.system')) throw ServiceError.forbidden();
  if (!reason.trim()) throw ServiceError.validation(['A reason is required (I.5).']);
  if (!/^[a-z][a-zA-Z0-9.]{2,80}$/.test(key))
    throw ServiceError.validation(['Configuration keys are dot-separated identifiers.']);
  // Refuse raw secrets outright: only references are stored (I.8).
  if (typeof value === 'string' && SECRET_LIKE.test(value))
    throw ServiceError.validation([
      'This looks like a raw secret. Store a secret REFERENCE (vault path / env name) instead.',
    ]);
  const prisma = getPrisma();
  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    await tx.systemConfig.upsert({
      where: { key },
      create: {
        key,
        value: value as never,
        secretRef: secretRef ?? null,
        reason,
        updatedById: actor.userId,
      },
      update: {
        value: value as never,
        secretRef: secretRef ?? null,
        reason,
        updatedById: actor.userId,
      },
    });
    await appendAudit(tx, {
      eventType: 'CONFIG_SYSTEM_CHANGED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'SystemConfig',
      objectId: key,
      result: 'SUCCESS',
      correlationId,
      // The VALUE is never audited verbatim: keys and reason only.
      metadata: { key, reason, hasSecretRef: Boolean(secretRef) },
    });
  });
}
