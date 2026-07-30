/**
 * Offboarding case service - every read and mutation enforces the domain
 * policy server-side (REQ-SEC-005/007) and appends audit evidence in the same
 * transaction as the change (Architecture.md section 8).
 */
import { z } from 'zod';
import {
  buildSnapshotPayload,
  canActOnCase,
  canDiscoverCase,
  canViewCase,
  can,
  checkTransition,
  cohortPurposeErrors,
  purposeChangeErrors,
  snapshotChecksum,
  submitReadinessErrors,
  SyntheticEmployeeSourceAdapter,
  SNAPSHOT_SCHEMA_VERSION,
  type Actor,
  type CaseAccessContext,
  type CaseTransitionAction,
} from '@exit/domain';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, auditDenied, newCorrelationId } from './auditService.ts';
import { outdateDocumentsForCaseChange } from './documentService.ts';
import { outdateFormsForCaseChange } from './actionFormService.ts';
import { cancelLiveWorkflowForCaseTx, recalcTasksForEffectiveChange } from './workflowService.ts';
import { supersedeNotificationsForCaseChange } from './notificationService.ts';

const employeeSource = new SyntheticEmployeeSourceAdapter();

// --- input schemas (REQ-NFR-005) --------------------------------------------

// Guard against JS date-coercion pitfalls: null/'' must mean "absent" and
// never silently coerce to the 1970 epoch.
const isoDate = z.union([z.string().min(1), z.number(), z.date()]).pipe(z.coerce.date());
const optionalIsoDate = z
  .union([z.null(), z.literal('').transform(() => null), isoDate])
  .optional();
const shortText = (max: number) => z.string().trim().max(max);

export const createDraftSchema = z.object({
  employeeSourceId: shortText(40).min(1),
  departureType: z.enum(['RESIGNATION_WITH_NOTICE', 'IMMEDIATE_RESIGNATION', 'TERMINATION']),
  receivedAt: isoDate,
  receiptSource: shortText(200).min(1),
  proposedLastDay: optionalIsoDate,
  confirmedLastDay: optionalIsoDate,
  effectiveSeparationAt: optionalIsoDate,
  department: shortText(100).optional(),
  location: shortText(100).optional(),
  measurementCohort: z.enum(['BASELINE', 'PILOT', 'POST_ROLLOUT']).nullable().default('BASELINE'),
  recordPurpose: z.enum(['OPERATIONAL', 'TRAINING', 'TEST']).default('OPERATIONAL'),
  reasonCaptureStatus: z
    .enum(['PENDING', 'PROVIDED', 'NOT_PROVIDED', 'NOT_APPLICABLE'])
    .default('PENDING'),
  reasonCategoryId: z.uuid().nullable().optional(),
  reasonNotes: shortText(2000).optional(),
  noticeProvidedDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  noticeRequiredDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
  noticeTreatment: shortText(300).optional(),
});
export type CreateDraftInput = z.infer<typeof createDraftSchema>;

export const updateDraftSchema = createDraftSchema.partial().omit({ employeeSourceId: true });
export type UpdateDraftInput = z.infer<typeof updateDraftSchema>;

// --- helpers -----------------------------------------------------------------

async function loadCaseWithAccess(caseId: string) {
  const prisma = getPrisma();
  const c = await prisma.offboardingCase.findUnique({
    where: { id: caseId },
    include: {
      participants: { where: { removedAt: null } },
      snapshot: { select: { id: true, checksum: true, capturedAt: true, retrievedAt: true } },
      reasonCategory: { select: { code: true, label: true, isTestOnly: true } },
    },
  });
  if (!c) throw ServiceError.notFound();
  const ctx: CaseAccessContext = {
    ownerId: c.ownerId,
    classification: c.classification,
    participantUserIds: c.participants.map((p) => p.userId),
  };
  return { c, ctx };
}

/** Restricted cases must not leak existence: discovery failure -> NOT_FOUND. */
function assertView(actor: Actor, ctx: CaseAccessContext): void {
  if (canViewCase(actor, ctx)) return;
  if (canDiscoverCase(actor, ctx)) throw ServiceError.forbidden();
  throw ServiceError.notFound();
}

async function allocateCaseNumber(
  tx: Parameters<Parameters<ReturnType<typeof getPrisma>['$transaction']>[0]>[0],
  now: Date,
): Promise<string> {
  const year = now.getUTCFullYear();
  const counter = await tx.caseNumberCounter.upsert({
    where: { year },
    create: { year, next: 2 },
    update: { next: { increment: 1 } },
  });
  const seq = counter.next === 2 && counter.year === year ? 1 : counter.next - 1;
  return `OFF-${year}-${String(seq).padStart(4, '0')}`;
}

// --- employee search ---------------------------------------------------------

export interface EmployeeSearchRow {
  sourceSystem: string;
  sourceId: string;
  displayName: string;
  workEmail: string | null;
  jobTitle: string | null;
  department: string | null;
  location: string | null;
  active: boolean;
  lastSyncedAt: Date | null;
}

const PURGED_SOURCE_PREFIX = 'PURGED-';

/**
 * Directive 5.1 E.1: search the local employee-source cache (synthetic, live
 * BambooHR and manual rows) by name, identifier, department, position or
 * location; the in-memory synthetic fixtures remain available even before any
 * sync. Searches are audited WITHOUT recording the query or result content
 * (G.8).
 */
export async function searchEmployees(actor: Actor, query: string) {
  if (!can(actor, 'employeeSource.search')) throw ServiceError.forbidden();
  const q = query.trim();
  const prisma = getPrisma();
  const dbRows = q
    ? await prisma.employeeSourceRecord.findMany({
        where: {
          NOT: { displayName: { startsWith: PURGED_SOURCE_PREFIX } },
          OR: [
            { displayName: { contains: q, mode: 'insensitive' } },
            { sourceId: { contains: q, mode: 'insensitive' } },
            { department: { contains: q, mode: 'insensitive' } },
            { jobTitle: { contains: q, mode: 'insensitive' } },
            { location: { contains: q, mode: 'insensitive' } },
          ],
        },
        orderBy: { displayName: 'asc' },
        take: 25,
      })
    : [];
  const results: EmployeeSearchRow[] = dbRows.map((r) => ({
    sourceSystem: r.sourceSystem,
    sourceId: r.sourceId,
    displayName: r.displayName,
    workEmail: r.workEmail,
    jobTitle: r.jobTitle,
    department: r.department,
    location: r.location,
    active: ((r.payload as { active?: boolean } | null)?.active ?? true) === true,
    lastSyncedAt: r.retrievedAt,
  }));
  // Synthetic fixtures not yet cached in the database stay findable.
  const known = new Set(results.map((r) => r.sourceId));
  for (const e of await employeeSource.search(q)) {
    if (known.has(e.sourceId)) continue;
    results.push({
      sourceSystem: e.sourceSystem,
      sourceId: e.sourceId,
      displayName: e.displayName,
      workEmail: e.workEmail,
      jobTitle: e.jobTitle,
      department: e.department,
      location: e.location,
      active: true,
      lastSyncedAt: null,
    });
  }
  await appendAudit(prisma, {
    eventType: 'EMPLOYEE_DIRECTORY_SEARCHED',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'EmployeeSourceRecord',
    objectId: 'search',
    result: 'SUCCESS',
    correlationId: newCorrelationId(),
    // G.8: no query text and no result content - sizes only.
    metadata: { queryLength: q.length, resultCount: results.length },
  });
  return { retrievedAt: new Date(), results };
}

/**
 * Resolve a selected employee: local source cache first (live/manual rows),
 * synthetic fixtures as fallback. Purged live rows never resolve.
 */
async function lookupEmployeeSource(sourceId: string) {
  const row = await getPrisma().employeeSourceRecord.findFirst({
    where: { sourceId, NOT: { displayName: { startsWith: PURGED_SOURCE_PREFIX } } },
    orderBy: { retrievedAt: 'desc' },
  });
  if (row) {
    return {
      sourceSystem: row.sourceSystem,
      sourceId: row.sourceId,
      displayName: row.displayName,
      workEmail: row.workEmail ?? '',
      jobTitle: row.jobTitle ?? '',
      department: row.department ?? '',
      location: row.location ?? '',
    };
  }
  return employeeSource.getById(sourceId);
}

const manualEmployeeSchema = z.object({
  displayName: shortText(120).min(1),
  workEmail: z.union([z.literal(''), z.string().trim().email().max(200)]).optional(),
  jobTitle: shortText(120).optional(),
  department: shortText(100).optional(),
  location: shortText(100).optional(),
});

/**
 * Directive 5.1 E.8: manual-entry fallback when the directory source is
 * unavailable. The record is clearly marked MANUAL for later reconciliation.
 */
export async function createManualEmployeeSource(actor: Actor, rawInput: unknown) {
  if (!can(actor, 'case.create')) throw ServiceError.forbidden();
  const parsed = manualEmployeeSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw ServiceError.validation(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }
  const input = parsed.data;
  const prisma = getPrisma();
  const sourceId = `MAN-${new Date().getUTCFullYear()}-${newCorrelationId().slice(0, 8)}`;
  const record = await prisma.employeeSourceRecord.create({
    data: {
      sourceSystem: 'MANUAL',
      sourceId,
      displayName: input.displayName,
      workEmail: input.workEmail || null,
      jobTitle: input.jobTitle || null,
      department: input.department || null,
      location: input.location || null,
      retrievedAt: new Date(),
      payload: { active: true, manualEntry: true, enteredById: actor.userId },
    },
  });
  await appendAudit(prisma, {
    eventType: 'MANUAL_EMPLOYEE_SOURCE_CREATED',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'EmployeeSourceRecord',
    objectId: record.id,
    result: 'SUCCESS',
    correlationId: newCorrelationId(),
    metadata: { sourceId },
  });
  return { sourceId };
}

// --- create ------------------------------------------------------------------

export async function createDraft(actor: Actor, rawInput: unknown) {
  if (!can(actor, 'case.create')) {
    await auditDenied(actor, 'ACCESS_DENIED', 'OffboardingCase', 'create');
    throw ServiceError.forbidden();
  }
  const parsed = createDraftSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw ServiceError.validation(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  }
  const input = parsed.data;

  const employee = await lookupEmployeeSource(input.employeeSourceId);
  if (!employee) throw ServiceError.validation(['Selected employee was not found in the source.']);
  const retrievedAt = new Date();

  const cohortErrors = cohortPurposeErrors({
    measurementCohort: input.measurementCohort,
    recordPurpose: input.recordPurpose,
  });
  if (cohortErrors.length) throw ServiceError.validation(cohortErrors);

  if (input.receivedAt.getTime() > Date.now() + 5 * 60_000) {
    throw ServiceError.validation(['Receipt time cannot be in the future.']);
  }

  // Termination cases are RESTRICTED by default and cannot be downgraded
  // (DEC-035 / IC-S1-011).
  const classification = input.departureType === 'TERMINATION' ? 'RESTRICTED' : 'CONFIDENTIAL';

  const prisma = getPrisma();

  // Duplicate warning (REQ-CASE-020) - warn, do not block. Restricted cases
  // the actor cannot discover are EXCLUDED: their existence must not leak
  // through the duplicate warning (DEC-035 / IC-S1-011 outranks the SHOULD).
  const duplicates = await prisma.offboardingCase.findMany({
    where: {
      employeeSourceId: input.employeeSourceId,
      status: { notIn: ['VOIDED', 'CANCELLED'] },
      OR: [
        { classification: 'CONFIDENTIAL' },
        { participants: { some: { userId: actor.userId, removedAt: null } } },
        { ownerId: actor.userId },
      ],
    },
    select: { caseNumber: true, status: true },
  });

  const correlationId = newCorrelationId();
  const created = await prisma.$transaction(async (tx) => {
    const caseNumber = await allocateCaseNumber(tx, new Date());
    await tx.employeeSourceRecord.upsert({
      where: {
        sourceSystem_sourceId: { sourceSystem: employee.sourceSystem, sourceId: employee.sourceId },
      },
      create: {
        sourceSystem: employee.sourceSystem,
        sourceId: employee.sourceId,
        displayName: employee.displayName,
        workEmail: employee.workEmail,
        jobTitle: employee.jobTitle,
        department: employee.department,
        location: employee.location,
        retrievedAt,
        payload: { ...employee },
      },
      update: {
        displayName: employee.displayName,
        workEmail: employee.workEmail,
        jobTitle: employee.jobTitle,
        department: employee.department,
        location: employee.location,
        retrievedAt,
        payload: { ...employee },
      },
    });

    const c = await tx.offboardingCase.create({
      data: {
        caseNumber,
        status: 'DRAFT',
        departureType: input.departureType,
        classification,
        measurementCohort: input.measurementCohort,
        recordPurpose: input.recordPurpose,
        employeeSourceSystem: employee.sourceSystem,
        employeeSourceId: employee.sourceId,
        employeeDisplayName: employee.displayName,
        employeeWorkEmail: employee.workEmail,
        department: input.department?.trim() || employee.department,
        location: input.location?.trim() || employee.location,
        jobTitle: employee.jobTitle,
        receivedAt: input.receivedAt,
        receiptSource: input.receiptSource,
        proposedLastDay: input.proposedLastDay ?? null,
        confirmedLastDay: input.confirmedLastDay ?? null,
        effectiveSeparationAt: input.effectiveSeparationAt ?? null,
        noticeProvidedDays: input.noticeProvidedDays ?? null,
        noticeRequiredDays: input.noticeRequiredDays ?? null,
        noticeTreatment: input.noticeTreatment || null,
        reasonCategoryId: input.reasonCategoryId ?? null,
        reasonCaptureStatus: input.reasonCaptureStatus,
        reasonNotes: input.reasonNotes || null,
        ownerId: actor.userId,
        createdById: actor.userId,
      },
    });

    await tx.caseParticipant.create({
      data: {
        caseId: c.id,
        userId: actor.userId,
        participantRole: 'OWNER',
        reason: 'Case creator is the accountable owner.',
        addedById: actor.userId,
      },
    });

    await tx.caseStatusHistory.create({
      data: {
        caseId: c.id,
        fromStatus: null,
        toStatus: 'DRAFT',
        actorId: actor.userId,
        correlationId,
      },
    });

    await appendAudit(tx, {
      eventType: 'CASE_CREATED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'OffboardingCase',
      objectId: c.id,
      caseId: c.id,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        caseNumber,
        departureType: input.departureType,
        classification,
        measurementCohort: input.measurementCohort,
        recordPurpose: input.recordPurpose,
        employeeSourceId: employee.sourceId,
      },
    });

    return c;
  });

  return {
    caseId: created.id,
    caseNumber: created.caseNumber,
    duplicateWarnings: duplicates.map((d) => `${d.caseNumber} (${d.status})`),
  };
}

// --- read --------------------------------------------------------------------

export interface CaseViewCapabilities {
  canEditDraft: boolean;
  canSubmit: boolean;
  canReturn: boolean;
  canApprove: boolean;
  canCancel: boolean;
  canVoid: boolean;
  canCorrect: boolean;
  canChangeEffectiveTime: boolean;
  canManageParticipants: boolean;
  canViewRehire: boolean;
  canSetRehire: boolean;
  canViewReasonNotes: boolean;
  canAddNote: boolean;
  canRecordBaseline: boolean;
  canUpload: boolean;
  canDownload: boolean;
}

export async function getCase(actor: Actor, caseId: string) {
  const { c, ctx } = await loadCaseWithAccess(caseId);
  assertView(actor, ctx);

  if (c.classification === 'RESTRICTED') {
    await appendAudit(getPrisma(), {
      eventType: 'CASE_VIEWED_RESTRICTED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'OffboardingCase',
      objectId: c.id,
      caseId: c.id,
      result: 'SUCCESS',
      correlationId: newCorrelationId(),
      metadata: { caseNumber: c.caseNumber },
    });
  }

  const capabilities: CaseViewCapabilities = {
    canEditDraft: canActOnCase(actor, 'case.editDraft', ctx) && c.status === 'DRAFT',
    canSubmit: canActOnCase(actor, 'case.submit', ctx) && c.status === 'DRAFT',
    canReturn: canActOnCase(actor, 'case.return', ctx) && c.status === 'PENDING_HR_REVIEW',
    canApprove: canActOnCase(actor, 'case.approve', ctx) && c.status === 'PENDING_HR_REVIEW',
    canCancel:
      canActOnCase(actor, 'case.cancel', ctx) &&
      ['DRAFT', 'PENDING_HR_REVIEW', 'APPROVED'].includes(c.status),
    canVoid:
      canActOnCase(actor, 'case.void', ctx) &&
      ['DRAFT', 'PENDING_HR_REVIEW', 'APPROVED'].includes(c.status),
    canCorrect:
      canActOnCase(actor, 'case.correct', ctx) && !['VOIDED', 'CANCELLED'].includes(c.status),
    canChangeEffectiveTime:
      canActOnCase(actor, 'case.changeEffectiveTime', ctx) &&
      !['VOIDED', 'CANCELLED'].includes(c.status),
    canManageParticipants: canActOnCase(actor, 'case.manageParticipants', ctx),
    canViewRehire: canActOnCase(actor, 'case.viewRehire', ctx),
    canSetRehire: canActOnCase(actor, 'case.setRehire', ctx),
    canViewReasonNotes: canActOnCase(actor, 'case.viewReasonNotes', ctx),
    canAddNote: canActOnCase(actor, 'case.addNote', ctx),
    canRecordBaseline: canActOnCase(actor, 'case.recordBaselineEvent', ctx),
    canUpload: canActOnCase(actor, 'attachment.upload', ctx) && c.status !== 'VOIDED',
    canDownload: canActOnCase(actor, 'attachment.download', ctx),
  };

  // Field masking (REQ-CASE-026): sensitive values never leave the server for
  // unauthorized viewers.
  const dto = {
    ...c,
    rehireEligibility: capabilities.canViewRehire ? c.rehireEligibility : null,
    rehireMasked: !capabilities.canViewRehire,
    reasonNotes: capabilities.canViewReasonNotes ? c.reasonNotes : null,
    reasonNotesMasked: !capabilities.canViewReasonNotes,
  };

  return { case: dto, capabilities };
}

// --- list --------------------------------------------------------------------

export const listFilterSchema = z.object({
  status: z
    .enum([
      'DRAFT',
      'PENDING_HR_REVIEW',
      'APPROVED',
      'ACTIVE',
      'CLEARANCE_REVIEW',
      'COMPLETED',
      'ON_HOLD',
      'CANCELLED',
      'VOIDED',
      'REOPENED',
    ])
    .optional(),
  departureType: z
    .enum(['RESIGNATION_WITH_NOTICE', 'IMMEDIATE_RESIGNATION', 'TERMINATION'])
    .optional(),
  measurementCohort: z.enum(['BASELINE', 'PILOT', 'POST_ROLLOUT']).optional(),
  recordPurpose: z.enum(['OPERATIONAL', 'TRAINING', 'TEST']).optional(),
  q: z.string().trim().max(100).optional(),
});
export type ListFilter = z.infer<typeof listFilterSchema>;

export async function listCases(actor: Actor, rawFilter: unknown = {}) {
  if (!can(actor, 'case.list')) throw ServiceError.forbidden();
  const parsed = listFilterSchema.safeParse(rawFilter);
  if (!parsed.success) throw ServiceError.validation(['Invalid filter.']);
  const f = parsed.data;

  const isHr = actor.roles.includes('HR_MANAGER') || actor.roles.includes('HR_OFFICER');
  const isOversight = actor.roles.includes('AUDITOR') || actor.roles.includes('PRIVACY_OFFICER');

  // Record-level visibility encoded in the query itself so counts and rows
  // can never leak (REQ-SEC-008).
  const visibility = isHr
    ? {
        OR: [
          { classification: 'CONFIDENTIAL' as const },
          { participants: { some: { userId: actor.userId, removedAt: null } } },
          { ownerId: actor.userId },
        ],
      }
    : isOversight
      ? {} // oversight discovers all rows; restricted rows are minimized below
      : { id: { in: [] as string[] } };

  const filters = [
    f.status ? { status: f.status } : null,
    f.departureType ? { departureType: f.departureType } : null,
    f.measurementCohort ? { measurementCohort: f.measurementCohort } : null,
    f.recordPurpose ? { recordPurpose: f.recordPurpose } : null,
    f.q
      ? {
          OR: [
            { caseNumber: { contains: f.q, mode: 'insensitive' as const } },
            // Employee-name search must not match rows the actor cannot read
            // in full; restricted rows are searchable by case number only.
            {
              employeeDisplayName: { contains: f.q, mode: 'insensitive' as const },
              ...(isHr
                ? {
                    OR: [
                      { classification: 'CONFIDENTIAL' as const },
                      { participants: { some: { userId: actor.userId, removedAt: null } } },
                    ],
                  }
                : { classification: 'CONFIDENTIAL' as const }),
            },
          ],
        }
      : null,
  ].filter((x): x is NonNullable<typeof x> => x !== null);

  const rows = await getPrisma().offboardingCase.findMany({
    where: { AND: [visibility, ...filters] },
    orderBy: [{ createdAt: 'desc' }],
    take: 100,
    include: { participants: { where: { removedAt: null }, select: { userId: true } } },
  });

  return rows.map((c) => {
    const ctx: CaseAccessContext = {
      ownerId: c.ownerId,
      classification: c.classification,
      participantUserIds: c.participants.map((p) => p.userId),
    };
    const full = canViewCase(actor, ctx);
    return {
      id: c.id,
      caseNumber: c.caseNumber,
      status: c.status,
      departureType: c.departureType,
      classification: c.classification,
      measurementCohort: c.measurementCohort,
      recordPurpose: c.recordPurpose,
      employeeDisplayName: full ? c.employeeDisplayName : '(restricted case)',
      department: full ? c.department : null,
      location: full ? c.location : null,
      effectiveSeparationAt: full ? c.effectiveSeparationAt : null,
      receivedAt: c.receivedAt,
      createdAt: c.createdAt,
      minimized: !full,
    };
  });
}

// --- draft edit --------------------------------------------------------------

export async function updateDraft(actor: Actor, caseId: string, rawPatch: unknown) {
  const { c, ctx } = await loadCaseWithAccess(caseId);
  assertView(actor, ctx);
  if (!canActOnCase(actor, 'case.editDraft', ctx)) throw ServiceError.forbidden();
  if (c.status !== 'DRAFT')
    throw ServiceError.conflict('Only DRAFT cases can be edited; use a correction instead.');

  const parsed = updateDraftSchema.safeParse(rawPatch);
  if (!parsed.success)
    throw ServiceError.validation(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  const patch = parsed.data;

  if (patch.receivedAt && patch.receivedAt.getTime() > Date.now() + 5 * 60_000) {
    throw ServiceError.validation(['Receipt time cannot be in the future.']);
  }

  const nextCohort =
    patch.measurementCohort !== undefined ? patch.measurementCohort : c.measurementCohort;
  const nextPurpose = patch.recordPurpose ?? c.recordPurpose;
  // Record-purpose changes go through the audited correction path, not edits.
  if (nextPurpose !== c.recordPurpose) {
    throw ServiceError.validation([
      'Record purpose cannot be changed by editing; use the audited purpose correction.',
    ]);
  }
  const cohortErrors = cohortPurposeErrors({
    measurementCohort: nextCohort,
    recordPurpose: nextPurpose,
  });
  if (cohortErrors.length) throw ServiceError.validation(cohortErrors);

  if (
    c.departureType === 'TERMINATION' &&
    patch.departureType &&
    patch.departureType !== 'TERMINATION'
  ) {
    throw ServiceError.validation([
      'A termination case cannot be re-typed; void it and create the correct case.',
    ]);
  }

  const changedFields = Object.keys(patch);
  const correlationId = newCorrelationId();
  await getPrisma().$transaction(async (tx) => {
    const updated = await tx.offboardingCase.updateMany({
      where: { id: caseId, version: c.version, status: 'DRAFT' },
      data: {
        ...('departureType' in patch && patch.departureType
          ? {
              departureType: patch.departureType,
              classification:
                patch.departureType === 'TERMINATION' ? 'RESTRICTED' : c.classification,
            }
          : {}),
        ...('receivedAt' in patch && patch.receivedAt ? { receivedAt: patch.receivedAt } : {}),
        ...('receiptSource' in patch && patch.receiptSource
          ? { receiptSource: patch.receiptSource }
          : {}),
        ...('proposedLastDay' in patch ? { proposedLastDay: patch.proposedLastDay ?? null } : {}),
        ...('confirmedLastDay' in patch
          ? { confirmedLastDay: patch.confirmedLastDay ?? null }
          : {}),
        ...('effectiveSeparationAt' in patch
          ? { effectiveSeparationAt: patch.effectiveSeparationAt ?? null }
          : {}),
        ...('department' in patch && patch.department ? { department: patch.department } : {}),
        ...('location' in patch && patch.location ? { location: patch.location } : {}),
        ...('measurementCohort' in patch ? { measurementCohort: patch.measurementCohort } : {}),
        ...('reasonCaptureStatus' in patch && patch.reasonCaptureStatus
          ? { reasonCaptureStatus: patch.reasonCaptureStatus }
          : {}),
        ...('reasonCategoryId' in patch
          ? { reasonCategoryId: patch.reasonCategoryId ?? null }
          : {}),
        ...('reasonNotes' in patch ? { reasonNotes: patch.reasonNotes || null } : {}),
        ...('noticeProvidedDays' in patch
          ? { noticeProvidedDays: patch.noticeProvidedDays ?? null }
          : {}),
        ...('noticeRequiredDays' in patch
          ? { noticeRequiredDays: patch.noticeRequiredDays ?? null }
          : {}),
        ...('noticeTreatment' in patch ? { noticeTreatment: patch.noticeTreatment || null } : {}),
        version: { increment: 1 },
      },
    });
    if (updated.count === 0)
      throw ServiceError.conflict('The case was changed by someone else; reload and retry.');

    await appendAudit(tx, {
      eventType: 'CASE_UPDATED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'OffboardingCase',
      objectId: caseId,
      caseId,
      result: 'SUCCESS',
      correlationId,
      // Field names only - values may be sensitive (REQ-SEC-023).
      metadata: { changedFields: changedFields.join(',') },
    });
  });
}

// --- transitions -------------------------------------------------------------

/**
 * Intake-segment actions handled by this generic transition. The Stage 3
 * operational transitions (activate/hold/resume/clearance/complete/reopen)
 * have dedicated services with their own side effects.
 */
export type IntakeTransitionAction = Extract<
  CaseTransitionAction,
  'submit' | 'return' | 'approve' | 'cancel' | 'void'
>;

const TRANSITION_EVENT: Record<
  IntakeTransitionAction,
  'CASE_SUBMITTED' | 'CASE_RETURNED_TO_DRAFT' | 'CASE_APPROVED' | 'CASE_CANCELLED' | 'CASE_VOIDED'
> = {
  submit: 'CASE_SUBMITTED',
  return: 'CASE_RETURNED_TO_DRAFT',
  approve: 'CASE_APPROVED',
  cancel: 'CASE_CANCELLED',
  void: 'CASE_VOIDED',
};

const TRANSITION_PERMISSION: Record<
  IntakeTransitionAction,
  'case.submit' | 'case.return' | 'case.approve' | 'case.cancel' | 'case.void'
> = {
  submit: 'case.submit',
  return: 'case.return',
  approve: 'case.approve',
  cancel: 'case.cancel',
  void: 'case.void',
};

export async function transitionCase(
  actor: Actor,
  caseId: string,
  action: IntakeTransitionAction,
  reason?: string,
) {
  const { c, ctx } = await loadCaseWithAccess(caseId);
  assertView(actor, ctx);
  if (!canActOnCase(actor, TRANSITION_PERMISSION[action], ctx)) {
    await auditDenied(actor, 'ACCESS_DENIED', 'OffboardingCase', caseId, caseId);
    throw ServiceError.forbidden();
  }

  const check = checkTransition(action, c.status, reason);
  if (!check.ok) throw ServiceError.validation([check.error ?? 'Invalid transition.']);

  if (action === 'submit') {
    const readiness = submitReadinessErrors({
      departureType: c.departureType,
      receivedAt: c.receivedAt,
      receiptSource: c.receiptSource,
      effectiveSeparationAt: c.effectiveSeparationAt,
      ownerId: c.ownerId,
      department: c.department,
      location: c.location,
      employeeSourceId: c.employeeSourceId,
    });
    if (readiness.length) throw ServiceError.validation(readiness);
    const cohortErrors = cohortPurposeErrors({
      measurementCohort: c.measurementCohort,
      recordPurpose: c.recordPurpose,
    });
    if (cohortErrors.length) throw ServiceError.validation(cohortErrors);
  }

  const correlationId = newCorrelationId();
  const prisma = getPrisma();

  await prisma.$transaction(async (tx) => {
    const to = check.to!;
    const closing = to === 'CANCELLED' || to === 'VOIDED';
    const updated = await tx.offboardingCase.updateMany({
      where: { id: caseId, version: c.version, status: c.status },
      data: {
        status: to,
        version: { increment: 1 },
        ...(closing ? { closedAt: new Date(), closeReason: reason ?? null } : {}),
      },
    });
    if (updated.count === 0)
      throw ServiceError.conflict('The case was changed by someone else; reload and retry.');

    // Approval captures the immutable snapshot exactly once (BR-CASE-003).
    if (action === 'approve') {
      const existing = await tx.employeeSnapshot.findUnique({ where: { caseId } });
      if (existing) throw ServiceError.conflict('A snapshot already exists for this case.');
      const source = await tx.employeeSourceRecord.findUnique({
        where: {
          sourceSystem_sourceId: {
            sourceSystem: c.employeeSourceSystem,
            sourceId: c.employeeSourceId,
          },
        },
      });
      if (!source)
        throw ServiceError.conflict('Employee source record missing; cannot capture snapshot.');
      const payload = buildSnapshotPayload(
        {
          sourceSystem: source.sourceSystem,
          sourceId: source.sourceId,
          displayName: source.displayName,
          workEmail: source.workEmail ?? '',
          jobTitle: source.jobTitle ?? '',
          department: source.department ?? '',
          location: source.location ?? '',
        },
        source.retrievedAt,
      );
      await tx.employeeSnapshot.create({
        data: {
          caseId,
          sourceSystem: payload.sourceSystem,
          sourceId: payload.sourceId,
          retrievedAt: source.retrievedAt,
          capturedById: actor.userId,
          payload: { ...payload },
          checksum: snapshotChecksum(payload),
          schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        },
      });
    }

    // Stage 3 (C.4/C.5): closing an operational case cancels its incomplete
    // workflow tasks and open notifications while preserving all evidence.
    if (to === 'CANCELLED' || to === 'VOIDED') {
      await cancelLiveWorkflowForCaseTx(tx, caseId, actor, to, reason ?? '', correlationId);
    }

    await tx.caseStatusHistory.create({
      data: {
        caseId,
        fromStatus: c.status,
        toStatus: check.to!,
        actorId: actor.userId,
        reason: reason ?? null,
        correlationId,
      },
    });

    await appendAudit(tx, {
      eventType: TRANSITION_EVENT[action],
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'OffboardingCase',
      objectId: caseId,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { caseNumber: c.caseNumber, fromStatus: c.status, toStatus: check.to!, reason },
    });
  });
}

// --- audited corrections (REQ-PRIV-010) -------------------------------------

export async function changeEffectiveTime(
  actor: Actor,
  caseId: string,
  newTime: Date,
  reason: string,
) {
  const { c, ctx } = await loadCaseWithAccess(caseId);
  assertView(actor, ctx);
  if (!canActOnCase(actor, 'case.changeEffectiveTime', ctx)) throw ServiceError.forbidden();
  if (!reason.trim())
    throw ServiceError.validation([
      'A reason is required to change the effective time (BR-CASE-007).',
    ]);
  if (['VOIDED', 'CANCELLED'].includes(c.status))
    throw ServiceError.conflict('Closed cases cannot be changed.');

  const correlationId = newCorrelationId();
  await getPrisma().$transaction(async (tx) => {
    const updated = await tx.offboardingCase.updateMany({
      where: { id: caseId, version: c.version },
      data: { effectiveSeparationAt: newTime, version: { increment: 1 } },
    });
    if (updated.count === 0) throw ServiceError.conflict('The case was changed; reload and retry.');
    await appendAudit(tx, {
      // Stage 2: a material case correction invalidates affected document and
      // form approvals (Directive 2 D.12 / F.11) - handled after commit below.
      eventType: 'CASE_EFFECTIVE_TIME_CHANGED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'OffboardingCase',
      objectId: caseId,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        caseNumber: c.caseNumber,
        oldValue: c.effectiveSeparationAt?.toISOString() ?? null,
        newValue: newTime.toISOString(),
        reason,
      },
    });
  });

  // Material correction ripple (Directive 2 D.12 / F.11): outdate affected
  // documents and forms; issued artefacts are never touched.
  const rippleReason = 'effective separation time changed';
  await outdateDocumentsForCaseChange(caseId, rippleReason);
  await outdateFormsForCaseChange(caseId, rippleReason);
  // Stage 3 ripple (E.5-E.7 / K.5): recalculate workflow due dates with full
  // provenance and invalidate affected notification approvals.
  await recalcTasksForEffectiveChange(caseId, actor, `${rippleReason}: ${reason}`);
  await supersedeNotificationsForCaseChange(caseId, rippleReason);
}

export async function correctRecordPurpose(
  actor: Actor,
  caseId: string,
  to: 'OPERATIONAL' | 'TRAINING' | 'TEST',
  reason: string,
) {
  const { c, ctx } = await loadCaseWithAccess(caseId);
  assertView(actor, ctx);
  if (!canActOnCase(actor, 'case.correct', ctx)) throw ServiceError.forbidden();

  const errors = purposeChangeErrors({
    from: c.recordPurpose,
    to,
    caseStatus: c.status,
    reason,
  });
  if (errors.length) throw ServiceError.validation(errors);

  // Moving to OPERATIONAL requires a cohort; moving away clears it.
  const newCohort = to === 'OPERATIONAL' ? (c.measurementCohort ?? 'BASELINE') : null;

  const correlationId = newCorrelationId();
  await getPrisma().$transaction(async (tx) => {
    const updated = await tx.offboardingCase.updateMany({
      where: { id: caseId, version: c.version },
      data: { recordPurpose: to, measurementCohort: newCohort, version: { increment: 1 } },
    });
    if (updated.count === 0) throw ServiceError.conflict('The case was changed; reload and retry.');
    await appendAudit(tx, {
      eventType: 'CASE_PURPOSE_CORRECTED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'OffboardingCase',
      objectId: caseId,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { caseNumber: c.caseNumber, oldValue: c.recordPurpose, newValue: to, reason },
    });
  });
}

export async function setRehireEligibility(
  actor: Actor,
  caseId: string,
  value: 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'CONDITIONAL' | null,
) {
  const { c, ctx } = await loadCaseWithAccess(caseId);
  assertView(actor, ctx);
  if (!canActOnCase(actor, 'case.setRehire', ctx)) {
    await auditDenied(actor, 'ACCESS_DENIED', 'OffboardingCase', caseId, caseId);
    throw ServiceError.forbidden();
  }
  const correlationId = newCorrelationId();
  await getPrisma().$transaction(async (tx) => {
    const updated = await tx.offboardingCase.updateMany({
      where: { id: caseId, version: c.version },
      data: { rehireEligibility: value, version: { increment: 1 } },
    });
    if (updated.count === 0) throw ServiceError.conflict('The case was changed; reload and retry.');
    await appendAudit(tx, {
      eventType: 'CASE_REHIRE_ELIGIBILITY_SET',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'OffboardingCase',
      objectId: caseId,
      caseId,
      result: 'SUCCESS',
      correlationId,
      // The value itself is RESTRICTED_HR - the audit records the act only.
      metadata: { caseNumber: c.caseNumber, cleared: value === null },
    });
  });
}

// --- participants ------------------------------------------------------------

export async function addParticipant(
  actor: Actor,
  caseId: string,
  userId: string,
  participantRole: 'HR_SUPPORT' | 'OVERSIGHT' | 'FINANCE' | 'MANAGER',
  reason: string,
) {
  const { ctx, c } = await loadCaseWithAccess(caseId);
  assertView(actor, ctx);
  if (!canActOnCase(actor, 'case.manageParticipants', ctx)) throw ServiceError.forbidden();
  if (!reason.trim()) throw ServiceError.validation(['A reason is required.']);

  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { roleAssignments: { where: { revokedAt: null } } },
  });
  if (!user || !user.isActive) throw ServiceError.validation(['Unknown or inactive user.']);
  const targetRoles = user.roleAssignments.map((r) => r.role);
  if (
    participantRole === 'HR_SUPPORT' &&
    !targetRoles.some((r) => r === 'HR_MANAGER' || r === 'HR_OFFICER')
  ) {
    throw ServiceError.validation(['HR support participants must hold an HR role.']);
  }
  if (
    participantRole === 'OVERSIGHT' &&
    !targetRoles.some((r) => r === 'AUDITOR' || r === 'PRIVACY_OFFICER')
  ) {
    throw ServiceError.validation(['Oversight participants must hold an oversight role.']);
  }
  // Stage 2: scoped action-form participants (Directive 2 section F).
  if (participantRole === 'FINANCE' && !targetRoles.includes('FINANCE_RESPONDER')) {
    throw ServiceError.validation(['Finance participants must hold the FINANCE_RESPONDER role.']);
  }
  if (participantRole === 'MANAGER' && !targetRoles.includes('LINE_MANAGER')) {
    throw ServiceError.validation(['Manager participants must hold the LINE_MANAGER role.']);
  }

  const existing = await prisma.caseParticipant.findFirst({
    where: { caseId, userId, removedAt: null },
  });
  if (existing) throw ServiceError.conflict('The user is already a participant.');

  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    await tx.caseParticipant.create({
      data: { caseId, userId, participantRole, reason, addedById: actor.userId },
    });
    await appendAudit(tx, {
      eventType: 'CASE_PARTICIPANT_ADDED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'CaseParticipant',
      objectId: userId,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { caseNumber: c.caseNumber, participantRole, reason },
    });
  });
}

export async function removeParticipant(
  actor: Actor,
  caseId: string,
  userId: string,
  reason: string,
) {
  const { ctx, c } = await loadCaseWithAccess(caseId);
  assertView(actor, ctx);
  if (!canActOnCase(actor, 'case.manageParticipants', ctx)) throw ServiceError.forbidden();
  if (!reason.trim()) throw ServiceError.validation(['A reason is required.']);
  if (userId === c.ownerId)
    throw ServiceError.validation([
      'The accountable owner cannot be removed; reassign ownership first.',
    ]);

  const prisma = getPrisma();
  const row = await prisma.caseParticipant.findFirst({
    where: { caseId, userId, removedAt: null },
  });
  if (!row) throw ServiceError.notFound('No active participation found.');

  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    await tx.caseParticipant.update({
      where: { id: row.id },
      data: { removedAt: new Date(), removedById: actor.userId, removeReason: reason },
    });
    await appendAudit(tx, {
      eventType: 'CASE_PARTICIPANT_REMOVED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'CaseParticipant',
      objectId: userId,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { caseNumber: c.caseNumber, reason },
    });
  });
}

// --- notes (REQ-CASE-019) ----------------------------------------------------

export async function addNote(
  actor: Actor,
  caseId: string,
  body: string,
  visibility: 'HR_ONLY' | 'HR_AND_OVERSIGHT',
  supersedesId?: string,
) {
  const { ctx } = await loadCaseWithAccess(caseId);
  assertView(actor, ctx);
  if (!canActOnCase(actor, 'case.addNote', ctx)) throw ServiceError.forbidden();
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > 4000)
    throw ServiceError.validation(['Note must be between 1 and 4000 characters.']);

  const prisma = getPrisma();
  if (supersedesId) {
    const prior = await prisma.caseNote.findUnique({ where: { id: supersedesId } });
    if (!prior || prior.caseId !== caseId) throw ServiceError.notFound('Prior note not found.');
    if (prior.authorId !== actor.userId)
      throw ServiceError.forbidden('Only the author can revise a note.');
    const alreadySuperseded = await prisma.caseNote.findFirst({ where: { supersedesId } });
    if (alreadySuperseded) throw ServiceError.conflict('That note was already revised.');
  }

  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    await tx.caseNote.create({
      data: {
        caseId,
        authorId: actor.userId,
        visibility,
        body: trimmed,
        supersedesId: supersedesId ?? null,
      },
    });
    await appendAudit(tx, {
      eventType: 'CASE_NOTE_ADDED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'CaseNote',
      objectId: caseId,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { visibility, revision: Boolean(supersedesId) },
    });
  });
}

export async function listNotes(actor: Actor, caseId: string) {
  const { ctx } = await loadCaseWithAccess(caseId);
  assertView(actor, ctx);
  const hr =
    (actor.roles.includes('HR_MANAGER') || actor.roles.includes('HR_OFFICER')) &&
    canActOnCase(actor, 'case.addNote', ctx);
  const oversight = actor.roles.includes('AUDITOR') || actor.roles.includes('PRIVACY_OFFICER');
  const where = hr
    ? { caseId }
    : oversight
      ? { caseId, visibility: 'HR_AND_OVERSIGHT' as const }
      : { caseId, visibility: { in: [] as ('HR_ONLY' | 'HR_AND_OVERSIGHT')[] } };
  return getPrisma().caseNote.findMany({ where, orderBy: { createdAt: 'asc' } });
}
