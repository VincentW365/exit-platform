/**
 * Identity-provider boundary and user lifecycle (Directive 4 section E).
 *
 * Application roles resolve EXCLUSIVELY server-side from role_assignment
 * (E.8/E.9) - identity-provider claims never carry authority. Disabling a
 * user invalidates sessions immediately (E.7), flags orphaned work (E.11)
 * and feeds the reassignment workflow (E.12).
 */
import { can, idClaimErrors, type Actor, type IdClaims } from '@exit/domain';
import { getConfig } from '@exit/config';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';

/**
 * OIDC sign-in synchronization. Claims are validated against SERVER
 * configuration; provisioning happens only when JIT is explicitly enabled
 * (E.4). Roles are NEVER taken from claims.
 */
export async function syncUserOnSignIn(claims: IdClaims): Promise<{ userId: string } | null> {
  const config = getConfig();
  if (config.IDENTITY_MODE === 'oidc') {
    const errors = idClaimErrors(
      claims,
      { issuer: config.OIDC_ISSUER ?? '', audience: config.OIDC_CLIENT_ID ?? '' },
      Math.floor(Date.now() / 1000),
    );
    if (errors.length) return null;
  }
  const prisma = getPrisma();
  const subject = `oidc|${claims.sub}`;
  const existing = await prisma.user.findUnique({ where: { identitySubject: subject } });
  if (existing) {
    if (!existing.isActive || existing.provisioningStatus === 'DEACTIVATED') return null;
    await prisma.user.update({
      where: { id: existing.id },
      data: { lastSignInAt: new Date(), displayName: claims.name ?? existing.displayName },
    });
    return { userId: existing.id };
  }
  if (!config.IDENTITY_JIT_PROVISIONING) return null; // E.4: explicit only
  const created = await prisma.user.create({
    data: {
      identitySubject: subject,
      displayName: claims.name ?? claims.email ?? 'Unnamed user',
      workEmail: claims.email!,
      identitySource: 'oidc',
      provisioningStatus: 'PENDING', // no roles until an administrator assigns them
      lastSignInAt: new Date(),
    },
  });
  await appendAudit(prisma, {
    eventType: 'IDENTITY_USER_SYNCED',
    actorType: 'SYSTEM',
    objectType: 'User',
    objectId: created.id,
    result: 'SUCCESS',
    correlationId: newCorrelationId(),
    metadata: { identitySource: 'oidc', provisioning: 'JIT', rolesAssigned: 0 },
  });
  return { userId: created.id };
}

/** E.7: disable + immediate session revocation + orphan flagging. */
export async function disableUser(actor: Actor, targetUserId: string, reason: string) {
  if (!can(actor, 'identity.admin')) throw ServiceError.forbidden();
  if (!reason.trim()) throw ServiceError.validation(['A reason is required.']);
  if (actor.userId === targetUserId)
    throw ServiceError.validation(['Administrators cannot disable their own account.']);
  const prisma = getPrisma();
  const now = new Date();
  const correlationId = newCorrelationId();

  const orphans = await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: targetUserId },
      data: {
        isActive: false,
        provisioningStatus: 'DEACTIVATED',
        deactivatedAt: now,
        sessionsInvalidatedAt: now,
      },
    });
    // E.11: orphaned assignments become visible immediately.
    const openTasks = await tx.workflowTask.findMany({
      where: {
        assigneeId: targetUserId,
        status: { in: ['NOT_READY', 'READY', 'IN_PROGRESS', 'BLOCKED'] },
      },
      select: { id: true, caseId: true, title: true },
    });
    const ownedCases = await tx.offboardingCase.count({
      where: { ownerId: targetUserId, status: { notIn: ['COMPLETED', 'CANCELLED', 'VOIDED'] } },
    });
    await appendAudit(tx, {
      eventType: 'IDENTITY_USER_DISABLED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'User',
      objectId: targetUserId,
      result: 'SUCCESS',
      correlationId,
      metadata: { reason, orphanedTasks: openTasks.length, openOwnedCases: ownedCases },
    });
    return openTasks;
  });

  // E.12: each orphaned task surfaces for reassignment via the exception feed.
  const { openException } = await import('./exceptionService.ts');
  for (const t of orphans) {
    await openException(t.caseId, {
      exceptionType: 'MISSING_APPROVAL',
      severity: 'WARNING',
      title: `Assignee disabled: reassign "${t.title}"`,
      detail: 'The assigned user was deactivated; HR Manager reassignment required (E.12).',
      refType: 'WorkflowTask',
      refId: t.id,
      ownerDepartment: 'HR',
    });
  }
  return { orphanedTasks: orphans.length };
}

/** E.10: periodic user-access review snapshot - append-only evidence. */
export async function generateAccessReview(actor: Actor) {
  if (!can(actor, 'identity.accessReview')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const users = await prisma.user.findMany({
    include: { roleAssignments: { where: { revokedAt: null } } },
    orderBy: { displayName: 'asc' },
  });
  const now = new Date();
  const payload = {
    generatedAt: now.toISOString(),
    users: users.map((u) => ({
      userId: u.id,
      displayName: u.displayName,
      identitySource: u.identitySource,
      active: u.isActive,
      provisioningStatus: u.provisioningStatus,
      lastSignInAt: u.lastSignInAt?.toISOString() ?? null,
      roles: u.roleAssignments.map((r) => ({
        role: r.role,
        grantedAt: r.grantedAt.toISOString(),
        expiresAt: r.expiresAt?.toISOString() ?? null,
        expired: r.expiresAt !== null && r.expiresAt.getTime() < now.getTime(),
      })),
      staleSignIn:
        u.lastSignInAt === null || now.getTime() - u.lastSignInAt.getTime() > 90 * 86_400_000,
    })),
    inactiveWithRoles: users
      .filter((u) => !u.isActive && u.roleAssignments.length > 0)
      .map((u) => u.id),
  };
  const correlationId = newCorrelationId();
  const review = await prisma.accessReview.create({
    data: { generatedById: actor.userId, payload, correlationId },
  });
  await appendAudit(prisma, {
    eventType: 'IDENTITY_ACCESS_REVIEW',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'AccessReview',
    objectId: review.id,
    result: 'SUCCESS',
    correlationId,
    metadata: { userCount: users.length, inactiveWithRoles: payload.inactiveWithRoles.length },
  });
  return review;
}

export async function listAccessReviews(actor: Actor) {
  if (!can(actor, 'identity.accessReview')) throw ServiceError.forbidden();
  return getPrisma().accessReview.findMany({ orderBy: { generatedAt: 'desc' }, take: 20 });
}

/** E.6 sweep: revoke expired role assignments (worker). */
export async function revokeExpiredRoles(now: Date = new Date()): Promise<number> {
  const prisma = getPrisma();
  const expired = await prisma.roleAssignment.findMany({
    where: { revokedAt: null, expiresAt: { lt: now } },
    select: { id: true, userId: true, role: true },
  });
  for (const r of expired) {
    await prisma.roleAssignment.updateMany({
      where: { id: r.id, revokedAt: null },
      data: { revokedAt: now, revokeReason: 'Role review expiry reached (automatic revocation).' },
    });
    await appendAudit(prisma, {
      eventType: 'ROLE_EXPIRED_REVOKED',
      actorType: 'SYSTEM',
      objectType: 'RoleAssignment',
      objectId: r.id,
      result: 'SUCCESS',
      correlationId: newCorrelationId(),
      metadata: { role: r.role },
    });
  }
  return expired.length;
}

/**
 * E.13: break-glass process is DOCUMENTED but disabled unless the deployment
 * explicitly configures it (system_config key 'identity.breakGlassEnabled').
 */
export async function breakGlassStatus(): Promise<{ enabled: boolean; note: string }> {
  const row = await getPrisma().systemConfig.findUnique({
    where: { key: 'identity.breakGlassEnabled' },
  });
  return {
    enabled: row?.value === true,
    note: 'Break-glass administrative access is documented in the Support runbook and disabled unless explicitly configured with dual approval.',
  };
}
