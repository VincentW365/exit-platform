/**
 * Users and role administration (REQ-ADMIN-001/002, REQ-SEC-032).
 * Role changes are audited; self-grant and self-revoke are refused.
 */
import {
  can,
  emailBannerErrors,
  isRole,
  normalizeEmailBanner,
  roleChangeErrors,
  type Actor,
  type Role,
} from '@exit/domain';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, auditDenied, newCorrelationId } from './auditService.ts';

export interface SessionUser {
  readonly userId: string;
  readonly displayName: string;
  readonly workEmail: string;
  readonly roles: readonly Role[];
}

/**
 * Resolve an active user with their active roles (session hydration).
 * Stage 4 (Directive 4 E.7): sessions issued before sessionsInvalidatedAt are
 * rejected, so disabling a user revokes access immediately.
 */
export async function getSessionUser(
  userId: string,
  sessionIssuedAt?: number,
): Promise<SessionUser | null> {
  const u = await getPrisma().user.findUnique({
    where: { id: userId },
    include: { roleAssignments: { where: { revokedAt: null }, select: { role: true } } },
  });
  if (!u || !u.isActive || u.provisioningStatus === 'DEACTIVATED') return null;
  if (
    sessionIssuedAt !== undefined &&
    u.sessionsInvalidatedAt !== null &&
    sessionIssuedAt * 1000 < u.sessionsInvalidatedAt.getTime()
  ) {
    return null; // session predates an invalidation event
  }
  return {
    userId: u.id,
    displayName: u.displayName,
    workEmail: u.workEmail,
    roles: activeRoles(u.roleAssignments),
  };
}

/**
 * DEC-042: the database Role enum retains deprecated values (AUDITOR,
 * PRIVACY_OFFICER) for historical assignments; the active model never honours
 * them, so stale literals are filtered out of every actor/roles projection.
 */
function activeRoles(assignments: ReadonlyArray<{ role: string }>): Role[] {
  return assignments.map((r) => r.role).filter((r): r is Role => isRole(r));
}

// --- my settings (DEC-066 section 8) -----------------------------------------

/** What a signed-in user sees and edits about themselves. */
export async function getMySettings(actor: Actor) {
  const u = await getPrisma().user.findUnique({
    where: { id: actor.userId },
    select: {
      displayName: true,
      workEmail: true,
      emailBanner: true,
      emailBannerUpdatedAt: true,
    },
  });
  if (!u) throw ServiceError.notFound();
  const directory = await getPrisma().employeeSourceRecord.findFirst({
    where: { workEmail: u.workEmail },
    select: { jobTitle: true },
  });
  return {
    displayName: u.displayName,
    workEmail: u.workEmail,
    jobTitle: directory?.jobTitle ?? 'Human Resources',
    emailBanner: u.emailBanner,
    emailBannerUpdatedAt: u.emailBannerUpdatedAt,
    roles: actor.roles,
  };
}

/**
 * A user sets (or clears) their own email banner: the plain-text lines the
 * platform appends beneath their name and title on every outgoing email
 * they are the sender of. Only ever their own - nobody edits another
 * account's signature - and always audited.
 */
export async function setEmailBanner(actor: Actor, rawText: string | null | undefined) {
  const errors = emailBannerErrors(rawText);
  if (errors.length) throw ServiceError.validation(errors);
  const banner = normalizeEmailBanner(rawText) || null;
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: actor.userId },
      data: { emailBanner: banner, emailBannerUpdatedAt: new Date() },
    });
    await appendAudit(tx, {
      eventType: 'USER_EMAIL_BANNER_CHANGED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'User',
      objectId: actor.userId,
      result: 'SUCCESS',
      correlationId: newCorrelationId(),
      // Line count only: a signature block is not an audit payload.
      metadata: { cleared: banner === null, lines: banner ? banner.split('\n').length : 0 },
    });
  });
  return { banner };
}

/** Dev-login directory: active users with their roles (non-production only; caller gates). */
export async function listActiveUsers() {
  const users = await getPrisma().user.findMany({
    where: { isActive: true },
    include: { roleAssignments: { where: { revokedAt: null }, select: { role: true } } },
    orderBy: { displayName: 'asc' },
  });
  return users.map((u) => ({
    userId: u.id,
    displayName: u.displayName,
    workEmail: u.workEmail,
    // Provenance for grouping: dev| seeds vs bamboo| directory-mapped staff.
    identitySubject: u.identitySubject,
    roles: activeRoles(u.roleAssignments),
  }));
}

export async function listUsersForAdmin(actor: Actor) {
  const errors = roleChangeErrors(actor, '__none__');
  if (errors.some((e) => e.includes('Not authorized'))) throw ServiceError.forbidden();
  return listActiveUsers();
}

export async function grantRole(actor: Actor, targetUserId: string, role: string, reason: string) {
  const errors = roleChangeErrors(actor, targetUserId);
  if (errors.length) {
    await auditDenied(actor, 'ACCESS_DENIED', 'RoleAssignment', targetUserId);
    throw ServiceError.forbidden(errors.join(' '));
  }
  if (!isRole(role)) throw ServiceError.validation(['Unknown role.']);
  if (!reason.trim()) throw ServiceError.validation(['A reason is required for a role grant.']);

  const prisma = getPrisma();
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target || !target.isActive) throw ServiceError.validation(['Unknown or inactive user.']);
  const existing = await prisma.roleAssignment.findFirst({
    where: { userId: targetUserId, role, revokedAt: null },
  });
  if (existing) throw ServiceError.conflict('The user already holds this role.');

  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    await tx.roleAssignment.create({
      data: { userId: targetUserId, role, reason, grantedById: actor.userId },
    });
    await appendAudit(tx, {
      eventType: 'AUTH_ROLE_GRANTED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'RoleAssignment',
      objectId: targetUserId,
      result: 'SUCCESS',
      correlationId,
      metadata: { role, reason },
    });
  });
}

export async function revokeRole(actor: Actor, targetUserId: string, role: string, reason: string) {
  const errors = roleChangeErrors(actor, targetUserId);
  if (errors.length) {
    await auditDenied(actor, 'ACCESS_DENIED', 'RoleAssignment', targetUserId);
    throw ServiceError.forbidden(errors.join(' '));
  }
  if (!isRole(role)) throw ServiceError.validation(['Unknown role.']);
  if (!reason.trim()) throw ServiceError.validation(['A reason is required for a role revoke.']);

  const prisma = getPrisma();
  const existing = await prisma.roleAssignment.findFirst({
    where: { userId: targetUserId, role, revokedAt: null },
  });
  if (!existing) throw ServiceError.notFound('No active assignment found.');

  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    await tx.roleAssignment.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), revokedById: actor.userId, revokeReason: reason },
    });
    await appendAudit(tx, {
      eventType: 'AUTH_ROLE_REVOKED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'RoleAssignment',
      objectId: targetUserId,
      result: 'SUCCESS',
      correlationId,
      metadata: { role, reason },
    });
  });
}

/**
 * Directive 6.2 (E): map a real person from the synchronized directory to a
 * local application account with granted roles. The account exists only in
 * this environment's database; identitySubject `bamboo|<sourceId>` records
 * provenance and groups these accounts separately on the sign-in screen.
 * Gate: admin.roles (HR_MANAGER, DEC-063), same authority as role grants.
 */
export async function createUserFromDirectory(
  actor: Actor,
  input: {
    sourceSystem: string;
    sourceId: string;
    roles: readonly string[];
    reason: string;
  },
): Promise<{ userId: string; displayName: string }> {
  const errors = roleChangeErrors(actor, '__new-account__');
  if (errors.length) {
    await auditDenied(actor, 'ACCESS_DENIED', 'User', input.sourceId);
    throw ServiceError.forbidden(errors.join(' '));
  }
  if (!input.reason.trim()) throw ServiceError.validation(['A reason is required.']);
  const roles = [...new Set(input.roles)];
  if (roles.length === 0) throw ServiceError.validation(['Select at least one role.']);
  for (const r of roles) if (!isRole(r)) throw ServiceError.validation([`Unknown role: ${r}`]);

  const prisma = getPrisma();
  const record = await prisma.employeeSourceRecord.findUnique({
    where: {
      sourceSystem_sourceId: { sourceSystem: input.sourceSystem, sourceId: input.sourceId },
    },
  });
  if (!record || record.displayName.startsWith('PURGED-'))
    throw ServiceError.validation(['Directory record not found - run a synchronization first.']);
  if (!record.active)
    throw ServiceError.validation(['That directory record is inactive; map active staff only.']);
  if (!record.workEmail)
    throw ServiceError.validation([
      'The directory record has no work email; manager auto-resolution and sign-in identity need one.',
    ]);

  const identitySubject = `bamboo|${record.sourceId}`;
  const existingSubject = await prisma.user.findUnique({ where: { identitySubject } });
  if (existingSubject)
    throw ServiceError.conflict('An account already exists for this directory person.');
  const emailClash = await prisma.user.findUnique({ where: { workEmail: record.workEmail } });
  if (emailClash)
    throw ServiceError.conflict(
      'Another account already uses this work email - review it under Users and roles.',
    );

  const correlationId = newCorrelationId();
  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        identitySubject,
        displayName: record.displayName,
        workEmail: record.workEmail!,
        // Coverage reporting reads User.department (orgService).
        department: record.department,
        identitySource: 'directory',
        roleAssignments: {
          create: roles.map((role) => ({
            role: role as never,
            reason: input.reason,
            grantedById: actor.userId,
          })),
        },
      },
    });
    await appendAudit(tx, {
      eventType: 'IDENTITY_USER_CREATED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'User',
      objectId: user.id,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        identitySource: 'directory',
        sourceSystem: record.sourceSystem,
        sourceId: record.sourceId,
        department: record.department,
        rolesAssigned: roles.join(','),
        reason: input.reason,
      },
    });
    for (const role of roles) {
      await appendAudit(tx, {
        eventType: 'AUTH_ROLE_GRANTED',
        actorType: 'USER',
        actorId: actor.userId,
        effectiveRoles: actor.roles,
        objectType: 'RoleAssignment',
        objectId: user.id,
        result: 'SUCCESS',
        correlationId,
        metadata: { role, reason: input.reason, provisioning: 'DIRECTORY_MAP' },
      });
    }
    return user;
  });
  return { userId: created.id, displayName: created.displayName };
}

/**
 * Re-enable a previously disabled account (mirror of identityService.
 * disableUser). Sessions stay invalidated up to the re-enable instant.
 */
export async function enableUser(actor: Actor, targetUserId: string, reason: string) {
  const errors = roleChangeErrors(actor, targetUserId);
  if (errors.length) {
    await auditDenied(actor, 'ACCESS_DENIED', 'User', targetUserId);
    throw ServiceError.forbidden(errors.join(' '));
  }
  if (!reason.trim()) throw ServiceError.validation(['A reason is required.']);
  const prisma = getPrisma();
  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) throw ServiceError.notFound();
  if (target.isActive) throw ServiceError.conflict('The account is already active.');

  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: targetUserId },
      data: { isActive: true, provisioningStatus: 'ACTIVE', deactivatedAt: null },
    });
    await appendAudit(tx, {
      eventType: 'IDENTITY_USER_ENABLED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'User',
      objectId: targetUserId,
      result: 'SUCCESS',
      correlationId,
      metadata: { reason },
    });
  });
}

/**
 * Directory-mapped accounts (identitySubject bamboo|...) incl. disabled ones,
 * for the Organization mapping table. Real names render locally only.
 */
export async function listDirectoryAccounts(actor: Actor) {
  if (!can(actor, 'admin.organization')) throw ServiceError.forbidden();
  const users = await getPrisma().user.findMany({
    where: { identitySubject: { startsWith: 'bamboo|' } },
    include: { roleAssignments: { where: { revokedAt: null }, select: { role: true } } },
    orderBy: { displayName: 'asc' },
  });
  return users.map((u) => ({
    userId: u.id,
    displayName: u.displayName,
    workEmail: u.workEmail,
    department: u.department,
    isActive: u.isActive,
    sourceId: u.identitySubject.slice('bamboo|'.length),
    roles: activeRoles(u.roleAssignments),
  }));
}

/**
 * Active directory people eligible for account mapping (has a work email,
 * not yet mapped). HR_MANAGER only (DEC-063) - it feeds the mapping form.
 */
export async function listDirectoryPeopleForMapping(actor: Actor) {
  if (!can(actor, 'admin.roles')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const [people, mapped] = await Promise.all([
    prisma.employeeSourceRecord.findMany({
      where: {
        active: true,
        workEmail: { not: null },
        NOT: { displayName: { startsWith: 'PURGED-' } },
      },
      select: {
        sourceSystem: true,
        sourceId: true,
        displayName: true,
        jobTitle: true,
        department: true,
      },
      orderBy: { displayName: 'asc' },
    }),
    prisma.user.findMany({
      where: { identitySubject: { startsWith: 'bamboo|' } },
      select: { identitySubject: true },
    }),
  ]);
  const taken = new Set(mapped.map((m) => m.identitySubject.slice('bamboo|'.length)));
  return people.filter((p) => !taken.has(p.sourceId));
}

/** Login/logout session audit (REQ-SEC-024, AuditEventCatalogue identity events). */
export async function auditLogin(userId: string, roles: readonly string[], success: boolean) {
  await appendAudit(getPrisma(), {
    eventType: success ? 'AUTH_LOGIN_SUCCESS' : 'AUTH_LOGIN_FAILURE',
    actorType: 'USER',
    actorId: success ? userId : null,
    effectiveRoles: roles,
    objectType: 'Session',
    objectId: userId,
    result: success ? 'SUCCESS' : 'FAILURE',
    correlationId: newCorrelationId(),
    metadata: { mode: 'dev-login' },
  });
}

export async function auditLogout(userId: string, roles: readonly string[]) {
  await appendAudit(getPrisma(), {
    eventType: 'AUTH_LOGOUT',
    actorType: 'USER',
    actorId: userId,
    effectiveRoles: roles,
    objectType: 'Session',
    objectId: userId,
    result: 'SUCCESS',
    correlationId: newCorrelationId(),
  });
}
