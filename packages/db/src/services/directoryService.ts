/**
 * Organization directory reference views (Directive 5.1 section F).
 *
 * HR case-preparation views over the LOCAL employee-source cache (synthetic
 * fixtures, synchronized read-only BambooHR rows, manual entries). Access is
 * restricted to the HR roles behind `employeeSource.search`; SYSTEM_ADMIN
 * sees technical counts on the system administration surface instead and
 * never gains case content. This is deliberately NOT an employee
 * self-service directory (F.4) and emails are not shown here (F.5).
 */
import { can, type Actor } from '@exit/domain';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';

const PURGED_PREFIX = 'PURGED-';

export interface DirectoryOverview {
  totals: { records: number; active: number; inactive: number; purged: number };
  bySource: Array<{ sourceSystem: string; records: number }>;
  byDepartment: Array<{ department: string; records: number }>;
  byLocation: Array<{ location: string; records: number }>;
  positions: number;
  withManager: number;
  gaps: {
    missingDepartment: Array<{ sourceId: string; displayName: string }>;
    missingManager: Array<{ sourceId: string; displayName: string }>;
    missingPosition: Array<{ sourceId: string; displayName: string }>;
  };
  lastSyncs: Array<{
    mode: string;
    startedAt: Date;
    finishedAt: Date | null;
    created: number;
    updated: number;
  }>;
}

export async function directoryOverview(actor: Actor): Promise<DirectoryOverview> {
  if (!can(actor, 'employeeSource.search')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const rows = await prisma.employeeSourceRecord.findMany({
    select: {
      sourceId: true,
      sourceSystem: true,
      displayName: true,
      jobTitle: true,
      department: true,
      location: true,
      payload: true,
    },
    orderBy: { displayName: 'asc' },
  });

  const live = rows.filter((r) => !r.displayName.startsWith(PURGED_PREFIX));
  const purged = rows.length - live.length;
  const bySource = new Map<string, number>();
  const byDepartment = new Map<string, number>();
  const byLocation = new Map<string, number>();
  const positions = new Set<string>();
  let active = 0;
  let withManager = 0;
  const missingDepartment: Array<{ sourceId: string; displayName: string }> = [];
  const missingManager: Array<{ sourceId: string; displayName: string }> = [];
  const missingPosition: Array<{ sourceId: string; displayName: string }> = [];

  for (const r of live) {
    bySource.set(r.sourceSystem, (bySource.get(r.sourceSystem) ?? 0) + 1);
    const p = r.payload as { active?: boolean; managerName?: string | null } | null;
    if ((p?.active ?? true) === true) active += 1;
    if (p?.managerName) withManager += 1;
    else missingManager.push({ sourceId: r.sourceId, displayName: r.displayName });
    if (r.department) byDepartment.set(r.department, (byDepartment.get(r.department) ?? 0) + 1);
    else missingDepartment.push({ sourceId: r.sourceId, displayName: r.displayName });
    if (r.location) byLocation.set(r.location, (byLocation.get(r.location) ?? 0) + 1);
    if (r.jobTitle) positions.add(r.jobTitle);
    else missingPosition.push({ sourceId: r.sourceId, displayName: r.displayName });
  }

  const lastSyncs = await prisma.employeeSyncRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: 5,
    select: {
      mode: true,
      startedAt: true,
      finishedAt: true,
      createdCount: true,
      updatedCount: true,
    },
  });

  const sortDesc = <T extends { records: number }>(arr: T[]) =>
    arr.sort((a, b) => b.records - a.records);

  return {
    totals: { records: live.length, active, inactive: live.length - active, purged },
    bySource: sortDesc(
      [...bySource.entries()].map(([sourceSystem, records]) => ({ sourceSystem, records })),
    ),
    byDepartment: sortDesc(
      [...byDepartment.entries()].map(([department, records]) => ({ department, records })),
    ),
    byLocation: sortDesc(
      [...byLocation.entries()].map(([location, records]) => ({ location, records })),
    ),
    positions: positions.size,
    withManager,
    gaps: {
      missingDepartment: missingDepartment.slice(0, 20),
      missingManager: missingManager.slice(0, 20),
      missingPosition: missingPosition.slice(0, 20),
    },
    lastSyncs: lastSyncs.map((s) => ({
      mode: s.mode,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      created: s.createdCount,
      updated: s.updatedCount,
    })),
  };
}

/** Technical counts for the system administration surface (F.2): no names. */
export async function directoryTechnicalCounts() {
  const prisma = getPrisma();
  const [total, liveRecords, syncRuns, recentRuns] = await Promise.all([
    prisma.employeeSourceRecord.count(),
    prisma.employeeSourceRecord.count({
      where: { sourceSystem: 'BAMBOOHR', NOT: { displayName: { startsWith: PURGED_PREFIX } } },
    }),
    prisma.employeeSyncRun.count(),
    prisma.employeeSyncRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 5,
      select: {
        mode: true,
        startedAt: true,
        finishedAt: true,
        createdCount: true,
        updatedCount: true,
      },
    }),
  ]);
  return { total, liveRecords, syncRuns, recentRuns };
}
