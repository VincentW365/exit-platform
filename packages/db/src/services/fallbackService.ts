/**
 * Manual fallback and business continuity (Directive 4 section R) plus the
 * support/incident area (section T) and training completion (section S).
 */
import { can, fallbackRefNumber, type Actor } from '@exit/domain';
import { z } from 'zod';
import { getConfig } from '@exit/config';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';

// --- outages and fallback entries (R) ----------------------------------------

export async function declareOutage(actor: Actor, title: string, note?: string) {
  if (!can(actor, 'continuity.operate')) throw ServiceError.forbidden();
  if (!title.trim()) throw ServiceError.validation(['A title is required.']);
  const prisma = getPrisma();
  const correlationId = newCorrelationId();
  const outage = await prisma.$transaction(async (tx) => {
    const o = await tx.outage.create({
      data: { title, note: note ?? null, declaredById: actor.userId },
    });
    await appendAudit(tx, {
      eventType: 'OUTAGE_DECLARED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'Outage',
      objectId: o.id,
      result: 'SUCCESS',
      correlationId,
      metadata: { title },
    });
    return o;
  });
  return outage;
}

export const fallbackEntrySchema = z.object({
  outageId: z.uuid(),
  kind: z.enum(['CASE', 'NOTIFICATION', 'ACCESS_REMOVAL', 'ASSET', 'CLEARANCE']),
  summary: z.string().trim().min(1).max(1000),
});

/** R: controlled fallback reference numbers via an atomic per-year counter. */
export async function recordFallbackEntry(actor: Actor, rawInput: unknown) {
  if (!can(actor, 'continuity.operate')) throw ServiceError.forbidden();
  const parsed = fallbackEntrySchema.safeParse(rawInput);
  if (!parsed.success)
    throw ServiceError.validation(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  const input = parsed.data;
  const prisma = getPrisma();
  const outage = await prisma.outage.findUnique({ where: { id: input.outageId } });
  if (!outage || outage.status === 'CLOSED')
    throw ServiceError.validation(['The outage is not open for manual records.']);

  const correlationId = newCorrelationId();
  const entry = await prisma.$transaction(async (tx) => {
    const year = new Date().getUTCFullYear();
    const seq = await tx.fallbackEntry.count({
      where: { refNumber: { startsWith: `FB-${year}-` } },
    });
    const refNumber = fallbackRefNumber(year, seq + 1);
    const e = await tx.fallbackEntry.create({
      data: {
        outageId: input.outageId,
        refNumber,
        kind: input.kind,
        summary: input.summary,
        recordedById: actor.userId,
      },
    });
    await appendAudit(tx, {
      eventType: 'FALLBACK_RECORDED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'FallbackEntry',
      objectId: e.id,
      result: 'SUCCESS',
      correlationId,
      metadata: { refNumber, kind: input.kind },
    });
    return e;
  });
  return entry;
}

/**
 * R.3/R.4: reconcile a manual entry against a system record once service
 * returns. Duplicate reconciliation is impossible (entry reconciles once) and
 * the manual reference stays traceable on the audit trail.
 */
export async function reconcileFallbackEntry(
  actor: Actor,
  entryId: string,
  caseId: string | null,
  note: string,
) {
  if (!can(actor, 'continuity.operate')) throw ServiceError.forbidden();
  if (!note.trim()) throw ServiceError.validation(['A reconciliation note is required.']);
  const prisma = getPrisma();
  const entry = await prisma.fallbackEntry.findUnique({ where: { id: entryId } });
  if (!entry) throw ServiceError.notFound();
  if (entry.reconciledAt)
    throw ServiceError.conflict(
      `Already reconciled (${entry.refNumber}) - duplicates are prevented (R.4).`,
    );
  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    const updated = await tx.fallbackEntry.updateMany({
      where: { id: entryId, reconciledAt: null, rowVersion: entry.rowVersion },
      data: {
        reconciledCaseId: caseId,
        reconciledById: actor.userId,
        reconciledAt: new Date(),
        reconcileNote: note,
        rowVersion: { increment: 1 },
      },
    });
    if (updated.count === 0) throw ServiceError.conflict('The entry changed; reload and retry.');
    await appendAudit(tx, {
      eventType: 'FALLBACK_RECONCILED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'FallbackEntry',
      objectId: entryId,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { refNumber: entry.refNumber, linkedCase: caseId !== null, note },
    });
  });
}

export async function closeOutage(actor: Actor, outageId: string, note: string) {
  if (!can(actor, 'continuity.operate')) throw ServiceError.forbidden();
  if (!note.trim()) throw ServiceError.validation(['A closure note is required.']);
  const prisma = getPrisma();
  const open = await prisma.fallbackEntry.count({
    where: { outageId, reconciledAt: null },
  });
  if (open > 0)
    throw ServiceError.validation([
      `${open} manual entr(ies) are not reconciled; reconcile everything before closing (R.3).`,
    ]);
  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    await tx.outage.update({
      where: { id: outageId },
      data: {
        status: 'CLOSED',
        closedById: actor.userId,
        closedAt: new Date(),
        restoredAt: new Date(),
        note,
      },
    });
    await appendAudit(tx, {
      eventType: 'OUTAGE_CLOSED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'Outage',
      objectId: outageId,
      result: 'SUCCESS',
      correlationId,
      metadata: { note },
    });
  });
}

export async function continuityOverview(actor: Actor) {
  if (!can(actor, 'continuity.operate') && !can(actor, 'sop.view')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  return {
    outages: await prisma.outage.findMany({
      orderBy: { declaredAt: 'desc' },
      take: 10,
      include: { entries: { orderBy: { recordedAt: 'desc' } } },
    }),
    canOperate: can(actor, 'continuity.operate'),
  };
}

// --- support and incidents (T) -----------------------------------------------

export const ticketSchema = z.object({
  category: z.enum([
    'INCIDENT',
    'SERVICE_REQUEST',
    'INTEGRATION_FAILURE',
    'SECURITY_PRIVACY_INCIDENT',
    'DATA_CORRECTION',
    'ACCESS_REQUEST',
    'CONFIGURATION_ISSUE',
  ]),
  severity: z.enum(['INFO', 'WARNING', 'HIGH', 'CRITICAL']).default('WARNING'),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2000),
  affectedComponent: z.string().trim().max(100).optional(),
  linkedExceptionId: z.uuid().optional(),
});

export async function createTicket(actor: Actor, rawInput: unknown) {
  if (!can(actor, 'support.use')) throw ServiceError.forbidden();
  const parsed = ticketSchema.safeParse(rawInput);
  if (!parsed.success)
    throw ServiceError.validation(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  const input = parsed.data;
  const prisma = getPrisma();
  const correlationId = newCorrelationId();
  const ticket = await prisma.$transaction(async (tx) => {
    const t = await tx.supportTicket.create({
      data: {
        ...input,
        environment: getConfig().isProduction ? 'production' : 'development',
        reporterId: actor.userId,
        correlationId,
      },
    });
    await appendAudit(tx, {
      eventType: 'SUPPORT_TICKET_CHANGED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'SupportTicket',
      objectId: t.id,
      result: 'SUCCESS',
      correlationId,
      metadata: { category: input.category, severity: input.severity, action: 'created' },
    });
    return t;
  });
  return ticket;
}

export async function updateTicket(
  actor: Actor,
  id: string,
  patch: {
    status?: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
    resolution?: string;
    ownerId?: string;
  },
) {
  if (!can(actor, 'support.manage')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    await tx.supportTicket.update({
      where: { id },
      data: {
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.resolution !== undefined ? { resolution: patch.resolution } : {}),
        ...(patch.ownerId ? { ownerId: patch.ownerId } : {}),
        ...(patch.status === 'RESOLVED' || patch.status === 'CLOSED'
          ? { resolvedAt: new Date() }
          : {}),
        rowVersion: { increment: 1 },
      },
    });
    await appendAudit(tx, {
      eventType: 'SUPPORT_TICKET_CHANGED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'SupportTicket',
      objectId: id,
      result: 'SUCCESS',
      correlationId,
      metadata: { action: 'updated', status: patch.status ?? null },
    });
  });
}

export async function listTickets(actor: Actor) {
  if (!can(actor, 'support.use')) throw ServiceError.forbidden();
  const manage = can(actor, 'support.manage');
  // T: technical support sees safe operational fields; case links display
  // only to actors with their own case authority elsewhere.
  return {
    tickets: await getPrisma().supportTicket.findMany({
      where: manage ? {} : { reporterId: actor.userId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    }),
    canManage: manage,
  };
}

/** T: PII-safe diagnostic bundle - IDs, versions, codes, states only. */
export async function diagnosticBundle(actor: Actor) {
  if (!can(actor, 'support.use')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const config = getConfig();
  const [migration, flags, outboxCounts, worker, deadLetters] = await Promise.all([
    prisma.$queryRawUnsafe<{ migration_name: string }[]>(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1',
    ),
    prisma.featureFlag.findMany({ select: { key: true, enabled: true } }),
    prisma.notificationOutbox.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.systemConfig.findUnique({ where: { key: 'worker.lastHeartbeat' } }),
    prisma.notificationOutbox.findMany({
      where: { status: { in: ['DEAD_LETTER', 'FAILED_PERMANENT'] } },
      select: { id: true, lastErrorCode: true, correlationId: true },
      take: 10,
    }),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    environment: config.isProduction ? 'production' : 'development',
    componentVersions: { app: 'stage4', migration: migration[0]?.migration_name ?? null },
    providerModes: {
      email: config.EMAIL_MODE,
      storage: config.STORAGE_MODE,
      scanner: config.SCAN_MODE,
      identity: config.IDENTITY_MODE,
    },
    featureFlags: Object.fromEntries(flags.map((f) => [f.key, f.enabled])),
    outbox: Object.fromEntries(outboxCounts.map((o) => [o.status, o._count._all])),
    workerLastHeartbeat: (worker?.value as string | null) ?? null,
    deadLetterSamples: deadLetters,
    note: 'PII-free bundle: no document content, survey answers, addresses or employee names.',
  };
}

// --- training (S) ------------------------------------------------------------

export async function recordTraining(actor: Actor, module: string, role: string) {
  if (!can(actor, 'sop.view')) throw ServiceError.forbidden();
  if (!module.trim()) throw ServiceError.validation(['A module is required.']);
  const prisma = getPrisma();
  const existing = await prisma.trainingCompletion.findUnique({
    where: { userId_module: { userId: actor.userId, module } },
  });
  if (existing) return existing;
  const row = await prisma.trainingCompletion.create({
    data: { userId: actor.userId, role: role as never, module },
  });
  await appendAudit(prisma, {
    eventType: 'TRAINING_RECORDED',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'TrainingCompletion',
    objectId: row.id,
    result: 'SUCCESS',
    correlationId: newCorrelationId(),
    metadata: { module, note: 'not formal certification (S.6)' },
  });
  return row;
}

export async function trainingStatus(actor: Actor) {
  if (!can(actor, 'sop.view')) throw ServiceError.forbidden();
  return getPrisma().trainingCompletion.findMany({
    where: { userId: actor.userId },
    orderBy: { completedAt: 'desc' },
  });
}
