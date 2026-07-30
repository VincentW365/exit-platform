/**
 * Business configuration: feature flags, business calendar, org lists
 * (REQ-ADMIN-003/006/010/013, REQ-SEC-032). Every change is audited.
 */
import { can, type Actor, type BusinessCalendar } from '@exit/domain';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';

// --- feature flags (all default disabled; IC-S1-004) -------------------------

export async function listFlags(actor: Actor) {
  if (!can(actor, 'admin.flags') && !can(actor, 'baseline.viewDashboard'))
    throw ServiceError.forbidden();
  return getPrisma().featureFlag.findMany({ orderBy: { key: 'asc' } });
}

export async function setFlag(actor: Actor, key: string, enabled: boolean, reason: string) {
  if (!can(actor, 'admin.flags')) throw ServiceError.forbidden();
  if (!reason.trim()) throw ServiceError.validation(['A reason is required.']);
  const prisma = getPrisma();
  const flag = await prisma.featureFlag.findUnique({ where: { key } });
  if (!flag) throw ServiceError.notFound('Unknown feature flag.');

  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    await tx.featureFlag.update({ where: { key }, data: { enabled, updatedById: actor.userId } });
    await appendAudit(tx, {
      eventType: 'CONFIG_FLAG_CHANGED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'FeatureFlag',
      objectId: key,
      result: 'SUCCESS',
      correlationId,
      metadata: { oldValue: flag.enabled, newValue: enabled, reason },
    });
  });
}

// --- business calendar (DEC-027 / IC-S1-007) ---------------------------------

export async function getActiveCalendar(): Promise<BusinessCalendar> {
  return (await getActiveCalendarInfo()).calendar;
}

/**
 * Stage 3 (Directive 3 section E): due-date provenance needs the calendar
 * VERSION alongside the calendar itself.
 */
export async function getActiveCalendarInfo(): Promise<{
  calendar: BusinessCalendar;
  version: number;
  name: string;
}> {
  const cal = await getPrisma().holidayCalendar.findFirst({
    where: { isActive: true },
    orderBy: { version: 'desc' },
    include: { holidays: true },
  });
  return {
    calendar: {
      timezone: cal?.timezone ?? 'America/Jamaica',
      holidays: (cal?.holidays ?? []).map((h) => ({ date: h.date, label: h.label })),
    },
    version: cal?.version ?? 0,
    name: cal?.name ?? '(no active calendar)',
  };
}

export async function listCalendars(actor: Actor) {
  if (!can(actor, 'admin.calendar')) throw ServiceError.forbidden();
  return getPrisma().holidayCalendar.findMany({
    include: { holidays: { orderBy: { date: 'asc' } } },
    orderBy: [{ name: 'asc' }, { version: 'desc' }],
  });
}

/**
 * Calendar changes publish a NEW version (configuration versioning,
 * REQ-ADMIN-013) and atomically activate it.
 */
export async function publishCalendarVersion(
  actor: Actor,
  name: string,
  holidays: readonly { date: string; label: string }[],
  reason: string,
) {
  if (!can(actor, 'admin.calendar')) throw ServiceError.forbidden();
  if (!reason.trim()) throw ServiceError.validation(['A reason is required.']);
  for (const h of holidays) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(h.date))
      throw ServiceError.validation([`Invalid holiday date: ${h.date} (expected YYYY-MM-DD).`]);
    if (!h.label.trim() || h.label.length > 120)
      throw ServiceError.validation(['Each holiday needs a label of 1-120 characters.']);
  }
  const dates = holidays.map((h) => h.date);
  if (new Set(dates).size !== dates.length)
    throw ServiceError.validation(['Duplicate holiday dates.']);

  const prisma = getPrisma();
  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    const prior = await tx.holidayCalendar.findFirst({
      where: { name },
      orderBy: { version: 'desc' },
    });
    const version = (prior?.version ?? 0) + 1;
    await tx.holidayCalendar.updateMany({ data: { isActive: false }, where: { isActive: true } });
    const cal = await tx.holidayCalendar.create({
      data: {
        name,
        version,
        isActive: true,
        holidays: { create: holidays.map((h) => ({ date: h.date, label: h.label })) },
      },
    });
    await appendAudit(tx, {
      eventType: 'CONFIG_CALENDAR_CHANGED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'HolidayCalendar',
      objectId: cal.id,
      result: 'SUCCESS',
      correlationId,
      metadata: { name, version, holidayCount: holidays.length, reason },
    });
  });
}

/** Stage 4 (Directive 4 K.1): approve the active calendar version. */
export async function approveCalendar(actor: Actor, calendarId: string) {
  if (!can(actor, 'admin.calendar')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    const cal = await tx.holidayCalendar.update({
      where: { id: calendarId },
      data: { approvedById: actor.userId, approvedAt: new Date(), effectiveFrom: new Date() },
    });
    await appendAudit(tx, {
      eventType: 'CALENDAR_APPROVED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'HolidayCalendar',
      objectId: calendarId,
      result: 'SUCCESS',
      correlationId,
      metadata: { name: cal.name, version: cal.version },
    });
  });
}

/**
 * Stage 4 (K.5): preview future SLA effects of a candidate holiday list
 * WITHOUT applying anything. Open tasks keep their stored provenance (K.2/K.3)
 * - this computes what WOULD change for comparison only.
 */
export async function previewCalendarImpact(
  actor: Actor,
  candidateHolidays: readonly { date: string; label: string }[],
) {
  if (!can(actor, 'admin.calendar')) throw ServiceError.forbidden();
  const { computeTaskDue } = await import('@exit/domain');
  const prisma = getPrisma();
  const candidate = { timezone: 'America/Jamaica', holidays: [...candidateHolidays] };
  const tasks = await prisma.workflowTask.findMany({
    where: {
      status: { in: ['NOT_READY', 'READY', 'IN_PROGRESS', 'BLOCKED'] },
      dueAt: { not: null },
      taskDef: { isNot: null },
    },
    include: {
      taskDef: true,
      instance: { select: { activatedAt: true } },
      case: {
        select: {
          caseNumber: true,
          receivedAt: true,
          effectiveSeparationAt: true,
          confirmedLastDay: true,
        },
      },
    },
    take: 100,
  });
  const changes: Array<{
    caseNumber: string;
    title: string;
    currentDue: Date;
    wouldBe: Date | null;
  }> = [];
  for (const t of tasks) {
    const due = computeTaskDue(
      t.taskDef!,
      {
        receivedAt: t.case.receivedAt,
        activationAt: t.instance.activatedAt,
        effectiveSeparationAt: t.case.effectiveSeparationAt,
        confirmedLastDay: t.case.confirmedLastDay,
      },
      candidate,
    );
    if ((due.dueAt?.getTime() ?? null) !== t.dueAt!.getTime()) {
      changes.push({
        caseNumber: t.case.caseNumber,
        title: t.title,
        currentDue: t.dueAt!,
        wouldBe: due.dueAt,
      });
    }
  }
  return {
    evaluatedTasks: tasks.length,
    changes,
    note: 'Preview only: existing tasks retain their stored calculation provenance; a new calendar version affects future or explicitly recalculated tasks only (K.2-K.4).',
  };
}

// --- org lists (REQ-ADMIN-003) -----------------------------------------------

export async function listConfigItems(kind: 'DEPARTMENT' | 'LOCATION') {
  return getPrisma().configListItem.findMany({
    where: { kind, isActive: true },
    orderBy: { value: 'asc' },
  });
}

export async function addConfigItem(actor: Actor, kind: 'DEPARTMENT' | 'LOCATION', value: string) {
  if (!can(actor, 'admin.configLists')) throw ServiceError.forbidden();
  const v = value.trim();
  if (!v || v.length > 100) throw ServiceError.validation(['Value must be 1-100 characters.']);
  const prisma = getPrisma();
  const existing = await prisma.configListItem.findUnique({
    where: { kind_value: { kind, value: v } },
  });
  if (existing) throw ServiceError.conflict('That value already exists.');

  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    const item = await tx.configListItem.create({
      data: { kind, value: v, createdById: actor.userId },
    });
    await appendAudit(tx, {
      eventType: 'CONFIG_LIST_CHANGED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'ConfigListItem',
      objectId: item.id,
      result: 'SUCCESS',
      correlationId,
      metadata: { kind, value: v, change: 'added' },
    });
  });
}

// --- integration placeholders ------------------------------------------------

export async function listIntegrations() {
  return getPrisma().integrationPlaceholder.findMany({ orderBy: { key: 'asc' } });
}
