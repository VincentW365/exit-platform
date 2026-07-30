/**
 * BambooHR read-focused adapter (Directive 4 section F).
 *
 * The FixtureBambooAdapter serves synthetic data for development and tests;
 * the live adapter is a configuration-gated boundary that is never called
 * without explicit credentials and authorization (F.13). Synchronization
 * updates SOURCE records only - immutable case snapshots and approved HR
 * decisions are never touched (F.7-F.9).
 */
import {
  can,
  computeEmployeeDiff,
  SYNTHETIC_EMPLOYEES,
  type Actor,
  type EmployeeFieldSet,
  type ReconciliationKind,
} from '@exit/domain';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';
import { getSystemConfigValue } from './systemConfigService.ts';

export interface BambooEmployee extends EmployeeFieldSet {
  sourceId: string;
  active: boolean;
  managerName: string | null;
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
    return SYNTHETIC_EMPLOYEES.map((e) => ({
      sourceId: e.sourceId,
      displayName: e.displayName,
      workEmail: e.workEmail,
      jobTitle: e.jobTitle,
      department: e.department,
      location: e.location,
      active: true,
      managerName: 'Jamie Douglas',
    }));
  }
}

class LiveBambooAdapter implements BambooAdapter {
  readonly mode = 'live' as const;
  validateConfig(): string[] {
    // A dedicated integration identity + API key REFERENCE are required
    // (F.1/F.2); neither exists in this repository.
    return [
      'BambooHR subdomain is not configured (system_config bamboohr.subdomain).',
      'BambooHR integration credential reference is not configured.',
      'Written authorization for live BambooHR access is not recorded.',
    ];
  }
  async health() {
    return { ok: false, detail: 'live adapter not configured (credentials/authorization absent)' };
  }
  async listEmployees(): Promise<BambooEmployee[]> {
    throw ServiceError.validation([
      'Live BambooHR is not configured; use the fixture adapter (F.13).',
    ]);
  }
}

export async function getBambooAdapter(): Promise<BambooAdapter> {
  const mode = await getSystemConfigValue('bamboohr.mode');
  return mode === 'live' ? new LiveBambooAdapter() : new FixtureBambooAdapter();
}

/**
 * F.5: synchronize selected employee metadata into the SOURCE cache with
 * recorded provenance. Case snapshots and case fields are never written.
 */
export async function syncEmployees(actor: Actor) {
  if (!can(actor, 'sync.run')) throw ServiceError.forbidden();
  const adapter = await getBambooAdapter();
  const employees = await adapter.listEmployees();
  const prisma = getPrisma();
  const correlationId = newCorrelationId();
  const now = new Date();
  let created = 0;
  let updated = 0;
  const diffs: Array<{ sourceId: string; changes: unknown }> = [];

  for (const e of employees) {
    const existing = await prisma.employeeSourceRecord.findUnique({
      where: { sourceSystem_sourceId: { sourceSystem: 'SYNTHETIC', sourceId: e.sourceId } },
    });
    if (!existing) {
      await prisma.employeeSourceRecord.create({
        data: {
          sourceSystem: 'SYNTHETIC',
          sourceId: e.sourceId,
          displayName: e.displayName,
          workEmail: e.workEmail,
          jobTitle: e.jobTitle,
          department: e.department,
          location: e.location,
          retrievedAt: now,
          payload: { ...e, syncSource: adapter.mode, syncedAt: now.toISOString() },
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
      if (diff.length > 0) {
        // F.6: differences are recorded (and shown) before overwrite.
        diffs.push({ sourceId: e.sourceId, changes: diff });
        await prisma.employeeSourceRecord.update({
          where: { id: existing.id },
          data: {
            displayName: e.displayName,
            workEmail: e.workEmail,
            jobTitle: e.jobTitle,
            department: e.department,
            location: e.location,
            retrievedAt: now,
            payload: { ...e, syncSource: adapter.mode, syncedAt: now.toISOString() },
          },
        });
        updated += 1;
      }
    }
  }

  const run = await prisma.employeeSyncRun.create({
    data: {
      source: 'BAMBOOHR',
      mode: adapter.mode.toUpperCase(),
      finishedAt: new Date(),
      createdCount: created,
      updatedCount: updated,
      mismatches: diffs as never,
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
    metadata: { mode: adapter.mode, created, updated, diffCount: diffs.length },
  });
  return { runId: run.id, created, updated, diffs };
}

/** F.11: reconciliation report between source data, cases and users. */
export async function reconciliationReport(actor: Actor) {
  if (!can(actor, 'sync.run') && !can(actor, 'reports.view')) throw ServiceError.forbidden();
  const adapter = await getBambooAdapter();
  const source = await adapter.listEmployees();
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
    where: { sourceSystem: 'SYNTHETIC' },
  });
  for (const rec of cachedRecords) {
    const src = bySourceId.get(rec.sourceId);
    if (!src) {
      findings.push({
        kind: 'SOURCE_EMPLOYEE_MISSING',
        sourceId: rec.sourceId,
        detail: 'Cached employee no longer exists in the source feed.',
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
        detail: `Cached ${rec.department}/${rec.location} vs source ${src.department}/${src.location}.`,
      });
    const cachedManager = (rec.payload as { managerName?: string } | null)?.managerName ?? null;
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
