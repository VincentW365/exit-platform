/**
 * The employee directory as HR browses it (owner directive, 2026-09-15):
 * search and filters over the LOCAL mirror, and one person's profile with
 * their reporting line and any offboarding history the viewer may see.
 * Nothing here calls BambooHR - that is the point.
 */
import { can, directoryRecordStatus, type Actor } from '@exit/domain';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { directoryMode } from './directoryModeService.ts';
import { directorySyncStatus } from './directorySyncService.ts';

const PURGED_PREFIX = 'PURGED-';

export interface DirectoryListFilters {
  q?: string;
  department?: string;
  location?: string;
  division?: string;
  jobTitle?: string;
  /** Directory record id of a manager. */
  managerId?: string;
  /** Default 'active' (section 21). */
  status?: 'active' | 'inactive' | 'all';
  limit?: number;
}

export interface DirectoryCard {
  id: string;
  sourceSystem: string;
  sourceId: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  preferredName: string | null;
  jobTitle: string | null;
  department: string | null;
  division: string | null;
  location: string | null;
  workEmail: string | null;
  workPhone: string | null;
  workExtension: string | null;
  employeeNumber: string | null;
  managerName: string | null;
  managerDirectoryId: string | null;
  status: ReturnType<typeof directoryRecordStatus>;
  active: boolean;
  lastSyncedAt: Date | null;
  contractEndDate: Date | null;
}

async function activeSourceSystem(): Promise<string> {
  return (await directoryMode()) === 'live' ? 'BAMBOOHR' : 'SYNTHETIC';
}

function toCard(r: {
  id: string;
  sourceSystem: string;
  sourceId: string;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  preferredName: string | null;
  jobTitle: string | null;
  department: string | null;
  division: string | null;
  location: string | null;
  workEmail: string | null;
  workPhone: string | null;
  workExtension: string | null;
  employeeNumber: string | null;
  managerName: string | null;
  managerDirectoryId: string | null;
  active: boolean;
  archivedAt: Date | null;
  employmentStatus: string | null;
  lastSyncedAt: Date | null;
  contractEndDate: Date | null;
}): DirectoryCard {
  return {
    id: r.id,
    sourceSystem: r.sourceSystem,
    sourceId: r.sourceId,
    displayName: r.displayName,
    firstName: r.firstName,
    lastName: r.lastName,
    preferredName: r.preferredName,
    jobTitle: r.jobTitle,
    department: r.department,
    division: r.division,
    location: r.location,
    workEmail: r.workEmail,
    workPhone: r.workPhone,
    workExtension: r.workExtension,
    employeeNumber: r.employeeNumber,
    managerName: r.managerName,
    managerDirectoryId: r.managerDirectoryId,
    status: directoryRecordStatus(r),
    active: r.active,
    lastSyncedAt: r.lastSyncedAt,
    contractEndDate: r.contractEndDate,
  };
}

/** Search and filter the directory. Indexed local columns only (section 33). */
export async function listDirectory(actor: Actor, f: DirectoryListFilters = {}) {
  if (!can(actor, 'employeeSource.search')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const sourceSystem = await activeSourceSystem();
  const q = f.q?.trim() ?? '';
  const status = f.status ?? 'active';
  const where = {
    sourceSystem,
    NOT: { displayName: { startsWith: PURGED_PREFIX } },
    ...(status === 'active' ? { active: true } : status === 'inactive' ? { active: false } : {}),
    ...(f.department ? { department: f.department } : {}),
    ...(f.location ? { location: f.location } : {}),
    ...(f.division ? { division: f.division } : {}),
    ...(f.jobTitle ? { jobTitle: f.jobTitle } : {}),
    ...(f.managerId ? { managerDirectoryId: f.managerId } : {}),
    ...(q
      ? {
          OR: [
            { displayName: { contains: q, mode: 'insensitive' as const } },
            { firstName: { contains: q, mode: 'insensitive' as const } },
            { lastName: { contains: q, mode: 'insensitive' as const } },
            { preferredName: { contains: q, mode: 'insensitive' as const } },
            { employeeNumber: { contains: q, mode: 'insensitive' as const } },
            { sourceId: { equals: q } },
            { jobTitle: { contains: q, mode: 'insensitive' as const } },
            { department: { contains: q, mode: 'insensitive' as const } },
            { workEmail: { contains: q, mode: 'insensitive' as const } },
            { managerName: { contains: q, mode: 'insensitive' as const } },
            { location: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
  const [rows, total, departments, locations, divisions, managers] = await Promise.all([
    prisma.employeeSourceRecord.findMany({
      where,
      orderBy: [{ lastName: 'asc' }, { displayName: 'asc' }],
      take: Math.min(Math.max(f.limit ?? 200, 1), 1000),
    }),
    prisma.employeeSourceRecord.count({ where }),
    prisma.employeeSourceRecord.findMany({
      where: { sourceSystem, active: true, department: { not: null } },
      distinct: ['department'],
      select: { department: true },
      orderBy: { department: 'asc' },
    }),
    prisma.employeeSourceRecord.findMany({
      where: { sourceSystem, active: true, location: { not: null } },
      distinct: ['location'],
      select: { location: true },
      orderBy: { location: 'asc' },
    }),
    prisma.employeeSourceRecord.findMany({
      where: { sourceSystem, active: true, division: { not: null } },
      distinct: ['division'],
      select: { division: true },
      orderBy: { division: 'asc' },
    }),
    prisma.employeeSourceRecord.findMany({
      where: {
        sourceSystem,
        reports: { some: {} },
        NOT: { displayName: { startsWith: PURGED_PREFIX } },
      },
      select: { id: true, displayName: true },
      orderBy: { displayName: 'asc' },
    }),
  ]);
  const sync = await directorySyncStatus();
  return {
    rows: rows.map(toCard),
    total,
    facets: {
      departments: departments.map((d) => d.department!).filter(Boolean),
      locations: locations.map((d) => d.location!).filter(Boolean),
      divisions: divisions.map((d) => d.division!).filter(Boolean),
      managers,
    },
    sync: {
      employees: sync.employees,
      lastSuccessfulAt: sync.lastSuccessfulAt,
      freshness: sync.freshness,
      mode: sync.mode,
    },
  };
}

export interface DirectoryProfile {
  record: DirectoryCard & {
    middleName: string | null;
    employmentStatus: string | null;
    hireDate: Date | null;
    sourceUpdatedAt: Date | null;
    archivedAt: Date | null;
    retrievedAt: Date;
  };
  manager: (DirectoryCard & { reportsCount: number }) | null;
  reports: DirectoryCard[];
  reportsTotal: number;
  cases: {
    live: Array<{
      id: string;
      caseNumber: string;
      status: string;
      departureType: string;
      createdAt: Date;
    }>;
    history: Array<{
      id: string;
      caseNumber: string;
      status: string;
      departureType: string;
      createdAt: Date;
    }>;
  };
  canStartOffboarding: boolean;
  freshness: Awaited<ReturnType<typeof directorySyncStatus>>['freshness'];
  lastSuccessfulAt: Date | null;
}

const LIVE_CASE_STATUSES = [
  'DRAFT',
  'PENDING_HR_REVIEW',
  'APPROVED',
  'ACTIVE',
  'ON_HOLD',
  'CLEARANCE_REVIEW',
  'REOPENED',
] as const;

/** The cases the viewer may discover for an employee: restricted ones only when assigned (DEC-035). */
export async function casesForEmployee(actor: Actor, sourceId: string) {
  const prisma = getPrisma();
  const rows = await prisma.offboardingCase.findMany({
    where: {
      employeeSourceId: sourceId,
      status: { notIn: ['VOIDED', 'CANCELLED'] },
      OR: [
        { classification: 'CONFIDENTIAL' },
        { participants: { some: { userId: actor.userId, removedAt: null } } },
        { ownerId: actor.userId },
      ],
    },
    select: { id: true, caseNumber: true, status: true, departureType: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  return {
    live: rows.filter((r) => (LIVE_CASE_STATUSES as readonly string[]).includes(r.status)),
    history: rows.filter((r) => !(LIVE_CASE_STATUSES as readonly string[]).includes(r.status)),
  };
}

/** One person's directory profile (section 5). */
export async function getDirectoryProfile(
  actor: Actor,
  id: string,
): Promise<DirectoryProfile | null> {
  if (!can(actor, 'employeeSource.search')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const r = await prisma.employeeSourceRecord.findUnique({
    where: { id },
    include: {
      manager: { include: { _count: { select: { reports: true } } } },
      reports: { orderBy: { displayName: 'asc' }, take: 25 },
      _count: { select: { reports: true } },
    },
  });
  if (!r || r.displayName.startsWith(PURGED_PREFIX)) return null;
  const cases = await casesForEmployee(actor, r.sourceId);
  const sync = await directorySyncStatus();
  return {
    record: {
      ...toCard(r),
      middleName: r.middleName,
      employmentStatus: r.employmentStatus,
      hireDate: r.hireDate,
      sourceUpdatedAt: r.sourceUpdatedAt,
      archivedAt: r.archivedAt,
      retrievedAt: r.retrievedAt,
    },
    manager: r.manager ? { ...toCard(r.manager), reportsCount: r.manager._count.reports } : null,
    reports: r.reports.map(toCard),
    reportsTotal: r._count.reports,
    cases,
    canStartOffboarding: can(actor, 'case.create') && r.active,
    freshness: sync.freshness,
    lastSuccessfulAt: sync.lastSuccessfulAt,
  };
}

/** A directory record by its source id (the intake's preselection). */
export async function findDirectoryRecordBySourceId(actor: Actor, sourceId: string) {
  if (!can(actor, 'employeeSource.search')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const sourceSystem = await activeSourceSystem();
  const r =
    (await prisma.employeeSourceRecord.findUnique({
      where: { sourceSystem_sourceId: { sourceSystem, sourceId } },
    })) ?? (await prisma.employeeSourceRecord.findFirst({ where: { sourceId } }));
  if (!r || r.displayName.startsWith(PURGED_PREFIX)) return null;
  return toCard(r);
}
