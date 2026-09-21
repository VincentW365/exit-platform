/**
 * Employee directory synchronization engine (owner directive, 2026-09-15).
 *
 * BambooHR is the system of record; the platform keeps a read-only mirror in
 * `employee_source_record` that every feature reads. This engine is the ONLY
 * writer of that mirror. It is driven from five places and treats them all
 * the same way: a BambooHR webhook, the hourly reconciliation, the nightly
 * full reconciliation, the start-up staleness check and an administrator's
 * manual refresh. Each becomes a `DirectorySyncRun` row - queued, running,
 * then SUCCESS, PARTIAL or FAILED - and runs are executed one at a time
 * under a database lease so they can never corrupt one another.
 *
 * Rules kept here, not left to callers:
 *  - upserts are idempotent (matched by source id), so a repeated event is
 *    harmless;
 *  - a record absent from a FULL feed is archived, never deleted, and comes
 *    back if the source lists it again;
 *  - a failure part-way records the failure and leaves earlier valid data in
 *    place; an adapter failure leaves the whole mirror untouched;
 *  - counts and field NAMES are recorded, never employee values.
 */
import {
  DIRECTORY_SYNC_SETTINGS_KEY,
  FULL_SYNC_KINDS,
  can,
  directoryFieldChanges,
  directoryFreshness,
  hourlyDue,
  nightlyDue,
  parseDirectorySyncSettings,
  startupSyncNeeded,
  syncResultFromCounts,
  type Actor,
  type DirectoryFreshness,
  type DirectorySyncKind,
  type DirectorySyncSettings,
  type DirectorySyncStatus,
} from '@exit/domain';
import { getConfig } from '@exit/config';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';
import {
  SOURCE_SYSTEM_FOR_MODE,
  getBambooAdapter,
  resolveManagerIds,
  type BambooAdapter,
  type BambooEmployee,
} from './bamboohrService.ts';
import { getSystemConfigValue } from './systemConfigService.ts';

const PURGED_PREFIX = 'PURGED-';
const LEASE_KEY = 'directory.syncLease';
const LEASE_TTL_MS = 10 * 60_000;

// --- settings ------------------------------------------------------------------

export async function directorySyncSettings(): Promise<DirectorySyncSettings> {
  return parseDirectorySyncSettings(await getSystemConfigValue(DIRECTORY_SYNC_SETTINGS_KEY));
}

// --- lease -------------------------------------------------------------------------

/**
 * One synchronization at a time (section 31). The lease lives in
 * system_config so every process (web, worker, tests) sees the same one; it
 * is taken with a single conditional upsert, which the database serializes.
 */
export async function acquireDirectorySyncLease(
  holder: string,
  now = new Date(),
): Promise<boolean> {
  return acquireLease(holder, now);
}
export async function releaseDirectorySyncLease(holder: string): Promise<void> {
  return releaseLease(holder);
}

async function acquireLease(holder: string, now: Date): Promise<boolean> {
  const prisma = getPrisma();
  const value = JSON.stringify({
    holder,
    expiresAt: new Date(now.getTime() + LEASE_TTL_MS).toISOString(),
  });
  const changed = await prisma.$executeRaw`
    INSERT INTO system_config ("key", "value", "reason", "updatedAt")
    VALUES (${LEASE_KEY}, ${value}::jsonb, 'directory synchronization lease', now())
    ON CONFLICT ("key") DO UPDATE
      SET "value" = EXCLUDED."value", "updatedAt" = now()
      WHERE (system_config."value"->>'expiresAt')::timestamptz < now()
         OR system_config."value"->>'holder' = ${holder}`;
  return changed > 0;
}

async function releaseLease(holder: string): Promise<void> {
  const prisma = getPrisma();
  const value = JSON.stringify({ holder, expiresAt: new Date(0).toISOString() });
  await prisma.$executeRaw`
    UPDATE system_config SET "value" = ${value}::jsonb, "updatedAt" = now()
    WHERE "key" = ${LEASE_KEY} AND "value"->>'holder' = ${holder}`;
}

/** Test hook: whether someone currently holds the lease. */
export async function directorySyncLeaseHeld(now = new Date()): Promise<boolean> {
  const value = (await getSystemConfigValue(LEASE_KEY)) as { expiresAt?: string } | null;
  return !!value?.expiresAt && new Date(value.expiresAt).getTime() > now.getTime();
}

// --- requests -------------------------------------------------------------------------

export interface SyncRequest {
  kind: DirectorySyncKind;
  actor?: Actor;
  /** Webhook runs target the employees the event named. */
  employeeSourceIds?: string[];
  changedFields?: string[];
}

/**
 * Queue a run. A non-webhook run is not queued twice: an administrator who
 * presses "Refresh Directory Now" while a reconciliation is queued or running
 * gets that run back instead of a duplicate (section 17).
 */
/**
 * A run left QUEUED or RUNNING for longer than the lease can last belongs to
 * a process that died. It is closed as FAILED (ABANDONED) so it can never
 * block the deduplication above for good; nothing about the mirror changes.
 */
const ABANDON_AFTER_MS = 15 * 60_000;
export async function abandonStaleRuns(now = new Date()): Promise<number> {
  const prisma = getPrisma();
  const cutoff = new Date(now.getTime() - ABANDON_AFTER_MS);
  const r = await prisma.directorySyncRun.updateMany({
    where: { status: { in: ['QUEUED', 'RUNNING'] }, requestedAt: { lt: cutoff } },
    data: {
      status: 'FAILED',
      finishedAt: now,
      errorCode: 'ABANDONED',
      errorDetail:
        'The run did not finish within the allowed time; it was closed by a later process.',
    },
  });
  return r.count;
}

/** Audit a webhook delivery: counts and the rejection category only, never the body. */
export async function recordWebhookReceipt(input: {
  ok: boolean;
  reason?: string | null;
  employees: number;
  runIds: string[];
}): Promise<void> {
  const prisma = getPrisma();
  await appendAudit(prisma, {
    eventType: input.ok ? 'DIRECTORY_WEBHOOK_RECEIVED' : 'DIRECTORY_WEBHOOK_REJECTED',
    actorType: 'SYSTEM',
    effectiveRoles: [],
    objectType: 'DirectorySyncRun',
    objectId: input.runIds[0] ?? 'webhook',
    result: input.ok ? 'SUCCESS' : 'FAILURE',
    correlationId: newCorrelationId(),
    metadata: {
      employees: input.employees,
      runs: input.runIds.length,
      reason: input.reason ?? null,
    },
  });
}

export async function requestDirectorySync(
  input: SyncRequest,
): Promise<{ runIds: string[]; reused: boolean }> {
  const prisma = getPrisma();
  await abandonStaleRuns();
  if (input.kind !== 'WEBHOOK') {
    const active = await prisma.directorySyncRun.findFirst({
      where: { status: { in: ['QUEUED', 'RUNNING'] }, kind: { not: 'WEBHOOK' } },
      orderBy: { requestedAt: 'asc' },
    });
    if (active) return { runIds: [active.id], reused: true };
  }
  const correlationId = newCorrelationId();
  const targets = input.kind === 'WEBHOOK' ? (input.employeeSourceIds ?? []) : [null];
  const runIds: string[] = [];
  for (const target of targets) {
    const run = await prisma.directorySyncRun.create({
      data: {
        kind: input.kind,
        status: 'QUEUED',
        requestedById: input.actor?.userId ?? null,
        employeeSourceId: target,
        changedFields: input.changedFields ?? [],
        correlationId,
      },
    });
    runIds.push(run.id);
  }
  await appendAudit(prisma, {
    eventType: 'DIRECTORY_SYNC_REQUESTED',
    actorType: input.actor ? 'USER' : 'SYSTEM',
    actorId: input.actor?.userId,
    effectiveRoles: input.actor?.roles ?? [],
    objectType: 'DirectorySyncRun',
    objectId: runIds[0] ?? 'none',
    result: 'SUCCESS',
    correlationId,
    metadata: { kind: input.kind, runs: runIds.length },
  });
  return { runIds, reused: false };
}

/** Manual refresh from the administration screen (section 17). */
export async function requestManualDirectoryRefresh(
  actor: Actor,
): Promise<{ runId: string; reused: boolean }> {
  if (!can(actor, 'sync.run')) throw ServiceError.forbidden();
  const r = await requestDirectorySync({ kind: 'MANUAL', actor });
  return { runId: r.runIds[0]!, reused: r.reused };
}

// --- execution -------------------------------------------------------------------------

export interface SyncCounts {
  checked: number;
  added: number;
  updated: number;
  unchanged: number;
  archived: number;
  failed: number;
}

export interface SyncExecution extends SyncCounts {
  runId: string;
  kind: DirectorySyncKind;
  status: DirectorySyncStatus;
  mode: 'fixture' | 'live';
  sourceSystem: string;
  errorCode: string | null;
  /** Field-name changes per source id (values never included). */
  diffs: Array<{ sourceId: string; changes: string[] }>;
}

const safeErrorCode = (e: unknown): string => {
  if (e instanceof ServiceError) {
    const m = /BambooHR request failed: ([A-Z_]+)/.exec(e.details.join(' '));
    if (m) return m[1]!;
    return e.code;
  }
  return 'UNEXPECTED';
};
const safeErrorDetail = (e: unknown): string =>
  e instanceof ServiceError
    ? e.details.join(' ').slice(0, 300) || e.message.slice(0, 300)
    : 'The synchronization stopped unexpectedly; cached data stays in use.';

function nameParts(e: BambooEmployee): { firstName: string | null; lastName: string | null } {
  if (e.firstName || e.lastName)
    return { firstName: e.firstName ?? null, lastName: e.lastName ?? null };
  const parts = e.displayName.trim().split(/\s+/);
  if (parts.length < 2) return { firstName: parts[0] ?? null, lastName: null };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] ?? null };
}

const dateOnly = (v: string | null | undefined): Date | null =>
  v && /^\d{4}-\d{2}-\d{2}/.test(v) ? new Date(`${v.slice(0, 10)}T00:00:00.000Z`) : null;
const instant = (v: string | null | undefined): Date | null => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t);
};

/** Upsert one source row into the mirror; returns what happened. */
async function applyRow(
  sourceSystem: string,
  e: BambooEmployee,
  mode: 'fixture' | 'live',
  now: Date,
): Promise<{ outcome: 'added' | 'updated' | 'unchanged'; changes: string[] }> {
  const prisma = getPrisma();
  const parts = nameParts(e);
  const incoming = {
    displayName: e.displayName,
    firstName: parts.firstName,
    middleName: e.middleName ?? null,
    lastName: parts.lastName,
    preferredName: e.preferredName ?? null,
    workEmail: e.workEmail,
    workPhone: e.workPhone ?? null,
    workExtension: e.workExtension ?? null,
    jobTitle: e.jobTitle,
    department: e.department,
    division: e.division ?? null,
    location: e.location,
    employeeNumber: e.employeeNumber ?? null,
    employmentStatus: e.employmentStatus ?? (e.active ? 'Active' : 'Inactive'),
    hireDate: dateOnly(e.hireDate),
    managerName: e.managerName,
    managerSourceId: e.managerSourceId ?? null,
    active: e.active,
  };
  const provenance = {
    retrievedAt: now,
    lastSyncedAt: now,
    sourceUpdatedAt: instant(e.sourceUpdatedAt),
    // Minimum mapped provenance only - never a raw API response.
    payload: {
      active: e.active,
      managerName: e.managerName,
      syncSource: mode,
      syncedAt: now.toISOString(),
    },
  };
  const existing = await prisma.employeeSourceRecord.findUnique({
    where: { sourceSystem_sourceId: { sourceSystem, sourceId: e.sourceId } },
  });
  if (!existing) {
    await prisma.employeeSourceRecord.create({
      data: { sourceSystem, sourceId: e.sourceId, ...incoming, ...provenance, archivedAt: null },
    });
    return { outcome: 'added', changes: [] };
  }
  const changes = directoryFieldChanges(existing, incoming);
  const reappeared = existing.archivedAt !== null;
  if (changes.length === 0 && !reappeared) {
    await prisma.employeeSourceRecord.update({
      where: { id: existing.id },
      data: {
        lastSyncedAt: now,
        retrievedAt: now,
        sourceUpdatedAt: provenance.sourceUpdatedAt ?? existing.sourceUpdatedAt,
      },
    });
    return { outcome: 'unchanged', changes: [] };
  }
  await prisma.employeeSourceRecord.update({
    where: { id: existing.id },
    data: { ...incoming, ...provenance, archivedAt: null },
  });
  return { outcome: 'updated', changes: reappeared ? [...changes, 'archivedAt'] : changes };
}

/**
 * Link managers by IDENTIFIER (section 9): managerDirectoryId points at the
 * manager's own directory row. A source id wins; a name is used only when it
 * is unique within the source system. Ambiguity stays unlinked - never a guess.
 */
async function linkManagers(sourceSystem: string): Promise<void> {
  const prisma = getPrisma();
  const rows = await prisma.employeeSourceRecord.findMany({
    where: { sourceSystem, NOT: { displayName: { startsWith: PURGED_PREFIX } } },
    select: {
      id: true,
      sourceId: true,
      displayName: true,
      managerName: true,
      managerSourceId: true,
      managerDirectoryId: true,
    },
  });
  const bySourceId = new Map(rows.map((r) => [r.sourceId, r]));
  const idsByName = new Map<string, string[]>();
  for (const r of rows) {
    const list = idsByName.get(r.displayName) ?? [];
    list.push(r.sourceId);
    idsByName.set(r.displayName, list);
  }
  for (const r of rows) {
    let managerSourceId = r.managerSourceId;
    if (!managerSourceId && r.managerName) {
      const candidates = idsByName.get(r.managerName) ?? [];
      if (candidates.length === 1 && candidates[0] !== r.sourceId) managerSourceId = candidates[0]!;
    }
    const manager = managerSourceId ? bySourceId.get(managerSourceId) : undefined;
    const managerDirectoryId = manager && manager.id !== r.id ? manager.id : null;
    if (managerDirectoryId !== r.managerDirectoryId || managerSourceId !== r.managerSourceId) {
      await prisma.employeeSourceRecord.update({
        where: { id: r.id },
        data: { managerDirectoryId, managerSourceId: managerSourceId ?? null },
      });
    }
  }
}

/** Records the FULL feed no longer lists are archived - never deleted (section 20). */
async function archiveAbsent(
  sourceSystem: string,
  presentIds: Set<string>,
  now: Date,
): Promise<number> {
  const prisma = getPrisma();
  const candidates = await prisma.employeeSourceRecord.findMany({
    where: { sourceSystem, archivedAt: null, NOT: { displayName: { startsWith: PURGED_PREFIX } } },
    select: { id: true, sourceId: true },
  });
  let archived = 0;
  for (const c of candidates) {
    if (presentIds.has(c.sourceId)) continue;
    await prisma.employeeSourceRecord.update({
      where: { id: c.id },
      data: { active: false, archivedAt: now, lastSyncedAt: now },
    });
    archived += 1;
  }
  return archived;
}

/**
 * Directive 6.1 (F): a post-activation manager change is FLAGGED for HR
 * review exactly once - existing case work is never silently reassigned.
 */
async function flagManagerChangesForOpenCases(
  sourceSystem: string,
  employees: BambooEmployee[],
  now: Date,
  correlationId: string,
): Promise<number> {
  const prisma = getPrisma();
  const openCases = await prisma.offboardingCase.findMany({
    where: {
      status: { in: ['ACTIVE', 'ON_HOLD'] },
      employeeSourceSystem: sourceSystem,
      managerChangeFlaggedAt: null,
      managerConfirmedAt: { not: null },
    },
    select: {
      id: true,
      caseNumber: true,
      employeeSourceId: true,
      managerName: true,
      managerSourceId: true,
    },
  });
  const feedById = new Map(employees.map((e) => [e.sourceId, e]));
  let flagged = 0;
  for (const c of openCases) {
    const feed = feedById.get(c.employeeSourceId);
    if (!feed) continue;
    const changed =
      (feed.managerSourceId ?? null) !== (c.managerSourceId ?? null)
        ? Boolean(feed.managerSourceId ?? c.managerSourceId)
        : (feed.managerName ?? null) !== (c.managerName ?? null);
    if (!changed) continue;
    await prisma.offboardingCase.update({
      where: { id: c.id },
      data: { managerChangeFlaggedAt: now },
    });
    await appendAudit(prisma, {
      eventType: 'HIERARCHY_CHANGE_FLAGGED',
      actorType: 'SYSTEM',
      objectType: 'OffboardingCase',
      objectId: c.id,
      caseId: c.id,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        caseNumber: c.caseNumber,
        previousManagerName: c.managerName,
        directoryManagerName: feed.managerName,
      },
    });
    flagged += 1;
  }
  return flagged;
}

/** The fields the directory LISTING carries; a change in any of them re-reads the employee. */
const LISTING_KEYS = [
  'displayName',
  'firstName',
  'lastName',
  'preferredName',
  'workEmail',
  'workPhone',
  'jobTitle',
  'department',
  'division',
  'location',
  'managerName',
  'active',
] as const;
type ListingField = (typeof LISTING_KEYS)[number];

/**
 * Incremental detail fetching (section 13, "hourly incremental
 * reconciliation"): rows that are new to the mirror, or whose listing fields
 * differ from it, are re-read in full; every other row keeps the detail
 * fields the mirror already holds (employee number, hire date, employment
 * status, extension, middle name, last-changed instant) so the upsert does
 * not blank them. A row that has never had its details read (no employee
 * number, no hire date) is read too.
 */
async function withIncrementalDetails(
  sourceSystem: string,
  adapter: BambooAdapter,
  listing: BambooEmployee[],
): Promise<BambooEmployee[]> {
  const prisma = getPrisma();
  const existing = await prisma.employeeSourceRecord.findMany({
    where: { sourceSystem },
    select: {
      sourceId: true,
      displayName: true,
      firstName: true,
      lastName: true,
      preferredName: true,
      workEmail: true,
      workPhone: true,
      jobTitle: true,
      department: true,
      division: true,
      location: true,
      managerName: true,
      managerSourceId: true,
      active: true,
      archivedAt: true,
      employeeNumber: true,
      hireDate: true,
      employmentStatus: true,
      workExtension: true,
      middleName: true,
      sourceUpdatedAt: true,
    },
  });
  const byId = new Map(existing.map((r) => [r.sourceId, r]));
  const parts = (e: BambooEmployee) => nameParts(e);
  const needsRead = (e: BambooEmployee): boolean => {
    const r = byId.get(e.sourceId);
    if (!r || r.archivedAt) return true;
    if (r.employeeNumber === null && r.hireDate === null) return true;
    const p = parts(e);
    const incoming: Record<ListingField, string | boolean | null> = {
      displayName: e.displayName,
      firstName: p.firstName,
      lastName: p.lastName,
      preferredName: e.preferredName ?? null,
      workEmail: e.workEmail,
      workPhone: e.workPhone ?? null,
      jobTitle: e.jobTitle,
      department: e.department,
      division: e.division ?? null,
      location: e.location,
      managerName: e.managerName,
      active: e.active,
    };
    // Compare the LISTING fields only: the mirror also holds detail fields the
    // listing never carries, and those must not count as a change.
    const current = Object.fromEntries(LISTING_KEYS.map((k) => [k, r[k]])) as Record<
      ListingField,
      string | boolean | null
    >;
    return directoryFieldChanges(current, incoming).length > 0;
  };
  const toRead = listing.filter(needsRead).map((e) => e.sourceId);
  const detailed = new Map(
    (toRead.length ? await adapter.getEmployees(toRead) : []).map((d) => [d.sourceId, d]),
  );
  return listing.map((e) => {
    const d = detailed.get(e.sourceId);
    if (d) return d;
    const r = byId.get(e.sourceId);
    if (!r) return e;
    return {
      ...e,
      employeeNumber: e.employeeNumber ?? r.employeeNumber,
      hireDate: e.hireDate ?? (r.hireDate ? r.hireDate.toISOString().slice(0, 10) : null),
      employmentStatus: e.employmentStatus ?? r.employmentStatus,
      workExtension: e.workExtension ?? r.workExtension,
      middleName: e.middleName ?? r.middleName,
      sourceUpdatedAt: e.sourceUpdatedAt ?? r.sourceUpdatedAt?.toISOString() ?? null,
      managerSourceId: e.managerSourceId ?? r.managerSourceId,
    };
  });
}

/**
 * Execute one run. Never throws for a source failure: the run ends FAILED
 * with a safe error code and the mirror is left exactly as it was.
 */
export async function executeDirectorySyncRun(
  runId: string,
  options: { adapter?: BambooAdapter; now?: Date } = {},
): Promise<SyncExecution> {
  const prisma = getPrisma();
  const now = options.now ?? new Date();
  const run = await prisma.directorySyncRun.findUniqueOrThrow({ where: { id: runId } });
  const kind = run.kind as DirectorySyncKind;
  await prisma.directorySyncRun.update({
    where: { id: runId },
    data: { status: 'RUNNING', startedAt: now },
  });
  const counts: SyncCounts = {
    checked: 0,
    added: 0,
    updated: 0,
    unchanged: 0,
    archived: 0,
    failed: 0,
  };
  const diffs: Array<{ sourceId: string; changes: string[] }> = [];
  let adapter: BambooAdapter;
  let sourceSystem = 'BAMBOOHR';
  try {
    adapter = options.adapter ?? (await getBambooAdapter());
    sourceSystem = SOURCE_SYSTEM_FOR_MODE[adapter.mode];
    const targeted = run.employeeSourceId ? [run.employeeSourceId] : null;
    // The nightly pass is exhaustive: every employee's detail record is read.
    // Every other full read is INCREMENTAL - the directory listing (one
    // request) is compared with the mirror and per-employee details are
    // fetched only for new rows and rows whose listing changed. Three full
    // reads of 380 employees within minutes were enough to make BambooHR
    // answer with upstream errors (regression evidence, 2026-09-15).
    const exhaustive = kind === 'NIGHTLY';
    const fetched = targeted
      ? await adapter.getEmployees(targeted)
      : await adapter.listEmployees({ details: exhaustive ? 'all' : 'none' });
    const employees = resolveManagerIds(
      targeted || exhaustive
        ? fetched
        : await withIncrementalDetails(sourceSystem, adapter, fetched),
    );
    counts.checked = employees.length;
    for (const e of employees) {
      try {
        const r = await applyRow(sourceSystem, e, adapter.mode, now);
        counts[r.outcome] += 1;
        if (r.changes.length) diffs.push({ sourceId: e.sourceId, changes: r.changes });
      } catch {
        counts.failed += 1; // one row never stops the run
      }
    }
    if (targeted && employees.length === 0) {
      // The source no longer returns this employee: archive, keep the record.
      const existing = await prisma.employeeSourceRecord.findUnique({
        where: { sourceSystem_sourceId: { sourceSystem, sourceId: targeted[0]! } },
      });
      if (existing && !existing.archivedAt) {
        await prisma.employeeSourceRecord.update({
          where: { id: existing.id },
          data: { active: false, archivedAt: now, lastSyncedAt: now },
        });
        counts.archived += 1;
      }
    }
    await linkManagers(sourceSystem);
    if (!targeted && FULL_SYNC_KINDS.includes(kind) && kind !== 'STARTUP') {
      counts.archived += await archiveAbsent(
        sourceSystem,
        new Set(employees.map((e) => e.sourceId)),
        now,
      );
    }
    await flagManagerChangesForOpenCases(sourceSystem, employees, now, run.correlationId);
    const status = syncResultFromCounts(counts);
    await prisma.directorySyncRun.update({
      where: { id: runId },
      data: {
        status,
        sourceSystem,
        finishedAt: new Date(),
        ...counts,
        changedFields: run.changedFields,
      },
    });
    // Legacy history row: the reconciliation report and technical counts read it.
    await prisma.employeeSyncRun.create({
      data: {
        source: sourceSystem === 'SYNTHETIC' ? 'SYNTHETIC' : 'BAMBOOHR',
        mode: `${adapter.mode.toUpperCase()}_${kind}`,
        startedAt: now,
        finishedAt: new Date(),
        createdCount: counts.added,
        updatedCount: counts.updated,
        mismatches: {
          retrieved: counts.checked,
          unchanged: counts.unchanged,
          failed: counts.failed,
          archived: counts.archived,
          diffs,
        } as never,
        startedById: run.requestedById,
        correlationId: run.correlationId,
      },
    });
    await appendAudit(prisma, {
      eventType: 'DIRECTORY_SYNC_COMPLETED',
      actorType: run.requestedById ? 'USER' : 'SYSTEM',
      actorId: run.requestedById ?? undefined,
      effectiveRoles: [],
      objectType: 'DirectorySyncRun',
      objectId: runId,
      result: status === 'PARTIAL' ? 'FAILURE' : 'SUCCESS',
      correlationId: run.correlationId,
      metadata: { kind, mode: adapter.mode, ...counts },
    });
    return {
      runId,
      kind,
      status,
      mode: adapter.mode,
      sourceSystem,
      errorCode: null,
      diffs,
      ...counts,
    };
  } catch (e) {
    const errorCode = safeErrorCode(e);
    const errorDetail = safeErrorDetail(e);
    await prisma.directorySyncRun.update({
      where: { id: runId },
      data: {
        status: 'FAILED',
        sourceSystem,
        finishedAt: new Date(),
        errorCode,
        errorDetail,
        ...counts,
      },
    });
    await appendAudit(prisma, {
      eventType: 'DIRECTORY_SYNC_FAILED',
      actorType: run.requestedById ? 'USER' : 'SYSTEM',
      actorId: run.requestedById ?? undefined,
      effectiveRoles: [],
      objectType: 'DirectorySyncRun',
      objectId: runId,
      result: 'FAILURE',
      correlationId: run.correlationId,
      metadata: { kind, errorCode, ...counts },
    });
    return {
      runId,
      kind,
      status: 'FAILED',
      mode: options.adapter?.mode ?? 'live',
      sourceSystem,
      errorCode,
      diffs,
      ...counts,
    };
  }
}

/**
 * Run whatever is queued, one run at a time, under the lease. Returns the
 * runs executed, or says the lease was held elsewhere.
 */
export async function runQueuedDirectorySyncs(
  options: { holder?: string; now?: Date; adapter?: BambooAdapter } = {},
): Promise<{ executed: SyncExecution[]; skipped: 'locked' | null }> {
  const prisma = getPrisma();
  const holder = options.holder ?? `${process.pid}:${newCorrelationId()}`;
  const now = options.now ?? new Date();
  if (!(await acquireLease(holder, now))) return { executed: [], skipped: 'locked' };
  const executed: SyncExecution[] = [];
  try {
    for (let i = 0; i < 50; i++) {
      const next = await prisma.directorySyncRun.findFirst({
        where: { status: 'QUEUED' },
        orderBy: { requestedAt: 'asc' },
      });
      if (!next) break;
      executed.push(
        await executeDirectorySyncRun(next.id, { adapter: options.adapter, now: new Date() }),
      );
    }
  } finally {
    await releaseLease(holder);
  }
  return { executed, skipped: null };
}

/**
 * Queue and execute a run, waiting briefly for the lease when another
 * process holds it. Used by the administrator's synchronous path and tests.
 */
export async function runDirectorySyncNow(
  input: SyncRequest & { waitMs?: number; adapter?: BambooAdapter },
): Promise<SyncExecution> {
  const { runIds } = await requestDirectorySync(input);
  const runId = runIds[0]!;
  const deadline = Date.now() + (input.waitMs ?? 30_000);
  for (;;) {
    const r = await runQueuedDirectorySyncs({ adapter: input.adapter });
    const mine = r.executed.find((x) => x.runId === runId);
    if (mine) return mine;
    const state = await getPrisma().directorySyncRun.findUniqueOrThrow({ where: { id: runId } });
    if (state.status !== 'QUEUED' && state.status !== 'RUNNING') {
      return {
        runId,
        kind: state.kind as DirectorySyncKind,
        status: state.status as DirectorySyncStatus,
        mode: 'live',
        sourceSystem: state.sourceSystem ?? 'BAMBOOHR',
        errorCode: state.errorCode,
        diffs: [],
        checked: state.checked,
        added: state.added,
        updated: state.updated,
        unchanged: state.unchanged,
        archived: state.archived,
        failed: state.failed,
      };
    }
    if (Date.now() > deadline)
      throw ServiceError.conflict(
        'A directory synchronization is already running; try again shortly.',
      );
    await new Promise((res) => setTimeout(res, 500));
  }
}

// --- scheduling -----------------------------------------------------------------------

async function lastSuccessfulAt(kinds?: DirectorySyncKind[]): Promise<Date | null> {
  const prisma = getPrisma();
  const run = await prisma.directorySyncRun.findFirst({
    where: { status: { in: ['SUCCESS', 'PARTIAL'] }, ...(kinds ? { kind: { in: kinds } } : {}) },
    orderBy: { finishedAt: 'desc' },
    select: { finishedAt: true },
  });
  return run?.finishedAt ?? null;
}

/**
 * The worker calls this every minute. It queues the hourly and nightly
 * reconciliations when they are due (section 38) and executes whatever is
 * queued - including webhook and manual runs another process could not run.
 * Scheduled reconciliation stays behind the `bamboohr.scheduledSync` switch;
 * queued manual and webhook runs are executed regardless.
 */
export async function directorySyncTick(
  now = new Date(),
  options: { adapter?: BambooAdapter } = {},
): Promise<{ queued: DirectorySyncKind[]; executed: SyncExecution[]; skipped: 'locked' | null }> {
  const queued: DirectorySyncKind[] = [];
  const enabled = (await getSystemConfigValue('bamboohr.scheduledSync')) === true;
  if (enabled) {
    const s = await directorySyncSettings();
    if (nightlyDue(await lastSuccessfulAt(['NIGHTLY']), now, s)) {
      const r = await requestDirectorySync({ kind: 'NIGHTLY' });
      if (!r.reused) queued.push('NIGHTLY');
    } else if (
      hourlyDue(await lastSuccessfulAt(['HOURLY', 'NIGHTLY', 'MANUAL', 'STARTUP']), now, s)
    ) {
      const r = await requestDirectorySync({ kind: 'HOURLY' });
      if (!r.reused) queued.push('HOURLY');
    }
  }
  const r = await runQueuedDirectorySyncs({ now, adapter: options.adapter });
  return { queued, executed: r.executed, skipped: r.skipped };
}

/** On start-up, reconcile at once when the mirror is materially stale (section 16). */
export async function directoryStartupCheck(
  now = new Date(),
): Promise<{ needed: boolean; executed: SyncExecution[]; skipped: 'locked' | null }> {
  const enabled = (await getSystemConfigValue('bamboohr.scheduledSync')) === true;
  if (!enabled) return { needed: false, executed: [], skipped: null };
  const s = await directorySyncSettings();
  const needed = startupSyncNeeded(await lastSuccessfulAt(), now, s);
  if (!needed) return { needed: false, executed: [], skipped: null };
  await requestDirectorySync({ kind: 'STARTUP' });
  const r = await runQueuedDirectorySyncs({ now });
  return { needed: true, executed: r.executed, skipped: r.skipped };
}

// --- status and history -----------------------------------------------------------------

export interface DirectorySyncStatusView {
  mode: 'fixture' | 'live';
  sourceSystem: string;
  scheduledSyncEnabled: boolean;
  webhookConfigured: boolean;
  simulatedOutage: boolean;
  employees: number;
  totalRecords: number;
  archived: number;
  lastEventAt: Date | null;
  lastIncrementalAt: Date | null;
  lastFullAt: Date | null;
  lastSuccessfulAt: Date | null;
  lastRun: {
    id: string;
    kind: string;
    status: string;
    requestedAt: Date;
    finishedAt: Date | null;
    checked: number;
    added: number;
    updated: number;
    archived: number;
    failed: number;
    errorCode: string | null;
    errorDetail: string | null;
  } | null;
  activeRun: { id: string; kind: string; status: string; requestedAt: Date } | null;
  connection: 'HEALTHY' | 'FAILING' | 'UNKNOWN';
  freshness: DirectoryFreshness;
  settings: DirectorySyncSettings;
}

/** Everything the administration screens and the freshness banner show. */
export async function directorySyncStatus(now = new Date()): Promise<DirectorySyncStatusView> {
  const prisma = getPrisma();
  const mode = (await getSystemConfigValue('bamboohr.mode')) === 'live' ? 'live' : 'fixture';
  const sourceSystem = SOURCE_SYSTEM_FOR_MODE[mode];
  const [scheduled, outage, settings, employees, totalRecords, archived, lastRun, activeRun] =
    await Promise.all([
      getSystemConfigValue('bamboohr.scheduledSync'),
      getSystemConfigValue('bamboohr.simulateOutage'),
      directorySyncSettings(),
      prisma.employeeSourceRecord.count({
        where: { sourceSystem, active: true, NOT: { displayName: { startsWith: PURGED_PREFIX } } },
      }),
      prisma.employeeSourceRecord.count({
        where: { sourceSystem, NOT: { displayName: { startsWith: PURGED_PREFIX } } },
      }),
      prisma.employeeSourceRecord.count({ where: { sourceSystem, archivedAt: { not: null } } }),
      prisma.directorySyncRun.findFirst({
        where: { status: { in: ['SUCCESS', 'PARTIAL', 'FAILED'] } },
        orderBy: { requestedAt: 'desc' },
      }),
      prisma.directorySyncRun.findFirst({
        where: { status: { in: ['QUEUED', 'RUNNING'] } },
        orderBy: { requestedAt: 'asc' },
      }),
    ]);
  const [lastEventAt, lastIncrementalAt, lastFullAt, lastAny] = await Promise.all([
    lastSuccessfulAt(['WEBHOOK']),
    lastSuccessfulAt(['HOURLY', 'WEBHOOK', 'STARTUP']),
    lastSuccessfulAt(['NIGHTLY', 'MANUAL']),
    lastSuccessfulAt(),
  ]);
  return {
    mode,
    sourceSystem,
    scheduledSyncEnabled: scheduled === true,
    webhookConfigured: Boolean(getConfig().BAMBOOHR_WEBHOOK_PRIVATE_KEY?.trim()),
    simulatedOutage: outage === true && !getConfig().isProduction,
    employees,
    totalRecords,
    archived,
    lastEventAt,
    lastIncrementalAt,
    lastFullAt,
    lastSuccessfulAt: lastAny,
    lastRun: lastRun
      ? {
          id: lastRun.id,
          kind: lastRun.kind,
          status: lastRun.status,
          requestedAt: lastRun.requestedAt,
          finishedAt: lastRun.finishedAt,
          checked: lastRun.checked,
          added: lastRun.added,
          updated: lastRun.updated,
          archived: lastRun.archived,
          failed: lastRun.failed,
          errorCode: lastRun.errorCode,
          errorDetail: lastRun.errorDetail,
        }
      : null,
    activeRun: activeRun
      ? {
          id: activeRun.id,
          kind: activeRun.kind,
          status: activeRun.status,
          requestedAt: activeRun.requestedAt,
        }
      : null,
    connection: !lastRun ? 'UNKNOWN' : lastRun.status === 'FAILED' ? 'FAILING' : 'HEALTHY',
    freshness: directoryFreshness(lastAny, now, settings),
    settings,
  };
}

export interface SyncRunFilters {
  from?: Date;
  to?: Date;
  kind?: string;
  status?: string;
  employee?: string;
  errorsOnly?: boolean;
  limit?: number;
}

/** Synchronization history for administrators (section 27). */
export async function listDirectorySyncRuns(actor: Actor, f: SyncRunFilters = {}) {
  if (!can(actor, 'directory.viewSync')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const employeeIds: string[] | null = f.employee?.trim()
    ? (
        await prisma.employeeSourceRecord.findMany({
          where: {
            OR: [
              { displayName: { contains: f.employee.trim(), mode: 'insensitive' } },
              { sourceId: { equals: f.employee.trim() } },
              { employeeNumber: { equals: f.employee.trim() } },
            ],
          },
          select: { sourceId: true },
          take: 50,
        })
      ).map((r) => r.sourceId)
    : null;
  const runs = await prisma.directorySyncRun.findMany({
    where: {
      ...(f.from || f.to
        ? { requestedAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } }
        : {}),
      ...(f.kind ? { kind: f.kind } : {}),
      ...(f.status ? { status: f.status } : {}),
      ...(f.errorsOnly ? { OR: [{ status: 'FAILED' }, { failed: { gt: 0 } }] } : {}),
      ...(employeeIds ? { employeeSourceId: { in: employeeIds } } : {}),
    },
    orderBy: { requestedAt: 'desc' },
    take: Math.min(Math.max(f.limit ?? 100, 1), 500),
  });
  const targets = [...new Set(runs.map((r) => r.employeeSourceId).filter((x): x is string => !!x))];
  const names = targets.length
    ? await prisma.employeeSourceRecord.findMany({
        where: { sourceId: { in: targets } },
        select: { sourceId: true, displayName: true, id: true },
      })
    : [];
  const nameOf = new Map(names.map((n) => [n.sourceId, { displayName: n.displayName, id: n.id }]));
  return runs.map((r) => ({
    ...r,
    employee: r.employeeSourceId ? (nameOf.get(r.employeeSourceId) ?? null) : null,
  }));
}
