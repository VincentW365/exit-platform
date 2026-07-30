/**
 * Pilot activation controls and readiness gates (Directive 4 sections L-M).
 *
 * The environment activation state lives in system_config
 * ('activation.state'); every change is backed by an immutable-core
 * PilotActivation record with the required approvals. PILOT_ACTIVE demands
 * every mandatory gate to pass (M) plus HR + SYSTEM_ADMIN approval (and
 * PRIVACY_OFFICER where configured). BASELINE cases are never processed
 * retroactively (L.6): activation gates apply only to actions taken after
 * activation, and BASELINE cohorts remain excluded by automationPermitted.
 */
import {
  activationChecksum,
  activationTransitionError,
  can,
  evaluateGateBlockers,
  READINESS_GATES,
  DEFAULT_ACTIVATION_STATE,
  type ActivationStateName,
  type Actor,
  type GateResult,
} from '@exit/domain';
import { z } from 'zod';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';
import { collectHealth } from './healthService.ts';
import { getSystemConfigValue } from './systemConfigService.ts';
import { getConfig } from '@exit/config';

export async function currentActivationState(): Promise<ActivationStateName> {
  const v = (await getSystemConfigValue('activation.state')) as string | null;
  return (v as ActivationStateName) ?? DEFAULT_ACTIVATION_STATE;
}

/** M: evaluate all 24 gates from live system facts. */
export async function evaluateReadinessGates(): Promise<GateResult[]> {
  const prisma = getPrisma();
  const health = await collectHealth();
  const componentOk = (prefix: string) =>
    health.components.find((c) => c.component.startsWith(prefix));

  const [
    wfActive,
    docActive,
    notifActive,
    recipientsVerified,
    calendarApproved,
    reasonsApproved,
    backup,
    verifiedBackup,
    retentionActive,
    openCritical,
    openSecurity,
    sopFlag,
    uatFlag,
    trainingCount,
    fallbackReady,
    lastSync,
    auditRecent,
  ] = await Promise.all([
    prisma.workflowDefinition.count({ where: { status: 'ACTIVE' } }),
    prisma.documentTemplate.count({ where: { status: 'ACTIVE' } }),
    prisma.notificationTemplate.count({ where: { status: 'ACTIVE' } }),
    prisma.recipientConfig.count({
      where: { approvalStatus: 'APPROVED', verifiedAt: { not: null }, active: true },
    }),
    prisma.holidayCalendar.count({ where: { isActive: true, approvedById: { not: null } } }),
    prisma.reasonCategory.count({ where: { isActive: true, approvedById: { not: null } } }),
    prisma.backupRecord.findFirst({ orderBy: { createdAt: 'desc' } }),
    prisma.backupRecord.findFirst({
      where: { verifiedAt: { not: null } },
      orderBy: { verifiedAt: 'desc' },
    }),
    prisma.retentionPolicy.count({ where: { active: true, approvedById: { not: null } } }),
    prisma.caseException.count({ where: { status: 'OPEN', severity: 'CRITICAL' } }),
    prisma.supportTicket.count({
      where: { category: 'SECURITY_PRIVACY_INCIDENT', status: { in: ['OPEN', 'IN_PROGRESS'] } },
    }),
    getSystemConfigValue('readiness.sopPublished'),
    getSystemConfigValue('readiness.uatPassed'),
    prisma.trainingCompletion.count(),
    getSystemConfigValue('readiness.manualFallbackReady'),
    prisma.employeeSyncRun.findFirst({ orderBy: { startedAt: 'desc' } }),
    prisma.auditEvent.findFirst({ orderBy: { occurredAt: 'desc' }, select: { occurredAt: true } }),
  ]);

  const facts: Record<string, { ok: boolean; detail: string }> = {
    workflowVersions: {
      ok: wfActive >= 3,
      detail: `${wfActive} ACTIVE workflow definition(s); 3 required (one per departure type).`,
    },
    documentTemplates: { ok: docActive >= 3, detail: `${docActive} ACTIVE document template(s).` },
    notificationTemplates: {
      ok: notifActive >= 7,
      detail: `${notifActive} ACTIVE notification template(s); 7 required.`,
    },
    recipients: {
      ok: recipientsVerified > 0,
      detail: `${recipientsVerified} approved+verified recipient configuration(s).`,
    },
    calendar: {
      ok: calendarApproved > 0,
      detail:
        calendarApproved > 0 ? 'Active calendar is approved.' : 'Active calendar lacks approval.',
    },
    reasonTaxonomy: {
      ok: reasonsApproved > 0,
      detail: `${reasonsApproved} approved active reason categor(ies).`,
    },
    identityProvider: {
      ok: componentOk('identity')?.ok ?? false,
      detail: componentOk('identity')?.detail ?? 'unknown',
    },
    emailProvider: {
      ok: componentOk('email')?.ok ?? false,
      detail: componentOk('email')?.detail ?? 'unknown',
    },
    bamboohr: {
      ok: componentOk('bamboohr')?.ok ?? false,
      detail: componentOk('bamboohr')?.detail ?? 'unknown',
    },
    objectStorage: {
      ok: componentOk('storage')?.ok ?? false,
      detail: componentOk('storage')?.detail ?? 'unknown',
    },
    malwareScanner: {
      ok: componentOk('scanner')?.ok ?? false,
      detail: componentOk('scanner')?.detail ?? 'unknown',
    },
    worker: {
      ok: componentOk('worker')?.ok ?? false,
      detail: componentOk('worker')?.detail ?? 'unknown',
    },
    migrations: {
      ok: componentOk('database')?.ok ?? false,
      detail: componentOk('database')?.detail ?? 'unknown',
    },
    backup: {
      ok: backup !== null,
      detail: backup ? `latest backup ${backup.createdAt.toISOString()}` : 'no backup recorded',
    },
    restoreTest: {
      ok: verifiedBackup !== null,
      detail: verifiedBackup
        ? `restore verified ${verifiedBackup.verifiedAt!.toISOString()}`
        : 'no verified restore test',
    },
    retentionPolicy: {
      ok: retentionActive > 0,
      detail: `${retentionActive} active approved retention polic(ies).`,
    },
    criticalExceptions: {
      ok: openCritical === 0,
      detail: `${openCritical} open CRITICAL exception(s).`,
    },
    securityFindings: {
      ok: openSecurity === 0,
      detail: `${openSecurity} open security/privacy incident(s).`,
    },
    uat: {
      ok: uatFlag === true,
      detail: uatFlag === true ? 'UAT recorded as passed.' : 'UAT not recorded as passed.',
    },
    training: {
      ok: trainingCount > 0,
      detail: `${trainingCount} training completion(s) recorded.`,
    },
    sop: {
      ok: sopFlag === true,
      detail: sopFlag === true ? 'SOPs published.' : 'SOPs not marked published.',
    },
    manualFallback: {
      ok: fallbackReady === true,
      detail:
        fallbackReady === true
          ? 'Manual fallback confirmed ready.'
          : 'Manual fallback not confirmed.',
    },
    auditLog: {
      ok: auditRecent !== null,
      detail: auditRecent
        ? `latest audit event ${auditRecent.occurredAt.toISOString()}`
        : 'no audit events',
    },
    integrationTimestamps: {
      ok: lastSync !== null,
      detail: lastSync ? `last sync ${lastSync.startedAt.toISOString()}` : 'no sync recorded',
    },
  };

  return READINESS_GATES.map((g) => ({
    key: g.key,
    label: g.label,
    mandatory: g.mandatory,
    ok: facts[g.key]?.ok ?? false,
    detail: facts[g.key]?.detail ?? 'not evaluated',
  }));
}

export const activationInputSchema = z.object({
  targetState: z.enum([
    'DISABLED',
    'TEST_ONLY',
    'TRAINING_ENABLED',
    'PILOT_READY',
    'PILOT_ACTIVE',
    'POST_ROLLOUT_READY',
    'POST_ROLLOUT_ACTIVE',
    'SUSPENDED',
  ]),
  cohort: z.enum(['PILOT', 'POST_ROLLOUT', 'NONE']).default('PILOT'),
  scope: z
    .object({
      departments: z.array(z.string().trim().min(1)).optional(),
      locations: z.array(z.string().trim().min(1)).optional(),
      departureTypes: z.array(z.string().trim().min(1)).optional(),
      dateFrom: z.string().nullable().optional(),
      dateTo: z.string().nullable().optional(),
      maxActiveCases: z.number().int().min(1).max(500).nullable().optional(),
    })
    .default({}),
  enabledIntegrations: z.array(z.string()).default([]),
  conditions: z.string().trim().max(2000).optional(),
  rollbackPlan: z.string().trim().min(10).max(4000),
  startDate: z.union([z.null(), z.literal('').transform(() => null), z.coerce.date()]).optional(),
});

/** L: create the activation proposal record (immutable core). */
export async function proposeActivation(actor: Actor, rawInput: unknown) {
  if (!can(actor, 'pilot.manage')) throw ServiceError.forbidden();
  const parsed = activationInputSchema.safeParse(rawInput);
  if (!parsed.success)
    throw ServiceError.validation(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  const input = parsed.data;
  const from = await currentActivationState();
  const transitionErr = activationTransitionError(from, input.targetState);
  if (transitionErr) throw ServiceError.validation([transitionErr]);

  const prisma = getPrisma();
  const environment = getConfig().isProduction ? 'production' : 'development';
  const [wfVersions, tmplVersions, calendar] = await Promise.all([
    prisma.workflowDefinition.findMany({
      where: { status: 'ACTIVE' },
      select: { workflowType: true, version: true },
    }),
    prisma.notificationTemplate.findMany({
      where: { status: 'ACTIVE' },
      select: { notificationType: true, version: true },
    }),
    prisma.holidayCalendar.findFirst({ where: { isActive: true }, select: { version: true } }),
  ]);

  const core = {
    environment,
    cohort: input.cohort,
    scope: input.scope,
    enabledIntegrations: input.enabledIntegrations,
    approvedWorkflowVersions: wfVersions,
    approvedTemplateVersions: tmplVersions,
    approvedCalendarVersion: calendar?.version ?? null,
    rollbackPlan: input.rollbackPlan,
  };
  const correlationId = newCorrelationId();
  const record = await prisma.$transaction(async (tx) => {
    await tx.pilotActivation.updateMany({
      where: { supersededAt: null },
      data: { supersededAt: new Date(), rowVersion: { increment: 1 } },
    });
    const row = await tx.pilotActivation.create({
      data: {
        state: input.targetState,
        environment,
        cohort: input.cohort,
        scope: input.scope as never,
        startDate: input.startDate ?? null,
        enabledIntegrations: input.enabledIntegrations,
        approvedWorkflowVersions: wfVersions as never,
        approvedTemplateVersions: tmplVersions as never,
        approvedCalendarVersion: calendar?.version ?? null,
        conditions: input.conditions ?? null,
        rollbackPlan: input.rollbackPlan,
        checksum: activationChecksum(core),
        createdById: actor.userId,
        correlationId,
      },
    });
    await appendAudit(tx, {
      eventType: 'PILOT_ACTIVATION_CREATED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'PilotActivation',
      objectId: row.id,
      result: 'SUCCESS',
      correlationId,
      metadata: { targetState: input.targetState, cohort: input.cohort, checksum: row.checksum },
    });
    return row;
  });
  return record;
}

/** L.3/L.4: role-specific approvals on the pending record. */
export async function approveActivation(
  actor: Actor,
  activationId: string,
  role: 'hr' | 'admin' | 'privacy',
) {
  const permission =
    role === 'hr'
      ? 'pilot.hrApprove'
      : role === 'admin'
        ? 'pilot.adminApprove'
        : 'pilot.privacyApprove';
  if (!can(actor, permission)) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const row = await prisma.pilotActivation.findUnique({ where: { id: activationId } });
  if (!row || row.supersededAt) throw ServiceError.notFound();
  const data =
    role === 'hr'
      ? { hrApprovedById: actor.userId, hrApprovedAt: new Date() }
      : role === 'admin'
        ? { adminApprovedById: actor.userId, adminApprovedAt: new Date() }
        : { privacyApprovedById: actor.userId, privacyApprovedAt: new Date() };
  await prisma.$transaction(async (tx) => {
    await tx.pilotActivation.update({
      where: { id: activationId },
      data: { ...data, rowVersion: { increment: 1 } },
    });
    await appendAudit(tx, {
      eventType: 'PILOT_ACTIVATION_APPROVED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'PilotActivation',
      objectId: activationId,
      result: 'SUCCESS',
      correlationId: newCorrelationId(),
      metadata: { approvalRole: role },
    });
  });
}

/**
 * L.2: apply the proposed state. PILOT_ACTIVE (and beyond) demands mandatory
 * gates + HR and SYSTEM_ADMIN approval (+ privacy where configured).
 */
export async function applyActivation(actor: Actor, activationId: string) {
  if (!can(actor, 'pilot.manage')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const row = await prisma.pilotActivation.findUnique({ where: { id: activationId } });
  if (!row || row.supersededAt) throw ServiceError.notFound();

  const needsFullGates = ['PILOT_ACTIVE', 'POST_ROLLOUT_READY', 'POST_ROLLOUT_ACTIVE'].includes(
    row.state,
  );
  if (needsFullGates) {
    if (!row.hrApprovedById || !row.adminApprovedById)
      throw ServiceError.validation([
        'PILOT activation requires both HR Manager and System Administrator approval (L.3).',
      ]);
    const privacyRequired = (await getSystemConfigValue('pilot.privacyApprovalRequired')) === true;
    if (privacyRequired && !row.privacyApprovedById)
      throw ServiceError.validation([
        'Privacy Officer approval is required by configuration (L.4).',
      ]);
    const gates = await evaluateReadinessGates();
    const blockers = evaluateGateBlockers(gates);
    if (blockers.length > 0)
      throw ServiceError.validation(
        blockers.map((b) => `Readiness gate failed: ${b.label} - ${b.detail}`),
      );
  }

  const { setSystemConfig } = await import('./systemConfigService.ts');
  // State pointer changes through admin config with audit; the record gains
  // its activation timestamp.
  await prisma.$transaction(async (tx) => {
    await tx.pilotActivation.update({
      where: { id: activationId },
      data: { activatedAt: new Date(), rowVersion: { increment: 1 } },
    });
    await tx.systemConfig.upsert({
      where: { key: 'activation.state' },
      create: {
        key: 'activation.state',
        value: row.state,
        reason: `Activation record ${activationId}`,
        updatedById: actor.userId,
      },
      update: {
        value: row.state,
        reason: `Activation record ${activationId}`,
        updatedById: actor.userId,
      },
    });
    await appendAudit(tx, {
      eventType: 'PILOT_STATE_CHANGED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'PilotActivation',
      objectId: activationId,
      result: 'SUCCESS',
      correlationId: row.correlationId,
      metadata: { newState: row.state, checksum: row.checksum },
    });
  });
  void setSystemConfig; // state write handled transactionally above
  return { state: row.state };
}

/** L.8: suspension immediately stops new automated integration work. */
export async function suspendActivation(actor: Actor, reason: string) {
  if (!can(actor, 'pilot.manage')) throw ServiceError.forbidden();
  if (!reason.trim()) throw ServiceError.validation(['A reason is required.']);
  const prisma = getPrisma();
  const current = await prisma.pilotActivation.findFirst({
    where: { supersededAt: null },
    orderBy: { createdAt: 'desc' },
  });
  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    if (current) {
      await tx.pilotActivation.update({
        where: { id: current.id },
        data: { suspendedAt: new Date(), suspendReason: reason, rowVersion: { increment: 1 } },
      });
    }
    await tx.systemConfig.upsert({
      where: { key: 'activation.state' },
      create: { key: 'activation.state', value: 'SUSPENDED', reason, updatedById: actor.userId },
      update: { value: 'SUSPENDED', reason, updatedById: actor.userId },
    });
    // New automated dispatch stops at once; in-flight evidence is preserved.
    await tx.notificationOutbox.updateMany({
      where: { status: { in: ['PENDING', 'FAILED_RETRYABLE'] } },
      data: {
        status: 'CANCELLED',
        cancelReason: `pilot suspended: ${reason}`,
        rowVersion: { increment: 1 },
      },
    });
    await appendAudit(tx, {
      eventType: 'PILOT_SUSPENDED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'PilotActivation',
      objectId: current?.id ?? 'none',
      result: 'SUCCESS',
      correlationId,
      metadata: { reason },
    });
  });
}

export async function getPilotOverview(actor: Actor) {
  if (!can(actor, 'pilot.view')) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const [state, gates, records] = await Promise.all([
    currentActivationState(),
    evaluateReadinessGates(),
    prisma.pilotActivation.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
  ]);
  return {
    state,
    gates,
    blockers: evaluateGateBlockers(gates),
    records,
    canHrApprove: can(actor, 'pilot.hrApprove'),
    canAdminApprove: can(actor, 'pilot.adminApprove'),
    canPrivacyApprove: can(actor, 'pilot.privacyApprove'),
    canManage: can(actor, 'pilot.manage'),
  };
}
