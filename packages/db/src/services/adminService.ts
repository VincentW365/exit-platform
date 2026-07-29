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
  const cal = await getPrisma().holidayCalendar.findFirst({
    where: { isActive: true },
    orderBy: { version: 'desc' },
    include: { holidays: true },
  });
  return {
    timezone: cal?.timezone ?? 'America/Jamaica',
    holidays: (cal?.holidays ?? []).map((h) => ({ date: h.date, label: h.label })),
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
