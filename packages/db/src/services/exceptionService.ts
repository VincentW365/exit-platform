/**
 * Exception and escalation records (Directive 3 section N).
 *
 * Open exceptions are idempotent per (case, type, reference) via a partial
 * unique index; resolving preserves the row as history. Severity may be
 * raised while open (escalation), never silently lowered.
 */
import { canActOnCase, can, hasRole, type Actor } from '@exit/domain';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';
import { loadCaseAccess } from './shared.ts';

export type ExceptionTypeName =
  | 'TASK_OVERDUE'
  | 'CRITICAL_ACCESS_OVERDUE'
  | 'TASK_BLOCKED'
  | 'RENDER_FAILED'
  | 'DOCUMENT_UNAPPROVED'
  | 'NOTIFICATION_OVERDUE'
  | 'NOTIFICATION_FAILED'
  | 'ASSET_OVERDUE'
  | 'ASSET_UNRESOLVED'
  | 'HANDOVER_OVERDUE'
  | 'MISSING_APPROVAL'
  | 'INVALID_CASE_DATE'
  | 'WORKFLOW_ACTIVATION_FAILURE'
  | 'DUE_DATE_RETROSPECTIVE_CHANGE'
  | 'CLEARANCE_BLOCKED';

export interface OpenExceptionInput {
  exceptionType: ExceptionTypeName;
  severity: 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';
  title: string;
  detail?: string;
  refType?: string;
  refId?: string;
  ownerDepartment?: 'HR' | 'IT' | 'FINANCE' | 'LINE_MANAGER';
  ownerId?: string;
  dueAt?: Date;
}

/**
 * Idempotently open an exception. Returns the open row (existing or new).
 * Severity is raised in place when the new severity is stronger.
 */
export async function openException(caseId: string, input: OpenExceptionInput) {
  const prisma = getPrisma();
  const existing = await prisma.caseException.findFirst({
    where: {
      caseId,
      exceptionType: input.exceptionType,
      refId: input.refId ?? null,
      status: 'OPEN',
    },
  });
  const rank = { INFO: 0, WARNING: 1, HIGH: 2, CRITICAL: 3 } as const;
  if (existing) {
    if (rank[input.severity] > rank[existing.severity as keyof typeof rank]) {
      await prisma.caseException.updateMany({
        where: { id: existing.id, status: 'OPEN' },
        data: { severity: input.severity, rowVersion: { increment: 1 } },
      });
      await appendAudit(prisma, {
        eventType: 'EXCEPTION_ESCALATED',
        actorType: 'SYSTEM',
        objectType: 'CaseException',
        objectId: existing.id,
        caseId,
        result: 'SUCCESS',
        correlationId: newCorrelationId(),
        metadata: {
          exceptionType: input.exceptionType,
          oldSeverity: existing.severity,
          newSeverity: input.severity,
        },
      });
    }
    return existing;
  }
  const correlationId = newCorrelationId();
  try {
    const created = await prisma.caseException.create({
      data: {
        caseId,
        exceptionType: input.exceptionType,
        severity: input.severity,
        title: input.title.slice(0, 300),
        detail: input.detail?.slice(0, 2000) ?? null,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        ownerDepartment: input.ownerDepartment ?? null,
        ownerId: input.ownerId ?? null,
        dueAt: input.dueAt ?? null,
        correlationId,
      },
    });
    await appendAudit(prisma, {
      eventType: 'EXCEPTION_OPENED',
      actorType: 'SYSTEM',
      objectType: 'CaseException',
      objectId: created.id,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { exceptionType: input.exceptionType, severity: input.severity },
    });
    return created;
  } catch (e) {
    // Race with a concurrent opener: the partial unique index guarantees a
    // single OPEN row - fetch and return it.
    const raced = await prisma.caseException.findFirst({
      where: {
        caseId,
        exceptionType: input.exceptionType,
        refId: input.refId ?? null,
        status: 'OPEN',
      },
    });
    if (raced) return raced;
    throw e;
  }
}

/** Auto-resolve (system): e.g. a task completed after its overdue exception. */
export async function autoResolveException(
  caseId: string,
  exceptionType: ExceptionTypeName,
  refId: string,
  resolution: string,
) {
  const prisma = getPrisma();
  const open = await prisma.caseException.findFirst({
    where: { caseId, exceptionType, refId, status: 'OPEN' },
  });
  if (!open) return;
  await prisma.caseException.updateMany({
    where: { id: open.id, status: 'OPEN' },
    data: {
      status: 'RESOLVED',
      resolution: resolution.slice(0, 1000),
      resolvedAt: new Date(),
      rowVersion: { increment: 1 },
    },
  });
  await appendAudit(prisma, {
    eventType: 'EXCEPTION_RESOLVED',
    actorType: 'SYSTEM',
    objectType: 'CaseException',
    objectId: open.id,
    caseId,
    result: 'SUCCESS',
    correlationId: newCorrelationId(),
    metadata: { exceptionType, resolution: 'auto', detail: resolution.slice(0, 200) },
  });
}

/** HR resolution with reason; security exceptions need HR_MANAGER (I.10). */
export async function resolveException(
  actor: Actor,
  exceptionId: string,
  resolution: string,
  approveAsSecurityException = false,
) {
  const prisma = getPrisma();
  const ex = await prisma.caseException.findUnique({ where: { id: exceptionId } });
  if (!ex) throw ServiceError.notFound();
  const { ctx } = await loadCaseAccess(actor, ex.caseId); // NOT_FOUND if undiscoverable
  if (!canActOnCase(actor, 'exception.resolve', ctx)) throw ServiceError.forbidden();
  if (!resolution.trim()) throw ServiceError.validation(['A resolution note is required.']);
  if (ex.status !== 'OPEN') throw ServiceError.conflict('This exception is already resolved.');
  if (approveAsSecurityException) {
    if (!canActOnCase(actor, 'exception.approveSecurity', ctx))
      throw ServiceError.forbidden('Only HR_MANAGER may approve a security exception (I.10).');
    if (ex.severity !== 'CRITICAL')
      throw ServiceError.validation(['Only CRITICAL exceptions can be security-approved.']);
  }

  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    const updated = await tx.caseException.updateMany({
      where: { id: exceptionId, status: 'OPEN', rowVersion: ex.rowVersion },
      data: {
        status: 'RESOLVED',
        resolution: resolution.slice(0, 1000),
        resolvedById: actor.userId,
        resolvedAt: new Date(),
        securityExceptionApproved: approveAsSecurityException,
        rowVersion: { increment: 1 },
      },
    });
    if (updated.count === 0)
      throw ServiceError.conflict('The exception changed; reload and retry.');
    await appendAudit(tx, {
      eventType: approveAsSecurityException ? 'SECURITY_EXCEPTION_APPROVED' : 'EXCEPTION_RESOLVED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'CaseException',
      objectId: exceptionId,
      caseId: ex.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { exceptionType: ex.exceptionType, resolution },
    });
  });
}

/** Case-scoped exception list for full case viewers. */
export async function listCaseExceptions(actor: Actor, caseId: string) {
  const { ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'exception.view', ctx)) throw ServiceError.forbidden();
  return getPrisma().caseException.findMany({
    where: { caseId },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 200,
  });
}

/**
 * Global exception feed (section N / P). Record-level visibility is embedded
 * in the query: restricted cases never leak through the feed (H.3).
 */
export async function listExceptionFeed(
  actor: Actor,
  filter: {
    status?: 'OPEN' | 'RESOLVED';
    severity?: 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';
    exceptionType?: string;
    ownerDepartment?: 'HR' | 'IT' | 'FINANCE' | 'LINE_MANAGER';
  } = {},
) {
  if (!can(actor, 'exceptions.viewFeed')) throw ServiceError.forbidden();
  const isHr = hasRole(actor, 'HR_MANAGER', 'HR_OFFICER');
  // DEC-042: the feed is HR-only; restricted-case exceptions appear only to
  // participants (defensive empty set for any other permission holder).
  const caseVisibility = isHr
    ? {
        OR: [
          { classification: 'CONFIDENTIAL' as const },
          { participants: { some: { userId: actor.userId, removedAt: null } } },
          { ownerId: actor.userId },
        ],
      }
    : { id: { in: [] as string[] } };
  const rows = await getPrisma().caseException.findMany({
    where: {
      case: caseVisibility,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.severity ? { severity: filter.severity } : {}),
      ...(filter.exceptionType ? { exceptionType: filter.exceptionType as never } : {}),
      ...(filter.ownerDepartment ? { ownerDepartment: filter.ownerDepartment as never } : {}),
    },
    orderBy: [{ status: 'asc' }, { severity: 'desc' }, { createdAt: 'desc' }],
    take: 200,
    include: {
      case: {
        select: {
          id: true,
          caseNumber: true,
          classification: true,
          ownerId: true,
          employeeDisplayName: true,
          participants: { where: { removedAt: null }, select: { userId: true } },
        },
      },
    },
  });
  // Directive 6.2 (Y): the owner is a PERSON where one exists (the assignee
  // whose task raised the exception) - resolved in one batched lookup.
  const ownerIds = [...new Set(rows.map((r) => r.ownerId).filter((v): v is string => !!v))];
  const owners = ownerIds.length
    ? await getPrisma().user.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, displayName: true },
      })
    : [];
  const ownerName = (id: string | null) => owners.find((o) => o.id === id)?.displayName ?? null;

  const now = Date.now();
  return rows.map((r) => {
    const isParticipant =
      r.case.ownerId === actor.userId || r.case.participants.some((p) => p.userId === actor.userId);
    const full = r.case.classification !== 'RESTRICTED' || (isHr && isParticipant);
    return {
      id: r.id,
      caseId: full ? r.case.id : null,
      caseNumber: full ? r.case.caseNumber : '(restricted case)',
      employeeDisplayName: full ? r.case.employeeDisplayName : null,
      exceptionType: r.exceptionType,
      severity: r.severity,
      status: r.status,
      title: full ? r.title : `${r.exceptionType} on a restricted case`,
      detail: full ? r.detail : null,
      ownerDepartment: r.ownerDepartment,
      ownerName: full ? ownerName(r.ownerId) : null,
      dueAt: r.dueAt,
      createdAt: r.createdAt,
      ageMinutes: Math.round((now - r.createdAt.getTime()) / 60_000),
      resolvedAt: r.resolvedAt,
      resolution: full ? r.resolution : null,
      securityExceptionApproved: r.securityExceptionApproved,
      minimized: !full,
    };
  });
}
