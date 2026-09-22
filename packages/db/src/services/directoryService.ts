/**
 * Organization directory reference views (Directive 5.1 section F).
 *
 * HR case-preparation views over the LOCAL employee-source cache (synthetic
 * fixtures, synchronized read-only BambooHR rows, manual entries). Access is
 * restricted to the HR roles behind `employeeSource.search` - the only
 * logins there are (DEC-063); the system administration surface shows
 * technical counts only. This is deliberately NOT an employee
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
  /**
   * People with no manager who ARE the manager of others (matched strictly by
   * source id, never by name): the top of the organization. Reported
   * separately - reporting to no one is a fact for them, not a data gap.
   */
  organizationRoots: Array<{ sourceId: string; displayName: string }>;
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
      managerName: true,
      managerSourceId: true,
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
  const organizationRoots: Array<{ sourceId: string; displayName: string }> = [];

  // Who do OTHER records report to? Ids are authoritative. Names are a
  // fallback for feeds that carry only a supervisor name, and are honoured
  // ONLY when the name belongs to exactly one person - two people sharing a
  // name (e.g. Sr/Jr) are never conflated.
  const referencedAsManager = new Set(
    live.map((r) => r.managerSourceId).filter((id): id is string => !!id),
  );
  const nameCount = new Map<string, number>();
  for (const r of live) nameCount.set(r.displayName, (nameCount.get(r.displayName) ?? 0) + 1);
  const managerNames = new Set(live.map((r) => r.managerName).filter((n): n is string => !!n));

  for (const r of live) {
    bySource.set(r.sourceSystem, (bySource.get(r.sourceSystem) ?? 0) + 1);
    const p = r.payload as { active?: boolean; managerName?: string | null } | null;
    if ((p?.active ?? true) === true) active += 1;
    if (p?.managerName) withManager += 1;
    else if (
      referencedAsManager.has(r.sourceId) ||
      (managerNames.has(r.displayName) && nameCount.get(r.displayName) === 1)
    )
      // No manager, but leads others: the head of the organization - a fact,
      // not a gap (owner clarification 2026-08-17).
      organizationRoots.push({ sourceId: r.sourceId, displayName: r.displayName });
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
    organizationRoots: organizationRoots.slice(0, 5),
    lastSyncs: lastSyncs.map((s) => ({
      mode: s.mode,
      startedAt: s.startedAt,
      finishedAt: s.finishedAt,
      created: s.createdCount,
      updated: s.updatedCount,
    })),
  };
}

/** One person in the reporting tree, with their reports nested beneath. */
export interface OrgTreeNode {
  sourceId: string;
  displayName: string;
  jobTitle: string | null;
  department: string | null;
  location: string | null;
  active: boolean;
  /** Everyone under this person, at any depth (drives the count badge). */
  totalBelow: number;
  reports: OrgTreeNode[];
}

export interface OrgTree {
  /** Top of the organization; usually one person. */
  roots: OrgTreeNode[];
  /**
   * People whose recorded manager is not in the directory feed (they would
   * otherwise disappear from the tree entirely - shown separately so the
   * view is always complete).
   */
  unattached: OrgTreeNode[];
  totalPeople: number;
  maxDepth: number;
}

/**
 * The BambooHR reporting tree, built from the synced directory cache
 * (owner request, 2026-08-18: "show the organization tree").
 *
 * Links come from managerSourceId; the live feed carries only supervisor
 * NAMES, so the sync resolves them to ids when the name is unique
 * (bamboohrService.resolveManagerIds). Anyone whose manager cannot be
 * resolved appears under `unattached` rather than vanishing. Cycles are
 * broken defensively: a node is attached at most once, and a cyclic pair
 * surfaces as unattached instead of hanging the render.
 */
export async function organizationTree(actor: Actor): Promise<OrgTree> {
  if (!can(actor, 'employeeSource.search')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const rows = await prisma.employeeSourceRecord.findMany({
    select: {
      sourceId: true,
      displayName: true,
      jobTitle: true,
      department: true,
      location: true,
      managerSourceId: true,
      managerName: true,
      active: true,
    },
    orderBy: { displayName: 'asc' },
  });
  const live = rows.filter((r) => !r.displayName.startsWith(PURGED_PREFIX));

  const nodes = new Map<string, OrgTreeNode>();
  for (const r of live) {
    nodes.set(r.sourceId, {
      sourceId: r.sourceId,
      displayName: r.displayName,
      jobTitle: r.jobTitle,
      department: r.department,
      location: r.location,
      active: r.active ?? true,
      totalBelow: 0,
      reports: [],
    });
  }

  // Name fallback for feeds without manager ids (unique names only - two
  // people sharing a name are never conflated).
  const idsByName = new Map<string, string[]>();
  for (const r of live) {
    const list = idsByName.get(r.displayName) ?? [];
    list.push(r.sourceId);
    idsByName.set(r.displayName, list);
  }
  const managerIdOf = (r: (typeof live)[number]): string | null => {
    if (r.managerSourceId && nodes.has(r.managerSourceId)) return r.managerSourceId;
    if (r.managerName) {
      const matches = idsByName.get(r.managerName) ?? [];
      if (matches.length === 1 && matches[0] !== r.sourceId) return matches[0]!;
    }
    return null;
  };

  // Cycle guard: walking up from a node must reach a manager-less person.
  const wouldCycle = (childId: string, managerId: string): boolean => {
    let cursor: string | null = managerId;
    const seen = new Set<string>([childId]);
    while (cursor) {
      if (seen.has(cursor)) return true;
      seen.add(cursor);
      const row = live.find((r) => r.sourceId === cursor);
      cursor = row ? managerIdOf(row) : null;
    }
    return false;
  };

  const roots: OrgTreeNode[] = [];
  const unattached: OrgTreeNode[] = [];
  for (const r of live) {
    const node = nodes.get(r.sourceId)!;
    const managerId = managerIdOf(r);
    if (!managerId) {
      // No manager recorded at all: the top of the organization.
      if (!r.managerSourceId && !r.managerName) roots.push(node);
      else unattached.push(node); // manager named but not in the feed
      continue;
    }
    if (wouldCycle(r.sourceId, managerId)) {
      unattached.push(node);
      continue;
    }
    nodes.get(managerId)!.reports.push(node);
  }

  // Depth-first roll-up of counts + depth, iterative to stay safe on any
  // unexpectedly deep chain.
  let maxDepth = 0;
  const rollUp = (node: OrgTreeNode, depth: number): number => {
    maxDepth = Math.max(maxDepth, depth);
    let below = 0;
    for (const child of node.reports) below += 1 + rollUp(child, depth + 1);
    node.totalBelow = below;
    node.reports.sort(
      (a, b) => b.totalBelow - a.totalBelow || a.displayName.localeCompare(b.displayName),
    );
    return below;
  };
  for (const root of roots) rollUp(root, 1);
  for (const node of unattached) rollUp(node, 1);
  roots.sort((a, b) => b.totalBelow - a.totalBelow);
  unattached.sort(
    (a, b) => b.totalBelow - a.totalBelow || a.displayName.localeCompare(b.displayName),
  );

  return { roots, unattached, totalPeople: live.length, maxDepth };
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
