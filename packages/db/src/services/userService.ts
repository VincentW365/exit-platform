/**
 * Users and role administration (REQ-ADMIN-001/002, REQ-SEC-032).
 * Role changes are audited; self-grant and self-revoke are refused.
 */
import { isRole, roleChangeErrors, type Actor, type Role } from '@exit/domain';
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
    roles: u.roleAssignments.map((r) => r.role),
  };
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
    roles: u.roleAssignments.map((r) => r.role),
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
