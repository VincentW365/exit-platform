/**
 * Centralized email routing (email routing directive).
 *
 * One table says who receives each notification type. Nothing else in the
 * platform names a mailbox: workflows, templates and components name a
 * DESTINATION ("static:IT", "dynamic:EMPLOYEE_MANAGER") and this service
 * turns that into an address at send time. Moving IT to a new mailbox, or
 * copying Security on access removals, is then a configuration change an
 * administrator makes - not a code change.
 *
 * Static destinations resolve from the approved recipient directory.
 * Dynamic destinations resolve from the case itself, because the answer
 * differs for every employee.
 */
import {
  type Actor,
  can,
  destinationLabel,
  isDestinationKey,
  maskDestination,
  routeErrors,
  STATIC_DESTINATION_CLASS,
  NOTIFICATION_TYPES,
  type DestinationKey,
  type DynamicDestination,
  type NotificationType,
  type StaticDestination,
} from '@exit/domain';
import { getConfig } from '@exit/config';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';
import { resolveUsableRecipient } from './recipientService.ts';

/**
 * The routes the platform ships with. They reproduce exactly what the code
 * used to hard-code, so turning routing into configuration changed nothing
 * about who receives what on day one.
 */
export const DEFAULT_ROUTES: Readonly<
  Record<string, { to: DestinationKey; cc?: DestinationKey[]; note?: string }>
> = {
  IT_ACCESS_REMOVAL: {
    to: 'static:IT',
    note: 'Access removal is IT work. Security may be copied where policy requires oversight.',
  },
  FINANCE_OFFBOARDING: { to: 'static:FINANCE' },
  LINE_MANAGER_HANDOVER: {
    to: 'dynamic:EMPLOYEE_MANAGER',
    note: "Addressed to this employee's own manager from the directory, never a shared mailbox.",
  },
  RETURN_ITEMS_CHECKLIST: { to: 'static:HR' },
  RESIGNATION_ACCEPTANCE_LETTER: {
    to: 'dynamic:EMPLOYEE',
    note: 'The letter is addressed to the departing employee; HR colleagues are copied per case.',
  },
  SAGICOR_GROUP_HEALTH_REMOVAL: { to: 'static:GROUP_HEALTH_PROVIDER' },
  NCB_GROUP_LIFE_REMOVAL: { to: 'static:GROUP_LIFE_PROVIDER' },
  SURVEY_INVITATION_REFERENCE: { to: 'dynamic:EMPLOYEE' },
  MANUAL_EXCEPTION_NOTIFICATION: { to: 'dynamic:EMPLOYEE' },
  PAYROLL_OR_BANK_NOTIFICATION: { to: 'static:PAYROLL_BANK' },
  OTHER_EXTERNAL_OFFBOARDING_NOTIFICATION: { to: 'static:OTHER_APPROVED_EXTERNAL' },
};

export interface ResolvedRoute {
  notificationType: string;
  to: DestinationKey;
  cc: DestinationKey[];
  bcc: DestinationKey[];
  note: string | null;
  /** True when this is the shipped default rather than a stored decision. */
  isDefault: boolean;
}

function fromDefault(notificationType: string): ResolvedRoute {
  const d = DEFAULT_ROUTES[notificationType];
  return {
    notificationType,
    to: d?.to ?? 'static:HR',
    cc: d?.cc ? [...d.cc] : [],
    bcc: [],
    note: d?.note ?? null,
    isDefault: true,
  };
}

/** The route for one notification type, stored or shipped default. */
export async function routeFor(notificationType: string): Promise<ResolvedRoute> {
  const row = await getPrisma().notificationRouting.findUnique({
    where: { notificationType: notificationType as NotificationType },
  });
  if (!row) return fromDefault(notificationType);
  return {
    notificationType,
    to: row.toDestination as DestinationKey,
    cc: row.ccDestinations.filter(isDestinationKey),
    bcc: row.bccDestinations.filter(isDestinationKey),
    note: row.note,
    isDefault: false,
  };
}

/** Every notification type with its current route, for the admin screen. */
export async function listRoutes(actor: Actor): Promise<ResolvedRoute[]> {
  if (!can(actor, 'notifications.routing')) throw ServiceError.forbidden();
  const rows = await getPrisma().notificationRouting.findMany();
  const stored = new Map(rows.map((r) => [String(r.notificationType), r]));
  return NOTIFICATION_TYPES.map((notificationType) => {
    const row = stored.get(notificationType);
    if (!row) return fromDefault(notificationType);
    return {
      notificationType,
      to: row.toDestination as DestinationKey,
      cc: row.ccDestinations.filter(isDestinationKey),
      bcc: row.bccDestinations.filter(isDestinationKey),
      note: row.note,
      isDefault: false,
    };
  });
}

/** Change where a notification type is addressed. Audited, never silent. */
export async function setRoute(
  actor: Actor,
  input: { notificationType: string; to: string; cc: string[]; bcc: string[]; note?: string },
): Promise<void> {
  if (!can(actor, 'notifications.routing')) throw ServiceError.forbidden();
  if (!(NOTIFICATION_TYPES as readonly string[]).includes(input.notificationType))
    throw ServiceError.validation(['Unknown notification type.']);
  const cc = input.cc.filter(Boolean);
  const bcc = input.bcc.filter(Boolean);
  const errors = routeErrors({ to: input.to, cc, bcc });
  if (errors.length) throw ServiceError.validation(errors);

  const prisma = getPrisma();
  const before = await routeFor(input.notificationType);
  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    await tx.notificationRouting.upsert({
      where: { notificationType: input.notificationType as NotificationType },
      create: {
        notificationType: input.notificationType as NotificationType,
        toDestination: input.to,
        ccDestinations: cc,
        bccDestinations: bcc,
        note: input.note?.trim() || null,
        updatedById: actor.userId,
      },
      update: {
        toDestination: input.to,
        ccDestinations: cc,
        bccDestinations: bcc,
        note: input.note?.trim() || null,
        updatedById: actor.userId,
        rowVersion: { increment: 1 },
      },
    });
    await appendAudit(tx, {
      eventType: 'NOTIFICATION_ROUTING_CHANGED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'NotificationRouting',
      objectId: input.notificationType,
      result: 'SUCCESS',
      correlationId,
      // Destination KEYS, never addresses: the trail says where the platform
      // was told to send, and the directory says what that means.
      metadata: {
        notificationType: input.notificationType,
        previousTo: before.to,
        newTo: input.to,
        cc,
        bcc,
      },
    });
  });
}

/** One resolved address plus how it was arrived at. */
export interface ResolvedAddress {
  destination: DestinationKey;
  label: string;
  email: string;
  /** Null when the destination is a directory row rather than a person. */
  displayName: string | null;
  recipientConfigId: string | null;
}

export interface RouteResolution {
  to: ResolvedAddress | null;
  cc: ResolvedAddress[];
  bcc: ResolvedAddress[];
  /** Destinations that could not be resolved, in business language. */
  unresolved: string[];
}

/** Case facts a dynamic destination can be resolved from. */
export interface RoutingCaseFacts {
  caseId: string;
  employeeSourceSystem: string;
  employeeWorkEmail: string | null;
  employeeDisplayName: string;
  managerSourceId: string | null;
  assignedOfficerId: string | null;
  ownerId: string;
}

async function resolveDynamic(
  destination: DynamicDestination,
  c: RoutingCaseFacts,
): Promise<{ email: string; displayName: string | null } | null> {
  const prisma = getPrisma();
  switch (destination) {
    case 'EMPLOYEE':
      return c.employeeWorkEmail?.trim()
        ? { email: c.employeeWorkEmail.trim(), displayName: c.employeeDisplayName }
        : null;
    case 'EMPLOYEE_MANAGER': {
      if (!c.managerSourceId) return null;
      const row = await prisma.employeeSourceRecord.findUnique({
        where: {
          sourceSystem_sourceId: {
            sourceSystem: c.employeeSourceSystem,
            sourceId: c.managerSourceId,
          },
        },
        select: { workEmail: true, displayName: true },
      });
      return row?.workEmail?.trim()
        ? { email: row.workEmail.trim(), displayName: row.displayName }
        : null;
    }
    case 'ASSIGNED_HR_OFFICER':
    case 'CASE_OWNER': {
      const userId = destination === 'ASSIGNED_HR_OFFICER' ? c.assignedOfficerId : c.ownerId;
      if (!userId) return null;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { workEmail: true, displayName: true, deactivatedAt: true },
      });
      if (!user || user.deactivatedAt) return null;
      return { email: user.workEmail.trim(), displayName: user.displayName };
    }
  }
}

async function resolveOne(
  key: DestinationKey,
  c: RoutingCaseFacts,
  notificationType: string,
): Promise<ResolvedAddress | { error: string }> {
  const [kind, name] = key.split(':') as [string, string];
  const label = destinationLabel(key);
  if (kind === 'dynamic') {
    const resolved = await resolveDynamic(name as DynamicDestination, c);
    if (!resolved) return { error: `${label} has no email address on record.` };
    return {
      destination: key,
      label,
      email: resolved.email,
      displayName: resolved.displayName,
      recipientConfigId: null,
    };
  }
  const recipientClass = STATIC_DESTINATION_CLASS[name as StaticDestination];
  const resolved = await resolveUsableRecipient(recipientClass, notificationType);
  if ('errors' in resolved) return { error: `${label}: ${resolved.errors.join(' ')}` };
  const row = await getPrisma().recipientConfig.findUnique({
    where: { id: resolved.id },
    select: { displayName: true, contactName: true },
  });
  return {
    destination: key,
    label,
    email: resolved.destination,
    displayName: row?.contactName ?? row?.displayName ?? null,
    recipientConfigId: resolved.id,
  };
}

/**
 * Turn a notification type plus a case into real To/CC/BCC addresses.
 *
 * A destination that cannot be resolved is reported rather than skipped: the
 * caller decides whether that is an exception to raise or a copy to drop, but
 * nothing disappears quietly.
 */
export async function resolveRoute(
  notificationType: string,
  c: RoutingCaseFacts,
): Promise<RouteResolution> {
  const route = await routeFor(notificationType);
  const unresolved: string[] = [];

  const toResult = await resolveOne(route.to, c, notificationType);
  const to = 'error' in toResult ? null : toResult;
  if ('error' in toResult) unresolved.push(toResult.error);

  const cc: ResolvedAddress[] = [];
  const bcc: ResolvedAddress[] = [];
  for (const [list, target] of [
    [route.cc, cc],
    [route.bcc, bcc],
  ] as const) {
    for (const key of list) {
      const result = await resolveOne(key, c, notificationType);
      if ('error' in result) unresolved.push(result.error);
      else if (result.email !== to?.email) target.push(result);
    }
  }
  return { to, cc, bcc, unresolved };
}

/**
 * The directory mailbox a notification type is addressed to, if any.
 *
 * A route whose primary recipient is DYNAMIC has no shared mailbox by
 * definition - it is addressed to a person on this case - so the caller must
 * fall back to the per-case address rather than a department inbox.
 */
export async function resolveStaticTo(
  notificationType: string,
): Promise<
  | { id: string; destination: string; destinationMask: string }
  | { reason: 'DYNAMIC' }
  | { errors: string[] }
> {
  const route = await routeFor(notificationType);
  const [kind, name] = route.to.split(':') as [string, string];
  if (kind !== 'static') return { reason: 'DYNAMIC' };
  return resolveUsableRecipient(
    STATIC_DESTINATION_CLASS[name as StaticDestination],
    notificationType,
  );
}

/** Masks for the email log, computed once from a resolution. */
export function routeMasks(resolution: RouteResolution): {
  toMask: string | null;
  ccMasks: string[];
  bccMasks: string[];
} {
  return {
    toMask: resolution.to ? maskDestination(resolution.to.email) : null,
    ccMasks: resolution.cc.map((r) => maskDestination(r.email)),
    bccMasks: resolution.bcc.map((r) => maskDestination(r.email)),
  };
}

/** The routing environment this deployment is running as. */
export function routingEnvironment(): 'development' | 'test' | 'production' {
  return getConfig().appEnvironment;
}
