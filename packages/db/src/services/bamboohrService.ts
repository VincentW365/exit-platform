/**
 * BambooHR read-only adapter (Directive 4 section F; Directive 5.1 B-D, G, L).
 *
 * Two adapters share one contract: the synthetic fixture (default; the ONLY
 * adapter automated tests may use) and the live READ-ONLY directory adapter.
 * The live adapter:
 *  - is constructed from the local gitignored credential and refuses
 *    production outright (raw keys are reference-based there);
 *  - performs GET requests only - no write method exists anywhere here;
 *  - maps every response through the domain field policy so disallowed
 *    fields are discarded before anything else sees them;
 *  - never logs, throws or returns the credential; error text is reduced to
 *    safe categories.
 *
 * Synchronization updates SOURCE records only - immutable case snapshots and
 * approved HR decisions are never touched. Missing source employees are
 * reported for reconciliation, never deleted.
 */
import {
  can,
  computeEmployeeDiff,
  directoryAggregates,
  mapBambooDirectoryEmployee,
  SYNTHETIC_EMPLOYEES,
  type Actor,
  type DirectoryAggregates,
  type EmployeeFieldSet,
  type ReconciliationKind,
} from '@exit/domain';
import { bambooDirectoryStatus, getConfig } from '@exit/config';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';
import { getSystemConfigValue } from './systemConfigService.ts';

export interface BambooEmployee extends EmployeeFieldSet {
  sourceId: string;
  active: boolean;
  managerName: string | null;
  /** Directive 6.1 (B): approved organization fields kept end-to-end. */
  managerSourceId?: string | null;
  division?: string | null;
  employeeNumber?: string | null;
}

export interface BambooAdapter {
  readonly mode: 'fixture' | 'live';
  health(): Promise<{ ok: boolean; detail: string }>;
  validateConfig(): string[];
  listEmployees(): Promise<BambooEmployee[]>;
}

/** Synthetic fixture dataset; tests may override rows via the setter. */
let fixtureOverride: BambooEmployee[] | null = null;
export function setBambooFixtureForTests(rows: BambooEmployee[] | null): void {
  fixtureOverride = rows;
}

class FixtureBambooAdapter implements BambooAdapter {
  readonly mode = 'fixture' as const;
  async health() {
    return { ok: true, detail: 'synthetic fixture adapter (no live BambooHR call)' };
  }
  validateConfig(): string[] {
    return [];
  }
  async listEmployees(): Promise<BambooEmployee[]> {
    if (fixtureOverride) return fixtureOverride;
    // Directive 6.1 (B): the fixture emits the full synthetic organization
    // graph so hierarchy routing is exercised without any live data.
    return SYNTHETIC_EMPLOYEES.map((e) => ({
      sourceId: e.sourceId,
      displayName: e.displayName,
      workEmail: e.workEmail,
      jobTitle: e.jobTitle,
      department: e.department,
      location: e.location,
      active: e.active ?? true,
      managerName: e.managerName ?? null,
      managerSourceId: e.managerSourceId ?? null,
      division: e.division ?? null,
      employeeNumber: e.employeeNumber ?? null,
    }));
  }
}

/** Safe, value-free error categories (A.8/L: never the credential or body). */
type SafeErrorCode =
  | 'NOT_CONFIGURED'
  | 'AUTH_FAILED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR'
  | 'NETWORK_ERROR'
  | 'BAD_RESPONSE';

function classifyHttp(status: number): SafeErrorCode {
  if (status === 401) return 'AUTH_FAILED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  return 'UPSTREAM_ERROR';
}

/**
 * Live READ-ONLY directory adapter (Directive 5.1 section B). GET only; the
 * class deliberately exposes no create/update/delete/upload capability.
 */
export class LiveBambooDirectoryAdapter implements BambooAdapter {
  readonly mode = 'live' as const;
  private readonly subdomain: string;
  private readonly authHeader: string;

  constructor() {
    const config = getConfig();
    if (config.isProduction) {
      // Defense in depth: config already refuses raw keys in production.
      throw ServiceError.validation([
        'The raw-key BambooHR adapter is not available in production.',
      ]);
    }
    if (bambooDirectoryStatus(config) !== 'configured') {
      throw ServiceError.validation([
        'BambooHR directory credential is not configured (see .env.example).',
      ]);
    }
    this.subdomain = config.BAMBOOHR_SUBDOMAIN!.trim();
    // Basic auth per BambooHR API: key as username, any password.
    this.authHeader = `Basic ${Buffer.from(`${config.BAMBOOHR_API_KEY!.trim()}:x`).toString('base64')}`;
  }

  validateConfig(): string[] {
    const status = bambooDirectoryStatus();
    return status === 'configured' ? [] : [`BambooHR directory: ${status}.`];
  }

  /** GET only. The credential never appears in errors, logs or results. */
  private async get(path: string): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(
        `https://api.bamboohr.com/api/gateway.php/${encodeURIComponent(this.subdomain)}/v1${path}`,
        { method: 'GET', headers: { Accept: 'application/json', Authorization: this.authHeader } },
      );
    } catch {
      throw ServiceError.validation(['BambooHR request failed: NETWORK_ERROR.']);
    }
    if (!res.ok) {
      throw ServiceError.validation([`BambooHR request failed: ${classifyHttp(res.status)}.`]);
    }
    try {
      return await res.json();
    } catch {
      throw ServiceError.validation(['BambooHR request failed: BAD_RESPONSE.']);
    }
  }

  async health() {
    try {
      // Smallest useful read: field metadata - no employee data at all.
      await this.get('/meta/fields');
      return { ok: true, detail: 'live read-only directory adapter reachable' };
    } catch (e) {
      const detail = e instanceof ServiceError ? e.details.join(' ') : 'BambooHR request failed.';
      return { ok: false, detail };
    }
  }

  async listEmployees(): Promise<BambooEmployee[]> {
    const body = await this.get('/employees/directory');
    const rawRows = (body as { employees?: unknown[] })?.employees;
    if (!Array.isArray(rawRows)) {
      throw ServiceError.validation(['BambooHR request failed: BAD_RESPONSE.']);
    }
    const rows: BambooEmployee[] = [];
    for (const raw of rawRows) {
      if (typeof raw !== 'object' || raw === null) continue;
      // The domain mapper is the ONLY path from API rows into the app: every
      // field outside the approved minimum is discarded here (C).
      const mapped = mapBambooDirectoryEmployee(raw as Record<string, unknown>);
      if (!mapped) continue;
      rows.push({
        sourceId: mapped.sourceId,
        displayName: mapped.displayName,
        workEmail: mapped.workEmail,
        jobTitle: mapped.jobTitle,
        department: mapped.department,
        location: mapped.location,
        active: mapped.active,
        managerName: mapped.managerName,
        managerSourceId: mapped.managerSourceId,
        division: mapped.division,
        employeeNumber: mapped.employeeNumber,
      });
    }
    return rows;
  }
}

export async function getBambooAdapter(): Promise<BambooAdapter> {
  const mode = await getSystemConfigValue('bamboohr.mode');
  return mode === 'live' ? new LiveBambooDirectoryAdapter() : new FixtureBambooAdapter();
}

const SOURCE_SYSTEM_FOR_MODE = { fixture: 'SYNTHETIC', live: 'BAMBOOHR' } as const;

/**
 * F.5 / 5.1-D: synchronize selected employee metadata into the SOURCE cache
 * with recorded provenance. Case snapshots and case fields are never written.
 * Records absent from the feed are NEVER deleted - reconciliation reports
 * them instead (D.7/D.8).
 */
export async function syncEmployees(actor: Actor) {
  if (!can(actor, 'sync.run')) throw ServiceError.forbidden();
  const adapter = await getBambooAdapter();
  const startedAt = new Date();
  const employees = await adapter.listEmployees();
  const sourceSystem = SOURCE_SYSTEM_FOR_MODE[adapter.mode];
  const prisma = getPrisma();
  const correlationId = newCorrelationId();
  const now = new Date();
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  const diffs: Array<{ sourceId: string; changes: unknown }> = [];

  for (const e of employees) {
    try {
      const existing = await prisma.employeeSourceRecord.findUnique({
        where: { sourceSystem_sourceId: { sourceSystem, sourceId: e.sourceId } },
      });
      if (!existing) {
        await prisma.employeeSourceRecord.create({
          data: {
            sourceSystem,
            sourceId: e.sourceId,
            displayName: e.displayName,
            workEmail: e.workEmail,
            jobTitle: e.jobTitle,
            department: e.department,
            location: e.location,
            retrievedAt: now,
            // Directive 6.1 (B): typed organization columns.
            managerName: e.managerName,
            managerSourceId: e.managerSourceId ?? null,
            division: e.division ?? null,
            employeeNumber: e.employeeNumber ?? null,
            active: e.active,
            lastSyncedAt: now,
            // Minimum mapped fields only - never a raw API response (D.4).
            payload: {
              active: e.active,
              managerName: e.managerName,
              syncSource: adapter.mode,
              syncedAt: now.toISOString(),
            },
          },
        });
        created += 1;
      } else {
        const diff = computeEmployeeDiff(
          {
            displayName: existing.displayName,
            workEmail: existing.workEmail,
            jobTitle: existing.jobTitle,
            department: existing.department,
            location: existing.location,
          },
          e,
        );
        // Directive 6.1: organization fields participate in change detection
        // (field names only - values stay out of sync evidence).
        const orgChanges: string[] = [];
        if ((existing.managerName ?? null) !== (e.managerName ?? null))
          orgChanges.push('managerName');
        if ((existing.managerSourceId ?? null) !== (e.managerSourceId ?? null))
          orgChanges.push('managerSourceId');
        if ((existing.division ?? null) !== (e.division ?? null)) orgChanges.push('division');
        if ((existing.employeeNumber ?? null) !== (e.employeeNumber ?? null))
          orgChanges.push('employeeNumber');
        if (existing.active !== e.active) orgChanges.push('active');
        if (diff.length > 0 || orgChanges.length > 0) {
          // Differences are recorded before overwrite. For LIVE data the
          // evidence keeps changed FIELD NAMES only - values (names, emails)
          // stay out of operational sync evidence (D.5).
          diffs.push({
            sourceId: e.sourceId,
            changes:
              adapter.mode === 'live'
                ? [...diff.map((d) => d.field), ...orgChanges]
                : [...diff, ...orgChanges.map((field) => ({ field, changed: true }))],
          });
          await prisma.employeeSourceRecord.update({
            where: { id: existing.id },
            data: {
              displayName: e.displayName,
              workEmail: e.workEmail,
              jobTitle: e.jobTitle,
              department: e.department,
              location: e.location,
              retrievedAt: now,
              managerName: e.managerName,
              managerSourceId: e.managerSourceId ?? null,
              division: e.division ?? null,
              employeeNumber: e.employeeNumber ?? null,
              active: e.active,
              lastSyncedAt: now,
              payload: {
                active: e.active,
                managerName: e.managerName,
                syncSource: adapter.mode,
                syncedAt: now.toISOString(),
              },
            },
          });
          updated += 1;
        } else {
          await prisma.employeeSourceRecord.update({
            where: { id: existing.id },
            data: { lastSyncedAt: now },
          });
          unchanged += 1;
        }
      }
    } catch {
      failed += 1; // row-level failure never aborts the run; count only
    }
  }

  // Directive 6.1 (B): resolve name-only manager references to directory ids
  // where the name is unique within the source system. Ambiguity stays null
  // and surfaces as an org-validation finding, never a guess.
  const nameRows = await prisma.employeeSourceRecord.findMany({
    where: { sourceSystem, NOT: { displayName: { startsWith: 'PURGED-' } } },
    select: {
      id: true,
      sourceId: true,
      displayName: true,
      managerName: true,
      managerSourceId: true,
    },
  });
  const idsByName = new Map<string, string[]>();
  for (const r of nameRows) {
    const list = idsByName.get(r.displayName) ?? [];
    list.push(r.sourceId);
    idsByName.set(r.displayName, list);
  }
  for (const r of nameRows) {
    if (r.managerSourceId || !r.managerName) continue;
    const candidates = idsByName.get(r.managerName) ?? [];
    if (candidates.length === 1 && candidates[0] !== r.sourceId) {
      await prisma.employeeSourceRecord.update({
        where: { id: r.id },
        data: { managerSourceId: candidates[0] },
      });
    }
  }

  // Directive 6.1 (F): a post-activation manager change is FLAGGED for HR
  // review exactly once - existing case work is never silently reassigned.
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
  }

  const run = await prisma.employeeSyncRun.create({
    data: {
      source: 'BAMBOOHR',
      mode: adapter.mode.toUpperCase(),
      startedAt,
      finishedAt: new Date(),
      createdCount: created,
      updatedCount: updated,
      mismatches: { retrieved: employees.length, unchanged, failed, diffs } as never,
      startedById: actor.userId,
      correlationId,
    },
  });
  await appendAudit(prisma, {
    eventType: 'SYNC_RUN_COMPLETED',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'EmployeeSyncRun',
    objectId: run.id,
    result: 'SUCCESS',
    correlationId,
    metadata: {
      mode: adapter.mode,
      retrieved: employees.length,
      created,
      updated,
      unchanged,
      failed,
      diffCount: diffs.length,
    },
  });
  return {
    runId: run.id,
    mode: adapter.mode,
    retrieved: employees.length,
    created,
    updated,
    unchanged,
    failed,
    diffs,
  };
}

/** F.11 / 5.1-D.9: reconciliation report between source data, cases, users. */
export async function reconciliationReport(actor: Actor) {
  if (!can(actor, 'sync.run') && !can(actor, 'reports.view')) throw ServiceError.forbidden();
  const adapter = await getBambooAdapter();
  const source = await adapter.listEmployees();
  const sourceSystem = SOURCE_SYSTEM_FOR_MODE[adapter.mode];
  const bySourceId = new Map(source.map((e) => [e.sourceId, e]));
  const prisma = getPrisma();

  const findings: Array<{
    kind: ReconciliationKind;
    sourceId: string;
    detail: string;
  }> = [];

  // Duplicate external identifiers in the source feed.
  const seen = new Set<string>();
  for (const e of source) {
    if (seen.has(e.sourceId))
      findings.push({
        kind: 'DUPLICATE_EXTERNAL_IDENTIFIER',
        sourceId: e.sourceId,
        detail: 'The source feed contains this identifier more than once.',
      });
    seen.add(e.sourceId);
  }

  const cachedRecords = await prisma.employeeSourceRecord.findMany({
    where: { sourceSystem },
  });
  for (const rec of cachedRecords) {
    const src = bySourceId.get(rec.sourceId);
    if (!src) {
      findings.push({
        kind: 'SOURCE_EMPLOYEE_MISSING',
        sourceId: rec.sourceId,
        detail: 'Cached employee no longer exists in the source feed (kept for reconciliation).',
      });
      continue;
    }
    if (!src.active)
      findings.push({
        kind: 'INACTIVE_SOURCE_EMPLOYEE',
        sourceId: rec.sourceId,
        detail: 'The source marks this employee inactive.',
      });
    if (
      (rec.department ?? null) !== (src.department ?? null) ||
      (rec.location ?? null) !== (src.location ?? null)
    )
      findings.push({
        kind: 'CHANGED_DEPARTMENT_OR_LOCATION',
        sourceId: rec.sourceId,
        detail: 'Department or location changed in the source since the last sync.',
      });
    const cachedManager =
      rec.managerName ?? (rec.payload as { managerName?: string } | null)?.managerName ?? null;
    if (cachedManager !== null && cachedManager !== src.managerName)
      findings.push({
        kind: 'CHANGED_MANAGER',
        sourceId: rec.sourceId,
        detail: 'Manager relationship changed in the source.',
      });
  }

  // Open cases whose employee identifier no longer matches any source row.
  const openCases = await prisma.offboardingCase.findMany({
    where: { status: { notIn: ['COMPLETED', 'CANCELLED', 'VOIDED'] } },
    select: { employeeSourceId: true, caseNumber: true },
  });
  for (const c of openCases) {
    if (!bySourceId.has(c.employeeSourceId))
      findings.push({
        kind: 'UNMATCHED_EMPLOYEE_IDENTIFIER',
        sourceId: c.employeeSourceId,
        detail: `Open case ${c.caseNumber} references an identifier absent from the source.`,
      });
  }
  return { adapterMode: adapter.mode, findings };
}

/**
 * L: minimal live connection verification. IN-MEMORY ONLY - nothing is
 * persisted, and the result contains aggregate counts, never a name, email
 * or identifier. Audited as a technical action.
 */
export async function testDirectoryConnection(actor: Actor): Promise<{
  status: 'ok' | 'failed' | 'not-configured';
  detail: string;
  aggregates: DirectoryAggregates | null;
}> {
  if (!can(actor, 'sync.run')) throw ServiceError.forbidden();
  const outcome = await (async () => {
    if (bambooDirectoryStatus() !== 'configured') {
      return {
        status: 'not-configured' as const,
        detail: `BambooHR directory: ${bambooDirectoryStatus()}.`,
        aggregates: null,
      };
    }
    try {
      const adapter = new LiveBambooDirectoryAdapter();
      const rows = await adapter.listEmployees();
      return {
        status: 'ok' as const,
        detail: 'Authentication and directory retrieval succeeded (read-only).',
        aggregates: directoryAggregates(rows),
      };
    } catch (e) {
      return {
        status: 'failed' as const,
        detail: e instanceof ServiceError ? e.details.join(' ') : 'BambooHR request failed.',
        aggregates: null,
      };
    }
  })();
  await appendAudit(getPrisma(), {
    eventType: 'DIRECTORY_CONNECTION_TESTED',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'BambooAdapter',
    objectId: 'live',
    result: outcome.status === 'ok' ? 'SUCCESS' : 'FAILURE',
    correlationId: newCorrelationId(),
    metadata: { status: outcome.status, employees: outcome.aggregates?.employees ?? 0 },
  });
  return outcome;
}

/** Marker used when a live row is purged (runtime role cannot DELETE). */
const PURGED_PREFIX = 'PURGED-';

/**
 * G.5/G.6: purge synchronized LIVE directory data. Offboarding cases and
 * immutable snapshots are never touched. Because the runtime role has no
 * DELETE privilege anywhere (by design), purging anonymizes in place: PII
 * fields are overwritten and the row is marked purged; rows referenced by a
 * case keep only their identifier linkage.
 */
export async function purgeLiveDirectory(actor: Actor) {
  if (!can(actor, 'sync.run')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const correlationId = newCorrelationId();
  const rows = await prisma.employeeSourceRecord.findMany({
    where: { sourceSystem: 'BAMBOOHR', NOT: { displayName: { startsWith: PURGED_PREFIX } } },
    select: { id: true, sourceId: true },
  });
  let anonymized = 0;
  let referencedKept = 0;
  for (const row of rows) {
    const referenced = await prisma.offboardingCase.count({
      where: { employeeSourceId: row.sourceId },
    });
    await prisma.employeeSourceRecord.update({
      where: { id: row.id },
      data: {
        displayName: `${PURGED_PREFIX}${row.sourceId}`,
        workEmail: null,
        jobTitle: null,
        department: null,
        location: null,
        payload: {
          purged: true,
          purgedAt: new Date().toISOString(),
          wasReferenced: referenced > 0,
        },
      },
    });
    anonymized += 1;
    if (referenced > 0) referencedKept += 1;
  }
  await appendAudit(prisma, {
    eventType: 'DIRECTORY_PURGED',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'EmployeeSourceRecord',
    objectId: 'BAMBOOHR',
    result: 'SUCCESS',
    correlationId,
    metadata: { anonymized, referencedKept },
  });
  return { anonymized, referencedKept };
}

/**
 * G.4: the live-data banner is shown whenever unpurged live directory rows
 * exist locally.
 */
export async function liveDirectoryPresence(): Promise<{ present: boolean; records: number }> {
  const records = await getPrisma().employeeSourceRecord.count({
    where: { sourceSystem: 'BAMBOOHR', NOT: { displayName: { startsWith: PURGED_PREFIX } } },
  });
  return { present: records > 0, records };
}

/**
 * D.2: scheduled synchronization is PREPARED but disabled unless the
 * system configuration flag is explicitly set. Called by the worker sweep.
 */
export async function scheduledDirectorySyncIfEnabled(): Promise<'disabled' | 'ran' | 'failed'> {
  const enabled = (await getSystemConfigValue('bamboohr.scheduledSync')) === true;
  if (!enabled) return 'disabled';
  try {
    const prisma = getPrisma();
    const adapter = await getBambooAdapter();
    const employees = await adapter.listEmployees();
    const sourceSystem = SOURCE_SYSTEM_FOR_MODE[adapter.mode];
    const now = new Date();
    for (const e of employees) {
      const orgColumns = {
        managerName: e.managerName,
        managerSourceId: e.managerSourceId ?? null,
        division: e.division ?? null,
        employeeNumber: e.employeeNumber ?? null,
        active: e.active,
        lastSyncedAt: now,
      };
      await prisma.employeeSourceRecord.upsert({
        where: { sourceSystem_sourceId: { sourceSystem, sourceId: e.sourceId } },
        create: {
          sourceSystem,
          sourceId: e.sourceId,
          displayName: e.displayName,
          workEmail: e.workEmail,
          jobTitle: e.jobTitle,
          department: e.department,
          location: e.location,
          retrievedAt: now,
          ...orgColumns,
          payload: {
            active: e.active,
            managerName: e.managerName,
            syncSource: adapter.mode,
            syncedAt: now.toISOString(),
          },
        },
        update: {
          displayName: e.displayName,
          workEmail: e.workEmail,
          jobTitle: e.jobTitle,
          department: e.department,
          location: e.location,
          retrievedAt: now,
          ...orgColumns,
          payload: {
            active: e.active,
            managerName: e.managerName,
            syncSource: adapter.mode,
            syncedAt: now.toISOString(),
          },
        },
      });
    }
    await prisma.employeeSyncRun.create({
      data: {
        source: 'BAMBOOHR',
        mode: `${adapter.mode.toUpperCase()}_SCHEDULED`,
        startedAt: now,
        finishedAt: new Date(),
        createdCount: 0,
        updatedCount: employees.length,
        mismatches: { scheduled: true, retrieved: employees.length } as never,
        correlationId: newCorrelationId(),
      },
    });
    return 'ran';
  } catch {
    return 'failed'; // safe category only; never the error body
  }
}
