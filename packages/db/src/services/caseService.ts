/**
 * Offboarding case service - every read and mutation enforces the domain
 * policy server-side (REQ-SEC-005/007) and appends audit evidence in the same
 * transaction as the change (Architecture.md section 8).
 */
import { z } from 'zod';
import {
  type Actor,
  buildSnapshotPayload,
  can,
  daysUntil,
  canActOnCase,
  canEditCase,
  hasRole,
  canDiscoverCase,
  canViewCase,
  type CaseAccessContext,
  caseNumberSearchTerm,
  DEPARTURE_TYPES,
  separationErrors,
  isDepartureType,
  separationProfile,
  defaultDates,
  separationUrgency,
  operativeDate,
  isBackdated,
  wholeDaysBetween,
  incompatibleDates,
  noticeApplies,
  noticeIsServed,
  type DepartureType,
  type SeparationDates,
  TERMINAL_STATUSES,
  caseNumberYearFor,
  type CaseTransitionAction,
  checkTransition,
  cohortPurposeErrors,
  DEFAULT_CLOSE_OF_BUSINESS,
  effectiveSeparationFromFinalDay,
  formatCaseNumber,
  noticeDaysProvided,
  parseInstantInZone,
  purposeChangeErrors,
  SNAPSHOT_SCHEMA_VERSION,
  snapshotChecksum,
  submitReadinessErrors,
  SYNTHETIC_EMPLOYEES,
  SyntheticEmployeeSourceAdapter,
} from '@exit/domain';
import { getPrisma } from '../client.ts';
import type { Prisma } from '../generated/client.ts';
import { resolveDirectoryManager } from './managerResolution.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, auditDenied, newCorrelationId } from './auditService.ts';
import { outdateDocumentsForCaseChange } from './documentService.ts';
import { outdateFormsForCaseChange } from './actionFormService.ts';
import { cancelLiveWorkflowForCaseTx, recalcTasksForEffectiveChange } from './workflowService.ts';
import { supersedeNotificationsForCaseChange } from './notificationService.ts';
import { getSystemConfigValue } from './systemConfigService.ts';

const employeeSource = new SyntheticEmployeeSourceAdapter();

// --- input schemas (REQ-NFR-005) --------------------------------------------

// Guard against JS date-coercion pitfalls: null/'' must mean "absent" and
// never silently coerce to the 1970 epoch. Strings are read as company-zone
// wall-clock time, because a bare `2026-08-28` from a date input otherwise
// becomes midnight UTC and displays as the 27th here (owner report,
// 2026-08-19).
const isoDate = z.union([z.string().min(1), z.number(), z.date()]).transform((value, ctx) => {
  if (typeof value === 'string') {
    const parsed = parseInstantInZone(value);
    if (parsed) return parsed;
    ctx.addIssue({ code: 'custom', message: 'Invalid date.' });
    return z.NEVER;
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    ctx.addIssue({ code: 'custom', message: 'Invalid date.' });
    return z.NEVER;
  }
  return d;
});
const optionalIsoDate = z
  .union([z.null(), z.literal('').transform(() => null), isoDate])
  .optional();
const shortText = (max: number) => z.string().trim().max(max);

export const createDraftSchema = z.object({
  employeeSourceId: shortText(40).min(1),
  departureType: z.enum(DEPARTURE_TYPES),
  receivedAt: isoDate,
  receiptSource: shortText(200).min(1),
  // One end-date field (owner request, 2026-08-18; DEC-064): `confirmedLastDay`
  // is the employment end date - the last working day, the one that drives
  // due dates, asset returns, letters and notice. The retired
  // `proposedLastDay` column keeps its historical values and is never
  // written again.
  confirmedLastDay: optionalIsoDate,
  // The effective instant is derived at close of business on the end date;
  // no intake form sends it. It stays accepted here so a caller with a
  // genuine exact instant (fixtures, an audited correction) can state it.
  effectiveSeparationAt: optionalIsoDate,
  /// The predetermined contractual completion date (directive 5, 11).
  contractEndDate: optionalIsoDate,
  /// HR's answer for OTHER only - every other type is answered by its
  /// profile and this is rejected if sent (directive 13, 30).
  noticeApplicableOverride: z.boolean().nullable().optional(),
  separationTypeDetail: shortText(300).optional(),
  authorizedByName: shortText(160).optional(),
  /// Why an unusual date relationship is correct. Audited (directive 25).
  dateOverrideReason: shortText(500).optional(),
  department: shortText(100).optional(),
  location: shortText(100).optional(),
  measurementCohort: z.enum(['BASELINE', 'PILOT', 'POST_ROLLOUT']).nullable().default('BASELINE'),
  recordPurpose: z.enum(['OPERATIONAL', 'TRAINING', 'TEST']).default('OPERATIONAL'),
  reasonCaptureStatus: z
    .enum(['PENDING', 'PROVIDED', 'NOT_PROVIDED', 'NOT_APPLICABLE'])
    .default('PENDING'),
  reasonCategoryId: z.uuid().nullable().optional(),
  reasonNotes: shortText(2000).optional(),
  /**
   * Existing-case protection (owner directive, 2026-09-15, section 24): when
   * the employee already has a LIVE case the intake shows it, and creating
   * another needs this explicit confirmation - so a duplicate can never be
   * made by accident. Still not a block (REQ-CASE-020 warns). The intake
   * sends true or false; undefined means "not an interactive intake".
   */
  duplicateAcknowledged: z.boolean().optional(),
  /**
   * Benefits and providers chosen DURING Create Offboarding Case (owner
   * directive 2026-09-22, DEC-066 sections 6-7): what the HR Manager will be
   * asked to approve. Absent means "not asked" (fixtures, the regression
   * bridge) and the historical UNKNOWN default applies.
   */
  groupHealth: z.enum(['YES', 'NO', 'UNKNOWN']).optional(),
  groupLife: z.enum(['YES', 'NO', 'UNKNOWN']).optional(),
  /**
   * DEC-066 section 34: an HR Manager creating a case may name the HR Officer
   * who will execute it. An HR Officer never sends this - they own what they
   * create (DEC-065).
   */
  assignedOfficerId: z.uuid().optional(),
});
export type CreateDraftInput = z.infer<typeof createDraftSchema>;

/**
 * Draft edits patch ONLY what the caller sends.
 *
 * `.partial()` alone was not enough: Zod still materializes a field's
 * `.default()` when the key is absent, so an edit that touched one date was
 * silently writing measurementCohort=BASELINE (disabling that case's
 * automation), resetting reasonCaptureStatus to PENDING, and tripping the
 * "record purpose cannot be changed by editing" guard on any non-OPERATIONAL
 * record. The defaulted fields are therefore re-declared without defaults,
 * and purpose/cohort are dropped entirely - neither is editable by design
 * (purpose has its own audited correction path). Found 2026-08-18.
 */
export const updateDraftSchema = createDraftSchema
  .partial()
  .omit({
    employeeSourceId: true,
    recordPurpose: true,
    measurementCohort: true,
    assignedOfficerId: true,
  })
  .extend({
    reasonCaptureStatus: z
      .enum(['PENDING', 'PROVIDED', 'NOT_PROVIDED', 'NOT_APPLICABLE'])
      .optional(),
  });
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
    assignedOfficerId: c.assignedOfficerId,
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

/**
 * Allocate the next case number (owner quality request, 2026-08-17):
 * OFF-YYYY-NNNN-C with the business-timezone year and a Damm check digit
 * (domain/caseNumber.ts). Runs INSIDE the creation transaction: the counter
 * row lock serializes concurrent creators for that year and a rolled-back
 * creation rolls the counter back with it - the sequence stays gapless.
 */
async function allocateCaseNumber(
  tx: Parameters<Parameters<ReturnType<typeof getPrisma>['$transaction']>[0]>[0],
  now: Date,
): Promise<string> {
  const year = caseNumberYearFor(now);
  const counter = await tx.caseNumberCounter.upsert({
    where: { year },
    create: { year, next: 2 },
    update: { next: { increment: 1 } },
  });
  // Both branches leave `next` pointing one past the allocated sequence.
  return formatCaseNumber(year, counter.next - 1);
}

/**
 * Configured close of business, e.g. "17:00" (system config
 * `case.closeOfBusiness`; company timezone).
 */
async function closeOfBusiness(): Promise<string> {
  const v = await getSystemConfigValue('case.closeOfBusiness');
  return typeof v === 'string' && v.trim() ? v : DEFAULT_CLOSE_OF_BUSINESS;
}

/**
 * Effective separation instant: employment ends at close of business on the
 * employment end date (the last working day), so HR never types a time the
 * platform can work out (owner request, 2026-08-18; every separation type
 * since DEC-064, 2026-09-22). The derived instant is what access removal is
 * timed to; the HR Manager may replace it with an audited correction.
 */
async function derivedEffectiveSeparation(
  departureType: string,
  confirmedLastDay: Date | null | undefined,
): Promise<Date | null> {
  if (!confirmedLastDay || !isDepartureType(departureType)) return null;
  // Every profile now hangs off the end date; the guard stays so a profile
  // that ever points elsewhere is not silently given a derived instant.
  if (separationProfile(departureType).effectiveDateSource !== 'confirmedLastDay') return null;
  return effectiveSeparationFromFinalDay(confirmedLastDay, await closeOfBusiness());
}

/**
 * The four date concepts a separation carries (directive 5), read off an
 * input or off a stored case. Written once so validation, defaulting and
 * downstream timing all see the same shape - the whole point of the
 * canonical model is that nobody re-derives this.
 */
function datesOf(source: {
  receivedAt?: Date | null;
  confirmedLastDay?: Date | null;
  effectiveSeparationAt?: Date | null;
  contractEndDate?: Date | null;
}): SeparationDates {
  return {
    receivedAt: source.receivedAt ?? null,
    confirmedLastDay: source.confirmedLastDay ?? null,
    effectiveSeparationAt: source.effectiveSeparationAt ?? null,
    contractEndDate: source.contractEndDate ?? null,
  };
}

/**
 * Server-side separation rules (directive 30). The form hides fields a type
 * does not use; this rejects them, so a direct API call cannot attach
 * resignation notice to a termination.
 */
function assertSeparationRules(input: {
  departureType: DepartureType;
  dates: SeparationDates;
  noticeApplicableOverride?: boolean | null;
  separationTypeDetail?: string | null;
  authorizedByName?: string | null;
  dateOverrideReason?: string | null;
}): void {
  const errors = separationErrors({
    type: input.departureType,
    dates: input.dates,
    noticeApplicableOverride: input.noticeApplicableOverride ?? null,
    separationTypeDetail: input.separationTypeDetail ?? null,
    authorizedByName: input.authorizedByName ?? null,
    dateOverrideReason: input.dateOverrideReason ?? null,
  });
  if (errors.length) throw ServiceError.validation(errors);

  // A profile that does not defer to HR must not be overridden by one. The
  // UI never offers this control outside OTHER; the server enforces it.
  const profile = separationProfile(input.departureType);
  if (profile.noticeApplicable !== null && input.noticeApplicableOverride != null) {
    throw ServiceError.validation([
      `Whether notice applies is determined by "${profile.label}" and cannot be set on the case.`,
    ]);
  }
}

// --- employee search ---------------------------------------------------------

export interface EmployeeSearchRow {
  sourceSystem: string;
  sourceId: string;
  /// Fixed-term contract end date where the directory holds one, so
  /// selecting End of contract reuses it (directive 11).
  contractEndDate?: Date | null;
  displayName: string;
  workEmail: string | null;
  jobTitle: string | null;
  department: string | null;
  location: string | null;
  /** Directive 6.2 (S): source-data confirmation on the intake screen. */
  employeeNumber: string | null;
  managerName: string | null;
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
            // The HR-assigned Employee # is what colleagues quote, so it has
            // to be searchable alongside the directory's internal record id
            // (owner question, 2026-08-18).
            { employeeNumber: { contains: q, mode: 'insensitive' } },
            { sourceId: { contains: q, mode: 'insensitive' } },
            { department: { contains: q, mode: 'insensitive' } },
            { jobTitle: { contains: q, mode: 'insensitive' } },
            { location: { contains: q, mode: 'insensitive' } },
            // Employee directory (2026-09-15): first, last and preferred
            // names, work email and manager are searchable too - all local.
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            { preferredName: { contains: q, mode: 'insensitive' } },
            { workEmail: { contains: q, mode: 'insensitive' } },
            { managerName: { contains: q, mode: 'insensitive' } },
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
    employeeNumber: r.employeeNumber,
    contractEndDate: r.contractEndDate,
    managerName: r.managerName,
    active: r.active,
    lastSyncedAt: r.retrievedAt,
  }));
  // Synthetic fixtures not yet cached in the database stay findable. This
  // is the in-memory fixture list, never a network call: the directory is
  // read from the local mirror alone (owner directive, 2026-09-15, section 39).
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
      employeeNumber: e.employeeNumber ?? null,
      managerName: e.managerName ?? null,
      active: e.active ?? true,
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
      // The employer's own Employee # - without this, every case created from
      // a cached directory row stamped null and the form printed nothing.
      employeeNumber: row.employeeNumber ?? null,
      // Fixed-term contract end date, where the source system holds one.
      // Selecting End of contract reuses it rather than asking HR to retype
      // a date that already exists (directive 11).
      contractEndDate: row.contractEndDate ?? null,
    };
  }
  const remote = await employeeSource.getById(sourceId);
  return remote ? { ...remote, contractEndDate: null } : remote;
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

  // Directive 6.1 (F): derive the reporting manager from the synchronized
  // directory at draft creation. The relationship is provenance for HR review
  // - never an automatic grant; activation still requires confirmation.
  const derived = await resolveDirectoryManager(employee.sourceSystem, employee.sourceId);
  const derivedManagerName = derived.managerName;
  const derivedManagerSourceId = derived.managerSourceId;
  const derivedManagerUserId = derived.managerUserId;
  const fixture =
    employee.sourceSystem === 'SYNTHETIC'
      ? SYNTHETIC_EMPLOYEES.find((s) => s.sourceId === employee.sourceId)
      : null;

  const cohortErrors = cohortPurposeErrors({
    measurementCohort: input.measurementCohort,
    recordPurpose: input.recordPurpose,
  });
  if (cohortErrors.length) throw ServiceError.validation(cohortErrors);

  if (input.receivedAt.getTime() > Date.now() + 5 * 60_000) {
    throw ServiceError.validation(['Receipt time cannot be in the future.']);
  }

  // DEC-066 section 34: only the HR Manager names another person as the
  // executing officer; the named account must be an active HR Officer (or
  // HR Manager). The same rule assignOfficer enforces, applied at creation.
  const isManager = hasRole(actor, 'HR_MANAGER');
  const namedOfficerId =
    input.assignedOfficerId && input.assignedOfficerId !== actor.userId
      ? input.assignedOfficerId
      : null;
  if (namedOfficerId && !isManager)
    throw ServiceError.forbidden('Only the HR Manager can assign a case to another HR Officer.');
  let namedOfficerName: string | null = null;
  if (namedOfficerId) {
    const target = await getPrisma().user.findUnique({
      where: { id: namedOfficerId },
      include: { roleAssignments: { where: { revokedAt: null }, select: { role: true } } },
    });
    if (!target || !target.isActive)
      throw ServiceError.validation(['The selected HR Officer does not exist or is inactive.']);
    const roles = target.roleAssignments.map((r) => r.role as string);
    if (!roles.includes('HR_OFFICER') && !roles.includes('HR_MANAGER'))
      throw ServiceError.validation([
        'The operational owner must hold the HR_OFFICER (or HR_MANAGER) role.',
      ]);
    namedOfficerName = target.displayName;
  }

  // Which separation this is decides everything below. Termination cases are
  // RESTRICTED by default and cannot be downgraded (DEC-035 / IC-S1-011);
  // the profile now carries that, along with redundancy.
  const profile = separationProfile(input.departureType);
  const classification = profile.restrictedByDefault ? 'RESTRICTED' : 'CONFIDENTIAL';

  // Contextual defaults: today for the dates this type opens with, and the
  // employee's own contract end date where the directory holds one - HR is
  // not asked to retype a date the platform already has (directive 6, 11).
  const defaults = defaultDates(input.departureType, retrievedAt, {
    contractEndDate: employee.contractEndDate ?? null,
  });
  const contractEndDate = input.contractEndDate ?? defaults.contractEndDate;
  // An end of contract ends on the contract end date unless HR states a
  // different last working day - including when HR typed the contract end
  // date because the directory holds none (DEC-058, DEC-064).
  const confirmedLastDay =
    input.confirmedLastDay ??
    defaults.confirmedLastDay ??
    (input.departureType === 'CONTRACT_EXPIRY' ? contractEndDate : null);

  // Employment ends at close of business on the end date for every
  // separation type (owner request 2026-08-18; DEC-064) unless the caller
  // states an exact instant.
  const effectiveSeparationAt =
    input.effectiveSeparationAt ??
    defaults.effectiveSeparationAt ??
    (await derivedEffectiveSeparation(input.departureType, confirmedLastDay)) ??
    (profile.effectiveDateSource === 'contractEndDate' ? contractEndDate : null);

  assertSeparationRules({
    departureType: input.departureType,
    dates: {
      receivedAt: input.receivedAt,
      confirmedLastDay,
      effectiveSeparationAt,
      contractEndDate,
    },
    noticeApplicableOverride: input.noticeApplicableOverride,
    separationTypeDetail: input.separationTypeDetail,
    authorizedByName: input.authorizedByName,
    dateOverrideReason: input.dateOverrideReason,
  });

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
  const liveDuplicates = duplicates.filter((d) => d.status !== 'COMPLETED');
  // The intake always says whether the confirmation was given (true/false);
  // a caller that does not take part in the intake at all - seeds, fixtures,
  // the regression bridge - leaves it undefined and is not asked (DEC-061).
  if (liveDuplicates.length > 0 && input.duplicateAcknowledged === false) {
    throw ServiceError.validation([
      `An active offboarding case already exists for this employee (${liveDuplicates
        .map((d) => d.caseNumber)
        .join(', ')}). Open it, or confirm that this is a separate separation event.`,
    ]);
  }

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
        managerName: derivedManagerName,
        managerSourceId: derivedManagerSourceId,
        division: fixture?.division ?? null,
        employeeNumber: fixture?.employeeNumber ?? null,
        active: fixture?.active ?? true,
        payload: { ...employee, managerName: derivedManagerName },
      },
      update: {
        // Refresh the basics only. Organization columns and the payload are
        // OWNED by the sync path - overwriting them here destroyed manager
        // provenance (Directive 6.1 bug fix).
        displayName: employee.displayName,
        workEmail: employee.workEmail,
        jobTitle: employee.jobTitle,
        department: employee.department,
        location: employee.location,
        retrievedAt,
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
        employeeNumber: employee.employeeNumber ?? null,
        employeeDisplayName: employee.displayName,
        employeeWorkEmail: employee.workEmail,
        department: input.department?.trim() || employee.department,
        location: input.location?.trim() || employee.location,
        jobTitle: employee.jobTitle,
        receivedAt: input.receivedAt,
        receiptSource: input.receiptSource,
        proposedLastDay: null,
        confirmedLastDay,
        effectiveSeparationAt,
        contractEndDate,
        noticeApplicableOverride: input.noticeApplicableOverride ?? null,
        separationTypeDetail: input.separationTypeDetail?.trim() || null,
        authorizedByName: input.authorizedByName?.trim() || null,
        dateOverrideReason: input.dateOverrideReason?.trim() || null,
        // Notice tracking has no product surface (owner, 2026-08-17); the
        // days-given figure still derives silently onto the record from
        // receipt -> confirmed last day - for the file only, never displayed
        // and never calculated from.
        // Notice days are only meaningful where a notice period is actually
        // served. A termination has no notice to count, and recording zero
        // there would read as "no notice given" rather than "not a concept".
        noticeProvidedDays: noticeIsServed(
          input.departureType,
          input.noticeApplicableOverride ?? null,
        )
          ? noticeDaysProvided(input.receivedAt, confirmedLastDay)
          : null,
        noticeRequiredDays: null,
        noticeTreatment: null,
        reasonCategoryId: input.reasonCategoryId ?? null,
        reasonCaptureStatus: input.reasonCaptureStatus,
        reasonNotes: input.reasonNotes || null,
        ownerId: actor.userId,
        createdById: actor.userId,
        // DEC-065: an HR Officer who creates a case owns it from the first
        // second - it is in their My Work and editable by them with no
        // assignment step. A case an HR Manager creates starts unassigned
        // until the manager assigns an officer. `createdById` above is the
        // immutable audit fact; this is the mutable operational owner.
        assignedOfficerId:
          namedOfficerId ??
          (hasRole(actor, 'HR_OFFICER') && !hasRole(actor, 'HR_MANAGER') ? actor.userId : null),
        // DEC-066 sections 6-7: the benefits and providers the HR Manager is
        // asked to approve are chosen at intake and persisted on the draft.
        ...(input.groupHealth !== undefined || input.groupLife !== undefined
          ? {
              groupHealthApplicability: input.groupHealth ?? 'UNKNOWN',
              groupLifeApplicability: input.groupLife ?? 'UNKNOWN',
              otherProviderApplicability: 'NO' as const,
              benefitsConfirmedById: actor.userId,
              benefitsConfirmedAt: retrievedAt,
              benefitsSource: 'INTAKE',
            }
          : {}),
        // Directive 6.1 (F): directory-derived manager routing, pending HR
        // review and confirmation on the Assignment tab.
        managerName: derivedManagerName,
        managerSourceId: derivedManagerSourceId,
        managerUserId: derivedManagerUserId,
        managerSource: derivedManagerName || derivedManagerSourceId ? 'DIRECTORY' : null,
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
    // An officer named by the HR Manager participates as HR_SUPPORT, exactly
    // as assignOfficer records it, so restricted-case participation holds.
    if (namedOfficerId) {
      await tx.caseParticipant.create({
        data: {
          caseId: c.id,
          userId: namedOfficerId,
          participantRole: 'HR_SUPPORT',
          reason: 'Assigned operational HR Officer at case creation (DEC-066).',
          addedById: actor.userId,
        },
      });
    }

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

    // The automatic initial assignment is audited like a manual one, so the
    // ownership history reads the same whichever way it began (DEC-065).
    if (c.assignedOfficerId) {
      const creator = await tx.user.findUnique({
        where: { id: actor.userId },
        select: { displayName: true },
      });
      await appendAudit(tx, {
        eventType: 'CASE_OFFICER_ASSIGNED',
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
          previousOfficerId: null,
          previousOfficerName: null,
          newOfficerId: c.assignedOfficerId,
          newOfficerName: namedOfficerId ? namedOfficerName : (creator?.displayName ?? null),
          reason: namedOfficerId
            ? 'Assigned by the HR Manager at case creation.'
            : 'Automatic initial assignment: the HR Officer who created the case owns it.',
          automatic: !namedOfficerId,
        },
      });
    }
    if (input.groupHealth !== undefined || input.groupLife !== undefined) {
      await appendAudit(tx, {
        eventType: 'BENEFITS_APPLICABILITY_SET',
        actorType: 'USER',
        actorId: actor.userId,
        effectiveRoles: actor.roles,
        objectType: 'OffboardingCase',
        objectId: c.id,
        caseId: c.id,
        result: 'SUCCESS',
        correlationId,
        metadata: {
          groupHealth: input.groupHealth ?? 'UNKNOWN',
          groupLife: input.groupLife ?? 'UNKNOWN',
          otherProvider: 'NO',
          source: 'INTAKE',
        },
      });
    }

    if (derivedManagerName || derivedManagerSourceId) {
      await appendAudit(tx, {
        eventType: 'CASE_MANAGER_DERIVED',
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
          managerName: derivedManagerName,
          managerSourceId: derivedManagerSourceId,
          resolvedUserId: derivedManagerUserId,
          sourceSystem: employee.sourceSystem,
          lastSyncedAt: derived.lastSyncedAt,
        },
      });
    }

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
  /// True for a reviewer holding a DRAFT: submit+approve in one audited step.
  canApproveDraft: boolean;
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
  /**
   * DEC-065: case edit authority. True for the HR Manager and for the
   * assigned HR Officer; false means the viewer is read-only on this case
   * (the UI says "view only" and offers no edit controls).
   */
  canEdit: boolean;
  /**
   * DEC-066: the one HR Manager decision. True when this viewer can open the
   * Case Approval Summary with live Approve / Return controls (a manager
   * holding a submitted case, or their own draft).
   */
  canDecideApproval: boolean;
}

/**
 * The most recent return-to-draft, shown to the officer on the draft so the
 * reason for the return is never something they have to dig out of the
 * audit trail (DEC-066 section 23). Null once the case has moved on.
 */
export interface CaseReturnNote {
  reason: string | null;
  returnedById: string;
  returnedAt: Date;
}

/**
 * What the separation MEANS for this case, derived once on the server.
 *
 * The case header, the dashboard and every downstream screen read this
 * rather than each deciding for itself whether a departure is urgent
 * (directive 17, 28). It is derived, never stored: it changes when the
 * clock moves past the effective date, and a stored copy would go stale.
 */
export function separationSummaryOf(
  c: {
    departureType: string;
    receivedAt: Date;
    confirmedLastDay: Date | null;
    effectiveSeparationAt: Date | null;
    contractEndDate: Date | null;
    noticeApplicableOverride: boolean | null;
    createdAt: Date;
  },
  now: Date = new Date(),
) {
  const type = isDepartureType(c.departureType) ? c.departureType : 'OTHER';
  const profile = separationProfile(type);
  const dates = datesOf(c);
  const operative = operativeDate(type, dates);
  return {
    type,
    label: profile.label,
    receivedDateLabel: profile.receivedDateLabel,
    initiator: profile.initiator,
    noticeApplies: noticeApplies(type, c.noticeApplicableOverride),
    noticeServed: noticeIsServed(type, c.noticeApplicableOverride),
    noticeArrangement: profile.noticeArrangement,
    urgency: separationUrgency(type, dates, now),
    /// The single date the operational timing hangs off.
    operativeDate: operative,
    /// Negative once the departure has passed. Null when no date is set yet.
    daysUntilDeparture: operative ? wholeDaysBetween(now, operative) : null,
    /// Entered after the event. Legitimate and supported, never blocked -
    /// but worth saying out loud so nobody reads it as live work.
    backdated: isBackdated(type, dates, c.createdAt),
    dates,
  };
}
export type SeparationSummary = ReturnType<typeof separationSummaryOf>;

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
    // The HR Manager IS the reviewer: a draft in their hands can go straight
    // to approval. Both transitions still run and are audited - the shortcut
    // is one click, never one record.
    canApproveDraft: canActOnCase(actor, 'case.approve', ctx) && c.status === 'DRAFT',
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
    canEdit: canEditCase(actor, ctx),
    canDecideApproval:
      canActOnCase(actor, 'case.approve', ctx) &&
      (c.status === 'PENDING_HR_REVIEW' || c.status === 'DRAFT'),
  };

  // The latest transition, so a draft can say why it came back (DEC-066).
  const lastTransition =
    c.status === 'DRAFT'
      ? await getPrisma().caseStatusHistory.findFirst({
          where: { caseId },
          orderBy: { occurredAt: 'desc' },
          select: {
            fromStatus: true,
            toStatus: true,
            reason: true,
            actorId: true,
            occurredAt: true,
          },
        })
      : null;
  const lastReturn: CaseReturnNote | null =
    lastTransition &&
    lastTransition.fromStatus === 'PENDING_HR_REVIEW' &&
    lastTransition.toStatus === 'DRAFT'
      ? {
          reason: lastTransition.reason,
          returnedById: lastTransition.actorId,
          returnedAt: lastTransition.occurredAt,
        }
      : null;

  // Field masking (REQ-CASE-026): sensitive values never leave the server for
  // unauthorized viewers.
  const dto = {
    ...c,
    rehireEligibility: capabilities.canViewRehire ? c.rehireEligibility : null,
    rehireMasked: !capabilities.canViewRehire,
    reasonNotes: capabilities.canViewReasonNotes ? c.reasonNotes : null,
    reasonNotesMasked: !capabilities.canViewReasonNotes,
  };

  return { case: dto, capabilities, separation: separationSummaryOf(c), lastReturn };
}

// --- list --------------------------------------------------------------------

const isHrActor = (actor: Actor) =>
  actor.roles.includes('HR_MANAGER') || actor.roles.includes('HR_OFFICER');

/**
 * Record-level visibility encoded in the query itself so counts, rows and
 * the filter values offered above them can never leak (REQ-SEC-008).
 * DEC-042: with the oversight roles removed, restricted rows are
 * discoverable only through participation.
 */
function caseVisibilityWhere(actor: Actor): Prisma.OffboardingCaseWhereInput {
  if (!isHrActor(actor)) return { id: { in: [] as string[] } };
  return {
    OR: [
      { classification: 'CONFIDENTIAL' as const },
      { participants: { some: { userId: actor.userId, removedAt: null } } },
      { ownerId: actor.userId },
    ],
  };
}

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
  departureType: z.enum(DEPARTURE_TYPES).optional(),
  measurementCohort: z.enum(['BASELINE', 'PILOT', 'POST_ROLLOUT']).optional(),
  recordPurpose: z.enum(['OPERATIONAL', 'TRAINING', 'TEST']).optional(),
  q: z.string().trim().max(100).optional(),
  /// Section 15: the questions HR actually asks a case list. Department and
  /// officer come straight off the case; the rest are derived at query time
  /// so a filter can never disagree with the row it produced.
  department: z.string().trim().max(120).optional(),
  officer: z.string().uuid().optional(),
  manager: z.string().trim().max(120).optional(),
  /// How close the departure is - or how far past it the case has run.
  leaving: z.enum(['overdue', 'week', 'month']).optional(),
  /// Whether the case needs somebody today: an overdue task or an open
  /// exception. Deliberately one filter, not two - "does this need me" is
  /// one question however the platform arrived at the answer.
  attention: z.enum(['yes']).optional(),
  /// Where the workflow has got to, as a plain band rather than a number.
  progress: z.enum(['not-started', 'underway', 'nearly-done', 'done']).optional(),
});
export type ListFilter = z.infer<typeof listFilterSchema>;

/**
 * Section 15: the values that exist to filter by, read from the cases the
 * actor may actually see. A filter offering a department with no cases in
 * it is a dead end, so the list is derived rather than enumerated.
 */
export async function listCaseFilterOptions(actor: Actor) {
  if (!can(actor, 'case.list')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const visible = caseVisibilityWhere(actor);
  const [departments, officers] = await Promise.all([
    prisma.offboardingCase.findMany({
      // department is not nullable on a case - every case carries one.
      where: visible,
      distinct: ['department'],
      select: { department: true },
      orderBy: { department: 'asc' },
      take: 100,
    }),
    prisma.offboardingCase.findMany({
      where: { AND: [visible, { assignedOfficerId: { not: null } }] },
      distinct: ['assignedOfficerId'],
      select: { assignedOfficer: { select: { id: true, displayName: true } } },
      take: 100,
    }),
  ]);
  return {
    departments: departments.map((d) => d.department).filter(Boolean),
    officers: officers
      .map((o) => o.assignedOfficer)
      .filter((o): o is { id: string; displayName: string } => o !== null)
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
  };
}

export async function listCases(actor: Actor, rawFilter: unknown = {}) {
  if (!can(actor, 'case.list')) throw ServiceError.forbidden();
  const parsed = listFilterSchema.safeParse(rawFilter);
  if (!parsed.success) throw ServiceError.validation(['Invalid filter.']);
  const f = parsed.data;

  const isHr = isHrActor(actor);
  const visibility = caseVisibilityWhere(actor);

  // One instant drives every time-based filter below and every derived row
  // value, so a case cannot be listed as overdue and then rendered as due.
  const asOf = new Date();
  const endOfWindow = (days: number) => new Date(asOf.getTime() + days * 86_400_000);
  const OPEN_TASK = ['READY', 'IN_PROGRESS', 'BLOCKED', 'NOT_READY'] as const;

  const filters = [
    f.status ? { status: f.status } : null,
    f.department ? { department: f.department } : null,
    f.officer ? { assignedOfficerId: f.officer } : null,
    f.manager ? { managerName: { contains: f.manager, mode: 'insensitive' as const } } : null,
    f.leaving === 'overdue'
      ? { effectiveSeparationAt: { lt: asOf }, status: { notIn: [...TERMINAL_STATUSES] } }
      : f.leaving === 'week'
        ? { effectiveSeparationAt: { gte: asOf, lte: endOfWindow(7) } }
        : f.leaving === 'month'
          ? { effectiveSeparationAt: { gte: asOf, lte: endOfWindow(30) } }
          : null,
    f.attention === 'yes'
      ? {
          OR: [
            {
              workflowTasks: {
                some: { dueAt: { lt: asOf }, status: { in: [...OPEN_TASK] } },
              },
            },
            { exceptions: { some: { resolvedAt: null } } },
          ],
        }
      : null,
    f.departureType ? { departureType: f.departureType } : null,
    f.measurementCohort ? { measurementCohort: f.measurementCohort } : null,
    f.recordPurpose ? { recordPurpose: f.recordPurpose } : null,
    f.q
      ? {
          OR: [
            // Case-number-aware search (domain/caseNumber.ts): a well-formed
            // number matches exactly (modern) or by prefix (legacy shape,
            // check digit omitted); anything else - including a mistyped
            // check digit - falls back to substring so lookups never
            // dead-end.
            (() => {
              const term = caseNumberSearchTerm(f.q!);
              if (term?.match === 'exact') return { caseNumber: term.value };
              if (term?.match === 'prefix')
                return { caseNumber: { startsWith: term.value, mode: 'insensitive' as const } };
              return { caseNumber: { contains: f.q!, mode: 'insensitive' as const } };
            })(),
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
    include: {
      participants: { where: { removedAt: null }, select: { userId: true } },
      assignedOfficer: { select: { displayName: true } },
      // Section 15: how far the case has run and whether anything is late.
      // Counted rather than loaded - the list needs three numbers per case,
      // not every task on it.
      _count: {
        select: {
          workflowTasks: { where: { required: true } },
          exceptions: { where: { resolvedAt: null } },
        },
      },
      workflowTasks: {
        where: { required: true },
        select: { status: true, dueAt: true },
      },
    },
  });

  // asOf drove the filters above; the same instant measures the rows, so
  // the list cannot disagree with itself.
  const now = asOf;
  const mapped = rows.map((c) => {
    const ctx: CaseAccessContext = {
      ownerId: c.ownerId,
      assignedOfficerId: c.assignedOfficerId,
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
      /// Days until employment ends - derived for display only.
      daysUntil: full && c.effectiveSeparationAt ? daysUntil(c.effectiveSeparationAt, now) : null,
      receivedAt: c.receivedAt,
      createdAt: c.createdAt,
      minimized: !full,
      /// Section 15: what the list needs to answer "where is this, and does
      /// it need me today". Restricted rows expose none of it.
      officerName: full ? (c.assignedOfficer?.displayName ?? null) : null,
      assignedOfficerId: full ? c.assignedOfficerId : null,
      /// DEC-065: whether THIS viewer may edit the case - the register shows
      /// every case, and marks the ones an officer can only read.
      editable: full && canEditCase(actor, ctx),
      managerName: full ? c.managerName : null,
      tasksTotal: full ? c.workflowTasks.length : 0,
      tasksDone: full
        ? c.workflowTasks.filter((w) => w.status === 'COMPLETED' || w.status === 'WAIVED').length
        : 0,
      tasksOverdue: full
        ? c.workflowTasks.filter(
            (w) =>
              w.dueAt !== null &&
              w.dueAt < now &&
              (OPEN_TASK as readonly string[]).includes(w.status),
          ).length
        : 0,
      openExceptions: full ? c._count.exceptions : 0,
    };
  });

  // Progress bands are derived from the task rows, so unlike the other
  // filters they cannot be pushed into the query. They therefore narrow the
  // page that came back rather than the whole table - accurate for the rows
  // shown, and honest about it: the list is capped at 100 either way.
  if (!f.progress) return mapped;
  return mapped.filter((r) => {
    if (r.tasksTotal === 0) return f.progress === 'not-started';
    const pct = (r.tasksDone / r.tasksTotal) * 100;
    if (f.progress === 'not-started') return pct === 0;
    if (f.progress === 'done') return pct === 100;
    if (f.progress === 'nearly-done') return pct >= 75 && pct < 100;
    return pct > 0 && pct < 75;
  });
}

/**
 * Small counts for the case tab strip, so a long case says where the work is
 * without opening every section (owner redesign, section 26). Read-only and
 * deliberately cheap: four counts, no joins, no case payload.
 */
export async function caseNavCounts(actor: Actor, caseId: string) {
  const { ctx } = await loadCaseWithAccess(caseId);
  assertView(actor, ctx);
  const prisma = getPrisma();
  const [assetsOutstanding, documents, emailsPending, tasksOpen] = await Promise.all([
    prisma.assetRecoveryItem.count({
      where: { caseId, status: { in: ['EXPECTED', 'REQUESTED', 'PARTIALLY_RETURNED'] } },
    }),
    prisma.documentInstance.count({
      where: { caseId, status: { notIn: ['VOIDED', 'SUPERSEDED'] } },
    }),
    prisma.notificationRecord.count({
      where: {
        caseId,
        status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'READY_FOR_MANUAL_SEND'] },
      },
    }),
    prisma.workflowTask.count({
      where: {
        instance: { caseId },
        status: { in: ['NOT_READY', 'READY', 'IN_PROGRESS', 'BLOCKED'] },
      },
    }),
  ]);
  return { assetsOutstanding, documents, emailsPending, tasksOpen };
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

  // Purpose and cohort are not editable here by design (the update schema
  // drops them; purpose has its own audited correction path), so the stored
  // pair is simply re-validated - an edit can never make it inconsistent.
  const cohortErrors = cohortPurposeErrors({
    measurementCohort: c.measurementCohort,
    recordPurpose: c.recordPurpose,
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

  // Moving the final working date carries the effective instant with it -
  // but ONLY while that instant is still the derived close-of-business value.
  // An explicitly entered time is a human decision and is never overwritten.
  const nextDepartureType = patch.departureType ?? c.departureType;
  const nextConfirmedLastDay =
    'confirmedLastDay' in patch ? (patch.confirmedLastDay ?? null) : c.confirmedLastDay;
  const nextContractEndDate =
    'contractEndDate' in patch ? (patch.contractEndDate ?? null) : c.contractEndDate;

  // Changing the separation type must never re-read one date as another: a
  // notice date is not a termination date (directive 16). Anything the new
  // type has no meaning for is named, and HR clears it deliberately - the
  // platform will not quietly drop or reinterpret it.
  if (patch.departureType && patch.departureType !== c.departureType) {
    const stranded = incompatibleDates(c.departureType, patch.departureType, {
      receivedAt: c.receivedAt,
      confirmedLastDay: nextConfirmedLastDay,
      effectiveSeparationAt: c.effectiveSeparationAt,
      contractEndDate: nextContractEndDate,
    });
    if (stranded.length > 0) {
      throw ServiceError.validation([
        `Changing this case to ${separationProfile(patch.departureType).label} would leave ` +
          `${stranded.length === 1 ? 'a value' : 'values'} that no longer mean anything: ` +
          `${stranded.join(', ')}. Clear ${stranded.length === 1 ? 'it' : 'them'} first - ` +
          'the platform will not reinterpret one date as another.',
      ]);
    }
  }
  const previouslyDerived = await derivedEffectiveSeparation(c.departureType, c.confirmedLastDay);
  const effectiveWasDerived =
    c.effectiveSeparationAt === null ||
    (previouslyDerived !== null &&
      c.effectiveSeparationAt.getTime() === previouslyDerived.getTime());
  const rederivedEffective =
    !('effectiveSeparationAt' in patch) && effectiveWasDerived
      ? await derivedEffectiveSeparation(nextDepartureType, nextConfirmedLastDay)
      : null;

  const nextEffective =
    'effectiveSeparationAt' in patch
      ? (patch.effectiveSeparationAt ?? null)
      : (rederivedEffective ?? c.effectiveSeparationAt);

  // The whole separation is re-validated after the patch, not just the fields
  // that were sent: changing the type can invalidate a date entered under the
  // old one, and the server is the authority either way (directive 30).
  assertSeparationRules({
    departureType: nextDepartureType,
    dates: {
      receivedAt: patch.receivedAt ?? c.receivedAt,
      confirmedLastDay: nextConfirmedLastDay,
      effectiveSeparationAt: nextEffective,
      contractEndDate: nextContractEndDate,
    },
    noticeApplicableOverride:
      'noticeApplicableOverride' in patch
        ? (patch.noticeApplicableOverride ?? null)
        : c.noticeApplicableOverride,
    separationTypeDetail:
      'separationTypeDetail' in patch ? patch.separationTypeDetail : c.separationTypeDetail,
    authorizedByName: 'authorizedByName' in patch ? patch.authorizedByName : c.authorizedByName,
    dateOverrideReason:
      'dateOverrideReason' in patch ? patch.dateOverrideReason : c.dateOverrideReason,
  });

  // Directive 31: the fields that drive access removal, payroll timing and
  // asset deadlines are audited with their old and new values, not merely
  // named. A date nobody can reconstruct is not traceable.
  const CRITICAL = [
    'departureType',
    'receivedAt',
    'confirmedLastDay',
    'effectiveSeparationAt',
    'contractEndDate',
  ] as const;
  const asAuditValue = (v: unknown) =>
    v instanceof Date ? v.toISOString() : v === null || v === undefined ? null : String(v);
  // Flat scalar keys, because audit metadata is deliberately flat and
  // PII-safe: sanitizeMetadata summarizes any nested array as "[array:n]",
  // which would have recorded that something changed while losing what.
  const criticalChanges: Record<string, string | null> = {};
  for (const field of CRITICAL) {
    if (!(field in patch)) continue;
    const before = asAuditValue((c as Record<string, unknown>)[field]);
    const after = asAuditValue((patch as Record<string, unknown>)[field]);
    if (before === after) continue;
    criticalChanges[`${field}.from`] = before;
    criticalChanges[`${field}.to`] = after;
  }
  const hasCriticalChanges = Object.keys(criticalChanges).length > 0;

  const changedFields = Object.keys(patch);
  const correlationId = newCorrelationId();
  await getPrisma().$transaction(async (tx) => {
    const updated = await tx.offboardingCase.updateMany({
      where: { id: caseId, version: c.version, status: 'DRAFT' },
      data: {
        ...('departureType' in patch && patch.departureType
          ? {
              departureType: patch.departureType,
              // A restricted-by-default type raises the classification; it is
              // never lowered by a re-type (DEC-035 / IC-S1-011).
              classification: separationProfile(patch.departureType).restrictedByDefault
                ? 'RESTRICTED'
                : c.classification,
            }
          : {}),
        ...('receivedAt' in patch && patch.receivedAt ? { receivedAt: patch.receivedAt } : {}),
        ...('receiptSource' in patch && patch.receiptSource
          ? { receiptSource: patch.receiptSource }
          : {}),
        ...('confirmedLastDay' in patch
          ? { confirmedLastDay: patch.confirmedLastDay ?? null }
          : {}),
        ...('effectiveSeparationAt' in patch
          ? { effectiveSeparationAt: patch.effectiveSeparationAt ?? null }
          : rederivedEffective
            ? { effectiveSeparationAt: rederivedEffective }
            : {}),
        ...('contractEndDate' in patch ? { contractEndDate: patch.contractEndDate ?? null } : {}),
        ...('noticeApplicableOverride' in patch
          ? { noticeApplicableOverride: patch.noticeApplicableOverride ?? null }
          : {}),
        ...('separationTypeDetail' in patch
          ? { separationTypeDetail: patch.separationTypeDetail?.trim() || null }
          : {}),
        ...('authorizedByName' in patch
          ? { authorizedByName: patch.authorizedByName?.trim() || null }
          : {}),
        ...('dateOverrideReason' in patch
          ? { dateOverrideReason: patch.dateOverrideReason?.trim() || null }
          : {}),
        ...('department' in patch && patch.department ? { department: patch.department } : {}),
        ...('location' in patch && patch.location ? { location: patch.location } : {}),
        ...('reasonCaptureStatus' in patch && patch.reasonCaptureStatus
          ? { reasonCaptureStatus: patch.reasonCaptureStatus }
          : {}),
        ...('reasonCategoryId' in patch
          ? { reasonCategoryId: patch.reasonCategoryId ?? null }
          : {}),
        ...('reasonNotes' in patch ? { reasonNotes: patch.reasonNotes || null } : {}),
        // DEC-066 section 9: the benefits selection is correctable while the
        // case is still a draft, from the same edit experience as the dates.
        ...('groupHealth' in patch || 'groupLife' in patch
          ? {
              groupHealthApplicability: patch.groupHealth ?? c.groupHealthApplicability,
              groupLifeApplicability: patch.groupLife ?? c.groupLifeApplicability,
              benefitsConfirmedById: actor.userId,
              benefitsConfirmedAt: new Date(),
              benefitsSource: 'INTAKE',
            }
          : {}),
        // Notice given re-derives whenever either anchoring date changes, or
        // when the type changes - a termination has no notice to count.
        ...('receivedAt' in patch || 'confirmedLastDay' in patch || 'departureType' in patch
          ? {
              noticeProvidedDays: noticeIsServed(
                nextDepartureType,
                'noticeApplicableOverride' in patch
                  ? (patch.noticeApplicableOverride ?? null)
                  : c.noticeApplicableOverride,
              )
                ? noticeDaysProvided(patch.receivedAt ?? c.receivedAt, nextConfirmedLastDay)
                : null,
            }
          : {}),
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
      // Field names only for the general case - values may be sensitive
      // (REQ-SEC-023). The separation dates are the exception the directive
      // requires: they are operational facts, carry no personal detail, and
      // drive access removal and payroll timing, so their before and after
      // are recorded (directive 31).
      metadata: {
        changedFields: changedFields.join(','),
        ...(hasCriticalChanges
          ? {
              ...criticalChanges,
              ...(patch.dateOverrideReason?.trim()
                ? { dateOverrideReason: patch.dateOverrideReason.trim() }
                : {}),
            }
          : {}),
      },
    });
    if ('groupHealth' in patch || 'groupLife' in patch) {
      await appendAudit(tx, {
        eventType: 'BENEFITS_APPLICABILITY_SET',
        actorType: 'USER',
        actorId: actor.userId,
        effectiveRoles: actor.roles,
        objectType: 'OffboardingCase',
        objectId: caseId,
        caseId,
        result: 'SUCCESS',
        correlationId,
        metadata: {
          groupHealth: patch.groupHealth ?? c.groupHealthApplicability,
          groupLife: patch.groupLife ?? c.groupLifeApplicability,
          otherProvider: c.otherProviderApplicability,
          previousGroupHealth: c.groupHealthApplicability,
          previousGroupLife: c.groupLifeApplicability,
          source: 'INTAKE',
          caseStatus: c.status,
        },
      });
    }
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

    // DEC-066 section 31: submission and approval name the case version and
    // the approved facts, so "what exactly was approved" is answerable from
    // the trail alone. Snapshot provenance rides on the approval event.
    const snapshotRow =
      action === 'approve'
        ? await tx.employeeSnapshot.findUnique({ where: { caseId }, select: { checksum: true } })
        : null;
    const approvedFacts =
      action === 'submit' || action === 'approve'
        ? {
            caseVersion: c.version + 1,
            departureType: c.departureType,
            confirmedLastDay: c.confirmedLastDay ? c.confirmedLastDay.toISOString() : null,
            effectiveSeparationAt: c.effectiveSeparationAt
              ? c.effectiveSeparationAt.toISOString()
              : null,
            groupHealth: c.groupHealthApplicability,
            groupLife: c.groupLifeApplicability,
            assignedOfficerId: c.assignedOfficerId,
            ...(snapshotRow ? { snapshotChecksum: snapshotRow.checksum } : {}),
          }
        : {};
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
      metadata: {
        caseNumber: c.caseNumber,
        fromStatus: c.status,
        toStatus: check.to!,
        reason,
        ...approvedFacts,
      },
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
  // Directive 6.3 B: the derived-action set depends on the effective instant
  // (schedules, idempotency event keys) - recompute deterministically.
  const { deriveActionsForCase } = await import('./derivedActionService.ts');
  await deriveActionsForCase(caseId, new Date());
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
  if (participantRole === 'OVERSIGHT') {
    // DEC-042: the oversight roles were removed from the active model; the
    // participant role remains in the schema for historical rows only.
    throw ServiceError.validation([
      'The OVERSIGHT participant role was retired with DEC-042 - add an HR support participant instead.',
    ]);
  }
  if (participantRole === 'FINANCE' || participantRole === 'MANAGER') {
    // DEC-063: Finance and the reporting manager hold no application login,
    // so they cannot be case participants. They are reached by controlled
    // email and secure links; the enum values stay for historical rows.
    throw ServiceError.validation([
      'Finance and Manager participants were retired with DEC-063 - Finance and the reporting manager are notified by email, not added as participants.',
    ]);
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
  // DEC-042: notes are HR-scoped; the historical HR_AND_OVERSIGHT visibility
  // value now reads as "HR" (the oversight audience no longer exists).
  const hr =
    (actor.roles.includes('HR_MANAGER') || actor.roles.includes('HR_OFFICER')) &&
    canActOnCase(actor, 'case.addNote', ctx);
  const where = hr
    ? { caseId }
    : { caseId, visibility: { in: [] as ('HR_ONLY' | 'HR_AND_OVERSIGHT')[] } };
  return getPrisma().caseNote.findMany({ where, orderBy: { createdAt: 'asc' } });
}
