/**
 * Organization graph and validation service (Directive 6.1 sections B/C).
 *
 * Wraps the pure domain org graph over the synchronized directory records and
 * the application's responder coverage (role assignments). Aggregate-first:
 * HR-facing surfaces receive reference ids and counts; no unnecessary
 * employee detail leaves this module.
 */
import {
  buildOrgGraph,
  can,
  managerChain,
  validateOrg,
  type Actor,
  type OrgGraph,
  type OrgPerson,
  type OrgValidationReport,
  type ResponderCoverage,
} from '@exit/domain';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';

export interface DirectoryPersonRef {
  readonly sourceId: string;
  readonly displayName: string;
  readonly jobTitle: string | null;
  readonly department: string | null;
  readonly location: string | null;
  readonly active: boolean;
}

const toRef = (p: OrgPerson): DirectoryPersonRef => ({
  sourceId: p.sourceId,
  displayName: p.displayName,
  jobTitle: p.jobTitle,
  department: p.department,
  location: p.location,
  active: p.active,
});

async function loadPeople(sourceSystem?: string): Promise<OrgPerson[]> {
  const prisma = getPrisma();
  const rows = await prisma.employeeSourceRecord.findMany({
    where: {
      NOT: { displayName: { startsWith: 'PURGED-' } },
      ...(sourceSystem ? { sourceSystem } : {}),
    },
    select: {
      sourceId: true,
      displayName: true,
      workEmail: true,
      jobTitle: true,
      department: true,
      division: true,
      location: true,
      employeeNumber: true,
      managerName: true,
      managerSourceId: true,
      active: true,
    },
  });
  return rows;
}

async function loadCoverage(people: readonly OrgPerson[]): Promise<ResponderCoverage> {
  const prisma = getPrisma();
  const assignments = await prisma.roleAssignment.findMany({
    where: { revokedAt: null, user: { isActive: true } },
    select: { role: true, user: { select: { department: true } } },
  });
  const departments = [
    ...new Set(people.map((p) => p.department).filter((d): d is string => Boolean(d && d.trim()))),
  ].sort();
  const coveredDepartments = new Set<string>();
  let itResponders = 0;
  let financeResponders = 0;
  let hrResponders = 0;
  for (const a of assignments) {
    if (a.role === 'IT_RESPONDER') itResponders += 1;
    if (a.role === 'FINANCE_RESPONDER') financeResponders += 1;
    if (a.role === 'HR_MANAGER' || a.role === 'HR_OFFICER') hrResponders += 1;
    if (a.user.department && departments.includes(a.user.department))
      coveredDepartments.add(a.user.department);
  }
  return {
    departments,
    coveredDepartments: [...coveredDepartments],
    itResponders,
    financeResponders,
    hrResponders,
  };
}

async function loadGraph(): Promise<OrgGraph> {
  return buildOrgGraph(await loadPeople());
}

/** C: full validation report for the organization health screen. */
export async function orgValidation(actor: Actor): Promise<OrgValidationReport> {
  if (!can(actor, 'org.view') && !can(actor, 'admin.organization')) throw ServiceError.forbidden();
  const people = await loadPeople();
  const graph = buildOrgGraph(people);
  const coverage = await loadCoverage(people);
  return validateOrg(graph, coverage);
}

export interface OrgOverview {
  report: OrgValidationReport;
  coverage: ResponderCoverage;
  managers: Array<{ manager: DirectoryPersonRef; directReports: number }>;
  hierarchyWarnings: HierarchyWarning[];
}

export interface HierarchyWarning {
  caseId: string;
  caseNumber: string;
  employeeDisplayName: string;
  managerName: string | null;
  directoryManagerName: string | null;
  flaggedAt: Date;
}

/** C/D: the Organization & Assignment Mapping screen payload. */
export async function getOrgOverview(actor: Actor): Promise<OrgOverview> {
  if (!can(actor, 'org.view') && !can(actor, 'admin.organization')) throw ServiceError.forbidden();
  const people = await loadPeople();
  const graph = buildOrgGraph(people);
  const coverage = await loadCoverage(people);
  const report = validateOrg(graph, coverage);
  const managers = [...graph.directReports.entries()]
    .map(([sourceId, reports]) => ({
      manager: toRef(graph.bySourceId.get(sourceId)!),
      directReports: reports.length,
    }))
    .sort((a, b) => b.directReports - a.directReports)
    .slice(0, 25);
  const hierarchyWarnings = await listHierarchyChangeWarnings(actor);
  return { report, coverage, managers, hierarchyWarnings };
}

export async function directReportsOf(
  actor: Actor,
  sourceId: string,
): Promise<DirectoryPersonRef[]> {
  if (!can(actor, 'org.view')) throw ServiceError.forbidden();
  const graph = await loadGraph();
  return (graph.directReports.get(sourceId) ?? []).map(toRef);
}

export async function managerChainOf(
  actor: Actor,
  sourceId: string,
): Promise<{ manager: DirectoryPersonRef | null; secondLevel: DirectoryPersonRef | null }> {
  if (!can(actor, 'org.view')) throw ServiceError.forbidden();
  const graph = await loadGraph();
  const chain = managerChain(graph, sourceId);
  return {
    manager: chain.manager ? toRef(chain.manager) : null,
    secondLevel: chain.secondLevel ? toRef(chain.secondLevel) : null,
  };
}

export interface Officeholder {
  readonly office: string;
  readonly person: DirectoryPersonRef;
  readonly directReports: number;
}

/**
 * Key officeholders derived from the synchronized directory (owner request:
 * "you should know who the HR manager is"). Pure title/department heuristics
 * over whatever is synced - fixture or live - so no name is ever hard-coded.
 */
export async function keyOfficeholders(actor: Actor): Promise<Officeholder[]> {
  if (!can(actor, 'org.view') && !can(actor, 'admin.organization')) throw ServiceError.forbidden();
  const people = await loadPeople();
  const graph = buildOrgGraph(people);
  const reports = (id: string) => (graph.directReports.get(id) ?? []).length;
  const active = people.filter((p) => p.active);
  const titled = (p: OrgPerson, ...words: string[]) => {
    const t = (p.jobTitle ?? '').toLowerCase();
    return words.some((w) => t.includes(w));
  };
  const inDept = (p: OrgPerson, ...names: string[]) => {
    const d = (p.department ?? '').toLowerCase();
    return names.some((n) => d.includes(n));
  };
  const offices: Array<{ office: string; match: (p: OrgPerson) => boolean }> = [
    { office: 'HR Manager', match: (p) => inDept(p, 'human resources') && titled(p, 'manager') },
    { office: 'HR Officer', match: (p) => inDept(p, 'human resources') && titled(p, 'officer') },
    {
      office: 'Finance Manager',
      match: (p) => inDept(p, 'finance') && titled(p, 'manager', 'controller'),
    },
    {
      office: 'IT Lead',
      // Exact department match: substring would catch "Audit".
      match: (p) =>
        (p.department ?? '').toLowerCase() === 'it' && titled(p, 'manager', 'lead', 'senior'),
    },
    { office: 'Operations Manager', match: (p) => titled(p, 'operations manager') },
  ];
  const holders: Officeholder[] = [];
  for (const o of offices) {
    for (const p of active.filter(o.match)) {
      holders.push({ office: o.office, person: toRef(p), directReports: reports(p.sourceId) });
    }
  }
  return holders;
}

/** F: activated cases whose directory manager drifted since confirmation. */
export async function listHierarchyChangeWarnings(actor: Actor): Promise<HierarchyWarning[]> {
  if (!can(actor, 'org.view') && !can(actor, 'admin.organization')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const rows = await prisma.offboardingCase.findMany({
    where: {
      managerChangeFlaggedAt: { not: null },
      status: { in: ['ACTIVE', 'ON_HOLD', 'CLEARANCE_REVIEW'] },
      // Aggregate screen: restricted-case identities never appear here.
      classification: 'CONFIDENTIAL',
    },
    select: {
      id: true,
      caseNumber: true,
      employeeDisplayName: true,
      employeeSourceSystem: true,
      employeeSourceId: true,
      managerName: true,
      managerChangeFlaggedAt: true,
    },
    orderBy: { managerChangeFlaggedAt: 'desc' },
    take: 50,
  });
  const prismaClient = getPrisma();
  const warnings: HierarchyWarning[] = [];
  for (const c of rows) {
    const source = await prismaClient.employeeSourceRecord.findUnique({
      where: {
        sourceSystem_sourceId: {
          sourceSystem: c.employeeSourceSystem,
          sourceId: c.employeeSourceId,
        },
      },
      select: { managerName: true },
    });
    warnings.push({
      caseId: c.id,
      caseNumber: c.caseNumber,
      employeeDisplayName: c.employeeDisplayName,
      managerName: c.managerName,
      directoryManagerName: source?.managerName ?? null,
      flaggedAt: c.managerChangeFlaggedAt!,
    });
  }
  return warnings;
}
