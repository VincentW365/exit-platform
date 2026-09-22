/**
 * Business audit writer and readers (REQ-SEC-024/025/032; Directive 6.1 K-P).
 * Events are append-only; a database trigger rejects UPDATE/DELETE.
 */
import { randomUUID } from 'node:crypto';
import {
  AUDIT_CATEGORIES,
  AUDIT_EVENT_TYPES,
  TIMELINE_NOISE_EVENTS,
  eventCategory,
  sanitizeMetadata,
  timelineChipCategories,
  type Actor,
  type AuditCategory,
  type AuditDraft,
  type AuditEventType,
  type TimelineChip,
} from '@exit/domain';
import { can, canViewCase } from '@exit/domain';
import type { PrismaClient } from '../client.ts';
import { getPrisma } from '../client.ts';
import { csvCell } from '../csv.ts';
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

function eventTypesForCategory(category: AuditCategory): AuditEventType[] {
  return AUDIT_EVENT_TYPES.filter((t) => eventCategory(t) === category);
}

/**
 * Case audit timeline for actors who can view the case (Directive 6.1 N):
 * optional category chip filter, low-level noise hidden unless requested.
 */
export async function listCaseAudit(
  actor: Actor,
  caseId: string,
  opts: { chip?: TimelineChip; includeNoise?: boolean } = {},
) {
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
  const chip = opts.chip ?? 'ALL';
  const chipTypes =
    chip === 'ALL'
      ? null
      : timelineChipCategories(chip).flatMap((cat) => eventTypesForCategory(cat));
  const rows = await prisma.auditEvent.findMany({
    where: {
      AND: [
        { caseId },
        ...(chipTypes ? [{ eventType: { in: chipTypes } }] : []),
        ...(opts.includeNoise ? [] : [{ eventType: { notIn: [...TIMELINE_NOISE_EVENTS] } }]),
      ],
    },
    orderBy: { occurredAt: 'asc' },
    take: 500,
  });
  return rows.map((e) => ({ ...e, category: eventCategory(e.eventType as AuditEventType) }));
}

// --- Directive 6.1 (K/O/P): the Audit Centre ---------------------------------

export interface GlobalAuditFilter {
  from?: Date;
  to?: Date;
  actorId?: string;
  category?: AuditCategory;
  eventType?: string;
  caseNumber?: string;
  result?: 'SUCCESS' | 'DENIED' | 'FAILURE';
  recordPurpose?: 'OPERATIONAL' | 'TRAINING' | 'TEST';
  cursor?: string;
  take?: number;
}

export interface GlobalAuditRow {
  id: string;
  occurredAt: Date;
  eventType: string;
  category: AuditCategory;
  actorType: string;
  actorId: string | null;
  actorDisplayName: string | null;
  effectiveRoles: string[];
  objectType: string;
  objectId: string;
  caseId: string | null;
  caseNumber: string | null;
  result: string;
  correlationId: string;
  metadata: Record<string, unknown>;
  /** True when the row concerns a restricted case the viewer may not see. */
  minimized: boolean;
}

/**
 * Global Audit Centre feed. HR_MANAGER is the audience; rows on restricted
 * cases outside their participation are MINIMIZED (timestamp + category
 * only). The separate technical-only feed the System Administrator used to
 * receive went with that role (DEC-063): technical categories remain
 * ordinary categories of this feed, filtered like any other.
 */
export async function listGlobalAudit(actor: Actor, filter: GlobalAuditFilter = {}) {
  if (!can(actor, 'audit.viewGlobal')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const take = Math.min(Math.max(filter.take ?? 50, 1), 200);

  const categoryTypes = filter.category ? eventTypesForCategory(filter.category) : null;

  // caseNumber lookup is guarded by case visibility: a restricted case the
  // viewer cannot see yields an empty result, not an existence leak.
  let caseIdFilter: string | null | undefined;
  if (filter.caseNumber?.trim()) {
    const c = await prisma.offboardingCase.findUnique({
      where: { caseNumber: filter.caseNumber.trim().toUpperCase() },
      select: {
        id: true,
        ownerId: true,
        classification: true,
        participants: { where: { removedAt: null }, select: { userId: true } },
      },
    });
    const visible =
      c &&
      canViewCase(actor, {
        ownerId: c.ownerId,
        classification: c.classification,
        participantUserIds: c.participants.map((p) => p.userId),
      });
    if (!visible) return { rows: [], nextCursor: null, summary: emptySummary() };
    caseIdFilter = c.id;
  }

  const cursorRow = filter.cursor
    ? await prisma.auditEvent.findUnique({
        where: { id: filter.cursor },
        select: { occurredAt: true, id: true },
      })
    : null;

  const where = {
    ...(filter.from || filter.to
      ? {
          occurredAt: {
            ...(filter.from ? { gte: filter.from } : {}),
            ...(filter.to ? { lte: filter.to } : {}),
          },
        }
      : {}),
    ...(filter.actorId ? { actorId: filter.actorId } : {}),
    ...(filter.result ? { result: filter.result } : {}),
    ...(caseIdFilter ? { caseId: caseIdFilter } : {}),
    ...(filter.eventType
      ? { eventType: filter.eventType }
      : categoryTypes
        ? { eventType: { in: categoryTypes } }
        : {}),
    ...(filter.recordPurpose ? { case: { is: { recordPurpose: filter.recordPurpose } } } : {}),
  };

  const rows = await prisma.auditEvent.findMany({
    where: cursorRow
      ? {
          AND: [
            where,
            {
              OR: [
                { occurredAt: { lt: cursorRow.occurredAt } },
                { occurredAt: cursorRow.occurredAt, id: { lt: cursorRow.id } },
              ],
            },
          ],
        }
      : where,
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: take + 1,
  });
  const page = rows.slice(0, take);
  const nextCursor = rows.length > take ? (page[page.length - 1]?.id ?? null) : null;

  // Resolve actor names + case numbers/visibility in two batched queries.
  const actorIds = [...new Set(page.map((e) => e.actorId).filter((v): v is string => !!v))];
  const users = new Map(
    (
      await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, displayName: true },
      })
    ).map((u) => [u.id, u.displayName]),
  );
  const caseIds = [...new Set(page.map((e) => e.caseId).filter((v): v is string => !!v))];
  const cases = new Map(
    (
      await prisma.offboardingCase.findMany({
        where: { id: { in: caseIds } },
        select: {
          id: true,
          caseNumber: true,
          ownerId: true,
          classification: true,
          participants: { where: { removedAt: null }, select: { userId: true } },
        },
      })
    ).map((c) => [c.id, c]),
  );

  const mapped: GlobalAuditRow[] = page.map((e) => {
    const c = e.caseId ? cases.get(e.caseId) : undefined;
    const visible =
      !c ||
      canViewCase(actor, {
        ownerId: c.ownerId,
        classification: c.classification,
        participantUserIds: c.participants.map((p) => p.userId),
      });
    const category = eventCategory(e.eventType as AuditEventType);
    if (!visible) {
      // Directive 6.1 D5: minimized restricted-case row - existence of an
      // event is visible to the HR audience, its content is not.
      return {
        id: e.id,
        occurredAt: e.occurredAt,
        eventType: 'RESTRICTED',
        category,
        actorType: e.actorType,
        actorId: null,
        actorDisplayName: null,
        effectiveRoles: [],
        objectType: 'RESTRICTED',
        objectId: 'RESTRICTED',
        caseId: null,
        caseNumber: null,
        result: 'RESTRICTED',
        correlationId: 'RESTRICTED',
        metadata: {},
        minimized: true,
      };
    }
    return {
      id: e.id,
      occurredAt: e.occurredAt,
      eventType: e.eventType,
      category,
      actorType: e.actorType,
      actorId: e.actorId,
      actorDisplayName: e.actorId ? (users.get(e.actorId) ?? null) : null,
      effectiveRoles: e.effectiveRoles,
      objectType: e.objectType,
      objectId: e.objectId,
      caseId: e.caseId,
      caseNumber: c?.caseNumber ?? null,
      result: e.result,
      correlationId: e.correlationId,
      metadata: (e.metadata ?? {}) as Record<string, unknown>,
      minimized: false,
    };
  });

  // Summary cards computed on the same authorization basis (post-filter).
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const [today, denied, assignments, approvals, security] = await Promise.all([
    prisma.auditEvent.count({ where: { AND: [where, { occurredAt: { gte: startOfToday } }] } }),
    prisma.auditEvent.count({ where: { AND: [where, { result: 'DENIED' }] } }),
    prisma.auditEvent.count({
      where: { AND: [where, { eventType: { in: eventTypesForCategory('ASSIGNMENT') } }] },
    }),
    prisma.auditEvent.count({
      where: { AND: [where, { eventType: { in: eventTypesForCategory('APPROVAL') } }] },
    }),
    prisma.auditEvent.count({
      where: { AND: [where, { eventType: { in: eventTypesForCategory('SECURITY') } }] },
    }),
  ]);

  // D9: searches (any filter beyond paging) are themselves audited.
  const searched = Boolean(
    filter.from ||
    filter.to ||
    filter.actorId ||
    filter.category ||
    filter.eventType ||
    filter.caseNumber ||
    filter.result ||
    filter.recordPurpose,
  );
  if (searched && !filter.cursor) {
    await appendAudit(prisma, {
      eventType: 'AUDIT_SEARCHED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'AuditEvent',
      objectId: 'global-search',
      result: 'SUCCESS',
      correlationId: newCorrelationId(),
      metadata: {
        category: filter.category ?? null,
        eventType: filter.eventType ?? null,
        hasDateRange: Boolean(filter.from || filter.to),
        hasActorFilter: Boolean(filter.actorId),
        hasCaseFilter: Boolean(filter.caseNumber),
        result: filter.result ?? null,
      },
    });
  }

  return {
    rows: mapped,
    nextCursor,
    summary: { today, denied, assignments, approvals, security },
  };
}

function emptySummary() {
  return { today: 0, denied: 0, assignments: 0, approvals: 0, security: 0 };
}

/** O: audited, injection-protected CSV export of the filtered feed. */
export async function exportGlobalAuditCsv(
  actor: Actor,
  filter: GlobalAuditFilter = {},
): Promise<string> {
  if (!can(actor, 'audit.export')) throw ServiceError.forbidden();
  const { rows } = await listGlobalAudit(actor, { ...filter, take: 200, cursor: undefined });
  const header = [
    'occurredAt',
    'category',
    'eventType',
    'actor',
    'roles',
    'objectType',
    'objectId',
    'caseNumber',
    'result',
    'correlationId',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.occurredAt.toISOString(),
        r.category,
        r.eventType,
        r.minimized ? 'RESTRICTED' : (r.actorDisplayName ?? r.actorType),
        r.effectiveRoles.join('|'),
        r.objectType,
        r.objectId,
        r.caseNumber ?? '',
        r.result,
        r.correlationId,
      ]
        .map((v) => csvCell(String(v)))
        .join(','),
    );
  }
  await appendAudit(getPrisma(), {
    eventType: 'AUDIT_EXPORTED',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'AuditEvent',
    objectId: 'global-export',
    result: 'SUCCESS',
    correlationId: newCorrelationId(),
    metadata: {
      rowCount: rows.length,
      category: filter.category ?? null,
      eventType: filter.eventType ?? null,
      hasCaseFilter: Boolean(filter.caseNumber),
    },
  });
  return lines.join('\r\n');
}

/** Distinct categories for the filter toolbar. */
export function auditCategoryOptions(): readonly AuditCategory[] {
  return AUDIT_CATEGORIES;
}
