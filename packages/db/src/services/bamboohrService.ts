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
  BAMBOO_ALLOWED_SOURCE_FIELDS,
  can,
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
  // Employee directory (owner directive, 2026-09-15): the remaining minimum
  // fields, all optional so older callers and fixtures keep working.
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  preferredName?: string | null;
  workPhone?: string | null;
  workExtension?: string | null;
  employmentStatus?: string | null;
  /** yyyy-mm-dd */
  hireDate?: string | null;
  /** ISO instant the source last changed the record, where it says. */
  sourceUpdatedAt?: string | null;
}

export interface BambooAdapter {
  readonly mode: 'fixture' | 'live';
  health(): Promise<{ ok: boolean; detail: string }>;
  validateConfig(): string[];
  /**
   * The whole directory. `details: 'none'` returns the listing alone (one
   * request) so an incremental reconciliation can fetch per-employee details
   * only for the rows that changed; the default reads every detail.
   */
  listEmployees(options?: { details?: 'all' | 'none' }): Promise<BambooEmployee[]>;
  /** The current record of specific employees (webhook follow-up); ids the source no longer returns are omitted. */
  getEmployees(sourceIds: string[]): Promise<BambooEmployee[]>;
}

/** Synthetic fixture dataset; tests may override rows via the setter. */
let fixtureOverride: BambooEmployee[] | null = null;
export function setBambooFixtureForTests(rows: BambooEmployee[] | null): void {
  fixtureOverride = rows;
}

/**
 * What the BambooHR directory LISTING does not carry (those fields come from
 * the per-employee detail read). The fixture strips them for a listing-only
 * read so the incremental reconciliation is exercised as it runs live.
 */
const stripDetails = (e: BambooEmployee): BambooEmployee => ({
  ...e,
  employeeNumber: null,
  hireDate: null,
  employmentStatus: null,
  workExtension: null,
  middleName: null,
  sourceUpdatedAt: null,
});

class FixtureBambooAdapter implements BambooAdapter {
  readonly mode = 'fixture' as const;
  async health() {
    return { ok: true, detail: 'synthetic fixture adapter (no live BambooHR call)' };
  }
  validateConfig(): string[] {
    return [];
  }
  async listEmployees(options: { details?: 'all' | 'none' } = {}): Promise<BambooEmployee[]> {
    const rows = await this.allRows();
    // Like the live listing, a listing-only read carries no detail fields.
    return options.details === 'none' ? rows.map(stripDetails) : rows;
  }

  private async allRows(): Promise<BambooEmployee[]> {
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
  async getEmployees(sourceIds: string[]): Promise<BambooEmployee[]> {
    const wanted = new Set(sourceIds);
    return (await this.listEmployees()).filter((e) => wanted.has(e.sourceId));
  }
}

/** Safe, value-free error categories (A.8/L: never the credential or body). */
type SafeErrorCode =
  | 'NOT_CONFIGURED'
  | 'BAD_REQUEST'
  | 'AUTH_FAILED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR'
  | 'NETWORK_ERROR'
  | 'BAD_RESPONSE';

function classifyHttp(status: number): SafeErrorCode {
  if (status === 400) return 'BAD_REQUEST';
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
/**
 * The per-employee read (directive section 6, data minimization): only the
 * approved fields the directory feed does not carry. Never a whole record.
 */
const DETAIL_FIELDS = [
  'employeeNumber',
  'hireDate',
  'status',
  'supervisorEId',
  'workPhoneExtension',
  'middleName',
  'lastChanged',
] as const;

/** Pause before the single retry of a throttled or server-failed read. */
const RETRY_DELAY_MS = 1500;

/** A stand-alone per-employee read: every approved field, nothing else. */
const EMPLOYEE_FIELDS: readonly string[] = BAMBOO_ALLOWED_SOURCE_FIELDS.filter((f) => f !== 'id');

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
    const url = `https://api.bamboohr.com/api/gateway.php/${encodeURIComponent(this.subdomain)}/v1${path}`;
    const headers = { Accept: 'application/json', Authorization: this.authHeader };
    let res: Response;
    try {
      res = await fetch(url, { method: 'GET', headers });
    } catch {
      throw ServiceError.validation(['BambooHR request failed: NETWORK_ERROR.']);
    }
    // One bounded retry on throttling or a server-side error: BambooHR
    // answers a single read with a 5xx now and then (seen in the directory
    // evidence run, 2026-09-15), and a per-employee webhook follow-up has no
    // other chance until the next reconciliation. Still read-only; the
    // request is identical.
    if (res.status === 429 || res.status >= 500) {
      await res.text().catch(() => '');
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      try {
        res = await fetch(url, { method: 'GET', headers });
      } catch {
        throw ServiceError.validation(['BambooHR request failed: NETWORK_ERROR.']);
      }
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

  async listEmployees(options: { details?: 'all' | 'none' } = {}): Promise<BambooEmployee[]> {
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
        firstName: mapped.firstName,
        middleName: mapped.middleName,
        lastName: mapped.lastName,
        preferredName: mapped.preferredName,
        workPhone: mapped.workPhone,
        workExtension: mapped.workExtension,
        employmentStatus: mapped.employmentStatus,
        hireDate: mapped.hireDate,
        sourceUpdatedAt: mapped.sourceUpdatedAt,
      });
    }
    // One request per employee for the detail fields; the incremental
    // reconciliation asks for the listing alone and fetches details only for
    // the rows that changed, so the hourly pass costs one request, not 380.
    if (options.details !== 'none') await this.attachEmployeeDetails(rows);
    return rows;
  }

  /**
   * The current record of specific employees, fetched one by one with the
   * approved field list only (webhook follow-up, directive section 11). An
   * employee the API no longer returns is simply absent from the result.
   */
  async getEmployees(sourceIds: string[]): Promise<BambooEmployee[]> {
    const rows: BambooEmployee[] = [];
    for (const id of sourceIds) {
      let body: unknown;
      try {
        // The whole approved field set: a per-employee read stands alone, so
        // it must carry the name and listing fields as well as the details.
        // (The first evidence run asked for the details only; the mapper
        // found no name, the row looked "missing", and a live employee was
        // archived by a webhook - 2026-09-15.)
        body = await this.get(
          `/employees/${encodeURIComponent(id)}?fields=${EMPLOYEE_FIELDS.join(',')}`,
        );
      } catch (e) {
        const detail = e instanceof ServiceError ? e.details.join(' ') : '';
        if (/NOT_FOUND/.test(detail)) continue;
        throw e;
      }
      // Only a genuine NOT_FOUND means "the source no longer returns this
      // employee". Anything that cannot be mapped is a bad response and fails
      // the run - it must never look like a departure.
      if (!body || typeof body !== 'object') {
        throw ServiceError.validation(['BambooHR request failed: BAD_RESPONSE.']);
      }
      const mapped = mapBambooDirectoryEmployee({ ...(body as Record<string, unknown>), id });
      if (!mapped) {
        throw ServiceError.validation(['BambooHR request failed: BAD_RESPONSE.']);
      }
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
        firstName: mapped.firstName,
        middleName: mapped.middleName,
        lastName: mapped.lastName,
        preferredName: mapped.preferredName,
        workPhone: mapped.workPhone,
        workExtension: mapped.workExtension,
        employmentStatus: mapped.employmentStatus,
        hireDate: mapped.hireDate,
        sourceUpdatedAt: mapped.sourceUpdatedAt,
      });
    }
    return rows;
  }

  /**
   * The directory feed carries the internal record id but NOT the HR-assigned
   * "Employee #" (owner question, 2026-08-18: the two are different values,
   * and the Employee # is the one HR recognizes). It is only available
   * per-employee, so fetch it with a small concurrency pool and leave the
   * field null when a row cannot be read - a missing number must never fail
   * an entire directory synchronization. Still GET-only, still one approved
   * field: no other employee data is requested here.
   */
  private async attachEmployeeDetails(rows: BambooEmployee[]): Promise<void> {
    const CONCURRENCY = 8;
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < rows.length) {
        const row = rows[next++]!;
        try {
          const body = await this.get(
            `/employees/${encodeURIComponent(row.sourceId)}?fields=${DETAIL_FIELDS.join(',')}`,
          );
          const mapped = mapBambooDirectoryEmployee({
            ...(body as Record<string, unknown>),
            id: row.sourceId,
            displayName: row.displayName,
          });
          if (!mapped) continue;
          row.employeeNumber = mapped.employeeNumber ?? row.employeeNumber ?? null;
          row.hireDate = mapped.hireDate;
          row.employmentStatus = mapped.employmentStatus ?? row.employmentStatus ?? null;
          row.active = mapped.employmentStatus ? mapped.active : row.active;
          row.middleName = mapped.middleName;
          row.workExtension = mapped.workExtension ?? row.workExtension ?? null;
          row.sourceUpdatedAt = mapped.sourceUpdatedAt ?? row.sourceUpdatedAt ?? null;
          if (!row.managerSourceId && mapped.managerSourceId)
            row.managerSourceId = mapped.managerSourceId;
        } catch {
          // A missing detail read never fails a directory synchronization.
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
  }
}

export async function getBambooAdapter(): Promise<BambooAdapter> {
  const mode = await getSystemConfigValue('bamboohr.mode');
  const real: BambooAdapter =
    mode === 'live' ? new LiveBambooDirectoryAdapter() : new FixtureBambooAdapter();
  // Simulated outage (owner directive, 2026-09-15, sections 18/37): an
  // administrator can make the source unreachable to prove the cached
  // directory carries on. Refused in production - it exists for UAT evidence.
  const outage = (await getSystemConfigValue('bamboohr.simulateOutage')) === true;
  if (outage && !getConfig().isProduction) return new OutageBambooAdapter(real.mode);
  return real;
}

/** Every read fails the way a network failure would; nothing is cached or written. */
class OutageBambooAdapter implements BambooAdapter {
  constructor(readonly mode: 'fixture' | 'live') {}
  async health() {
    return { ok: false, detail: 'BambooHR request failed: NETWORK_ERROR (simulated outage).' };
  }
  validateConfig(): string[] {
    return [];
  }
  async listEmployees(): Promise<BambooEmployee[]> {
    throw ServiceError.validation(['BambooHR request failed: NETWORK_ERROR (simulated outage).']);
  }
  async getEmployees(): Promise<BambooEmployee[]> {
    throw ServiceError.validation(['BambooHR request failed: NETWORK_ERROR (simulated outage).']);
  }
}

export const SOURCE_SYSTEM_FOR_MODE = { fixture: 'SYNTHETIC', live: 'BAMBOOHR' } as const;

/**
 * The live directory feed carries only the supervisor's display NAME. Resolve
 * manager ids within the same feed by exact-name match, linking ONLY when the
 * name is unique in the organization: two distinct people sharing an exact
 * name (or a feed row already carrying an id) are never guessed. Distinct
 * names such as "Avery Brown" vs "Avery Brown Jr" match exactly and can
 * never cross-link (owner clarification 2026-08-17).
 */
export function resolveManagerIds(employees: BambooEmployee[]): BambooEmployee[] {
  const idsByName = new Map<string, string[]>();
  for (const e of employees) {
    const list = idsByName.get(e.displayName) ?? [];
    list.push(e.sourceId);
    idsByName.set(e.displayName, list);
  }
  return employees.map((e) => {
    if (e.managerSourceId || !e.managerName) return e;
    const matches = idsByName.get(e.managerName) ?? [];
    return matches.length === 1 ? { ...e, managerSourceId: matches[0]! } : e;
  });
}

/**
 * F.5 / 5.1-D: synchronize selected employee metadata into the SOURCE cache
 * with recorded provenance. Case snapshots and case fields are never written.
 * Records absent from the feed are NEVER deleted - reconciliation reports
 * them instead (D.7/D.8).
 */
export async function syncEmployees(actor: Actor) {
  if (!can(actor, 'sync.run')) throw ServiceError.forbidden();
  // The directory engine (directorySyncService) is the only writer of the
  // mirror; this keeps the historical entry point and its result shape.
  const { runDirectorySyncNow } = await import('./directorySyncService.ts');
  const r = await runDirectorySyncNow({ kind: 'MANUAL', actor });
  if (r.status === 'FAILED') {
    throw ServiceError.validation([
      `BambooHR request failed: ${r.errorCode ?? 'UNEXPECTED'}. Cached directory data stays in use.`,
    ]);
  }
  return {
    runId: r.runId,
    mode: r.mode,
    retrieved: r.checked,
    created: r.added,
    updated: r.updated,
    unchanged: r.unchanged,
    failed: r.failed,
    archived: r.archived,
    diffs: r.diffs,
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
export async function scheduledDirectorySyncIfEnabled(): Promise<
  'disabled' | 'fresh' | 'ran' | 'failed'
> {
  // Kept for callers that predate the directory engine; the worker now calls
  // directorySyncTick directly. Scheduled reconciliation stays behind the
  // bamboohr.scheduledSync switch.
  const enabled = (await getSystemConfigValue('bamboohr.scheduledSync')) === true;
  if (!enabled) return 'disabled';
  const { directorySyncTick } = await import('./directorySyncService.ts');
  const r = await directorySyncTick(new Date());
  if (r.executed.length === 0) return 'fresh';
  return r.executed.some((x) => x.status === 'FAILED') ? 'failed' : 'ran';
}
