/**
 * Baseline capture and export (BaselineDataCapturePlan.md, REQ-REPORT-020,
 * IC-S1-004). Facts are append-only; corrections supersede with a reason.
 */
import {
  baselineEventErrors,
  canActOnCase,
  canDiscoverCase,
  canViewCase,
  can,
  missingBaselineEventTypes,
  BASELINE_EVENT_TYPES,
  type Actor,
  type BaselineEventInput,
  type CaseAccessContext,
} from '@exit/domain';
import { getPrisma } from '../client.ts';
import { csvCell } from '../csv.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';

async function loadAccess(caseId: string) {
  const c = await getPrisma().offboardingCase.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      caseNumber: true,
      ownerId: true,
      assignedOfficerId: true,
      classification: true,
      participants: { where: { removedAt: null }, select: { userId: true } },
    },
  });
  if (!c) throw ServiceError.notFound();
  const ctx: CaseAccessContext = {
    ownerId: c.ownerId,
    assignedOfficerId: c.assignedOfficerId,
    classification: c.classification,
    participantUserIds: c.participants.map((p) => p.userId),
  };
  return { c, ctx };
}

export async function recordBaselineEvent(actor: Actor, caseId: string, input: BaselineEventInput) {
  const { c, ctx } = await loadAccess(caseId);
  if (!canViewCase(actor, ctx)) {
    if (canDiscoverCase(actor, ctx)) throw ServiceError.forbidden();
    throw ServiceError.notFound();
  }
  if (!canActOnCase(actor, 'case.recordBaselineEvent', ctx)) throw ServiceError.forbidden();

  const errors = baselineEventErrors(input, new Date());
  if (errors.length) throw ServiceError.validation(errors);

  const correlationId = newCorrelationId();
  await getPrisma().$transaction(async (tx) => {
    const e = await tx.baselineEvent.create({
      data: {
        caseId,
        eventType: input.eventType,
        occurredAt: input.occurredAt,
        missingReason: input.missingReason,
        missingNote: input.missingNote,
        detail: input.detail,
        evidenceRef: input.evidenceRef,
        recordedById: actor.userId,
      },
    });
    await appendAudit(tx, {
      eventType: 'BASELINE_EVENT_RECORDED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'BaselineEvent',
      objectId: e.id,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        caseNumber: c.caseNumber,
        baselineEventType: input.eventType,
        hasTime: input.occurredAt !== null,
        missingReason: input.missingReason,
      },
    });
  });
}

/** Corrections preserve the original row (timestamp-integrity rule). */
export async function supersedeBaselineEvent(
  actor: Actor,
  eventId: string,
  replacement: BaselineEventInput,
  reason: string,
) {
  const prisma = getPrisma();
  const prior = await prisma.baselineEvent.findUnique({ where: { id: eventId } });
  if (!prior) throw ServiceError.notFound();
  const { c, ctx } = await loadAccess(prior.caseId);
  if (!canViewCase(actor, ctx)) throw ServiceError.notFound();
  if (!canActOnCase(actor, 'case.recordBaselineEvent', ctx)) throw ServiceError.forbidden();
  if (!reason.trim()) throw ServiceError.validation(['A correction reason is required.']);
  if (prior.supersededAt) throw ServiceError.conflict('This record was already corrected.');

  const errors = baselineEventErrors(replacement, new Date());
  if (errors.length) throw ServiceError.validation(errors);

  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    await tx.baselineEvent.update({
      where: { id: eventId },
      data: { supersededAt: new Date(), supersededById: actor.userId, supersedeReason: reason },
    });
    const e = await tx.baselineEvent.create({
      data: {
        caseId: prior.caseId,
        eventType: replacement.eventType,
        occurredAt: replacement.occurredAt,
        missingReason: replacement.missingReason,
        missingNote: replacement.missingNote,
        detail: replacement.detail,
        evidenceRef: replacement.evidenceRef,
        recordedById: actor.userId,
      },
    });
    await appendAudit(tx, {
      eventType: 'BASELINE_EVENT_SUPERSEDED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'BaselineEvent',
      objectId: e.id,
      caseId: prior.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { caseNumber: c.caseNumber, supersededEventId: eventId, reason },
    });
  });
}

export async function listBaselineEvents(actor: Actor, caseId: string) {
  const { ctx } = await loadAccess(caseId);
  if (!canViewCase(actor, ctx)) {
    if (canDiscoverCase(actor, ctx)) throw ServiceError.forbidden();
    throw ServiceError.notFound();
  }
  return getPrisma().baselineEvent.findMany({
    where: { caseId },
    orderBy: { recordedAt: 'asc' },
  });
}

/**
 * Baseline dashboard: BASELINE-cohort OPERATIONAL cases with per-case fact
 * completeness. TRAINING/TEST records are excluded by construction
 * (REQ-REPORT-014); restricted cases the actor cannot view are excluded from
 * HR dashboards entirely.
 */
export async function baselineDashboard(actor: Actor) {
  if (!can(actor, 'baseline.viewDashboard')) throw ServiceError.forbidden();
  const rows = await getPrisma().offboardingCase.findMany({
    where: {
      recordPurpose: 'OPERATIONAL',
      measurementCohort: 'BASELINE',
      status: { notIn: ['VOIDED', 'CANCELLED'] },
      OR: [
        { classification: 'CONFIDENTIAL' },
        { participants: { some: { userId: actor.userId, removedAt: null } } },
      ],
    },
    include: {
      baselineEvents: { where: { supersededAt: null }, select: { eventType: true } },
      participants: { where: { removedAt: null }, select: { userId: true } },
    },
    orderBy: { receivedAt: 'asc' },
  });

  return rows.map((c) => {
    const recorded = c.baselineEvents.map((e) => e.eventType);
    const missing = missingBaselineEventTypes(recorded);
    return {
      id: c.id,
      caseNumber: c.caseNumber,
      departureType: c.departureType,
      status: c.status,
      classification: c.classification,
      receivedAt: c.receivedAt,
      createdAt: c.createdAt,
      effectiveSeparationAt: c.effectiveSeparationAt,
      recordedCount: new Set(recorded).size,
      totalFactTypes: BASELINE_EVENT_TYPES.length,
      missing,
    };
  });
}

/** CSV export of baseline facts (REQ-REPORT-020), audited (CASE_EXPORTED). */
export async function baselineExportCsv(actor: Actor): Promise<string> {
  if (!can(actor, 'baseline.export')) throw ServiceError.forbidden();
  const rows = await baselineDashboard(actor);
  const prisma = getPrisma();

  const events = await prisma.baselineEvent.findMany({
    where: { caseId: { in: rows.map((r) => r.id) }, supersededAt: null },
  });
  const byCase = new Map<string, typeof events>();
  for (const e of events) {
    const list = byCase.get(e.caseId) ?? [];
    list.push(e);
    byCase.set(e.caseId, list);
  }

  const header = [
    'case_number',
    'departure_type',
    'status',
    'received_at',
    'case_created_at',
    'effective_separation_at',
    ...BASELINE_EVENT_TYPES.map((t) => t.toLowerCase()),
    ...BASELINE_EVENT_TYPES.map((t) => `${t.toLowerCase()}_missing_reason`),
  ];

  const csvEscape = csvCell;

  const lines = [header.join(',')];
  for (const r of rows) {
    const caseEvents = byCase.get(r.id) ?? [];
    const times = BASELINE_EVENT_TYPES.map((t) => {
      const e = caseEvents.find((x) => x.eventType === t);
      return e?.occurredAt ? e.occurredAt.toISOString() : '';
    });
    const reasons = BASELINE_EVENT_TYPES.map((t) => {
      const e = caseEvents.find((x) => x.eventType === t);
      return e?.missingReason ?? '';
    });
    lines.push(
      [
        r.caseNumber,
        r.departureType,
        r.status,
        r.receivedAt.toISOString(),
        r.createdAt.toISOString(),
        r.effectiveSeparationAt?.toISOString() ?? '',
        ...times,
        ...reasons,
      ]
        .map(csvEscape)
        .join(','),
    );
  }

  // Export audit (Directive 1.1 F.12): actor, correlation id, criteria,
  // cohort/purpose and row count - never the exported row content itself.
  await appendAudit(prisma, {
    eventType: 'CASE_EXPORTED',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'BaselineExport',
    objectId: 'baseline-csv',
    result: 'SUCCESS',
    correlationId: newCorrelationId(),
    metadata: {
      exportType: 'baseline-csv',
      rowCount: rows.length,
      measurementCohort: 'BASELINE',
      recordPurpose: 'OPERATIONAL',
      filterCriteria: 'fixed: BASELINE cohort, OPERATIONAL purpose, actor-visible cases',
      includesNonOperational: false,
    },
  });

  return lines.join('\n') + '\n';
}
