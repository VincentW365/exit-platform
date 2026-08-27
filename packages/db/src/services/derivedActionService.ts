/**
 * Deterministic derived-action orchestration (Directive 6.3 B/C).
 *
 * Persists what the pure rules engine (domain/derivedActions.ts) decides as
 * CaseRequiredAction rows with full provenance, creates the derived email
 * actions, opens/resolves the matching exceptions, and serves the
 * exception-first Required Actions panel. Idempotent per (case, actionKey):
 * re-derivation updates rows in place and never duplicates work. Every
 * automated decision is audited (AB).
 */
import {
  canActOnCase,
  deriveRequiredActions,
  emailActionDisplayState,
  summarizeRequiredActions,
  DERIVATION_RULES_VERSION,
  EMAIL_ACTION_STATE_LABELS,
  type Actor,
  type DerivationFacts,
  type DerivedActionSpec,
  type NotificationType,
  type RequiredActionRow,
} from '@exit/domain';
import { z } from 'zod';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';
import { autoResolveException, openException } from './exceptionService.ts';
import { loadCaseAccess } from './shared.ts';
import { prepareDerivedNotification } from './notificationService.ts';

/** Build the facts the rules engine consumes from what the platform holds. */
async function gatherFacts(caseId: string): Promise<{
  facts: DerivationFacts;
  caseRow: NonNullable<
    Awaited<ReturnType<ReturnType<typeof getPrisma>['offboardingCase']['findUnique']>>
  >;
} | null> {
  const prisma = getPrisma();
  const c = await prisma.offboardingCase.findUnique({ where: { id: caseId } });
  if (!c || !c.effectiveSeparationAt) return null;
  const issuedAssets = await prisma.issuedAsset.findMany({
    where: { employeeSourceId: c.employeeSourceId, active: true },
    select: { id: true, assetType: true, catalogueLabel: true },
  });
  const overriddenInvitation = await prisma.surveyInvitation.findFirst({
    where: { caseId, overrideReason: { not: null } },
    select: { id: true },
  });
  return {
    caseRow: c,
    facts: {
      departureType: c.departureType,
      classification: c.classification,
      effectiveSeparationAt: c.effectiveSeparationAt,
      // The distinct separation dates recipients need named (directive 21, 24).
      receivedAt: c.receivedAt,
      confirmedLastDay: c.confirmedLastDay,
      groupHealthApplicability: c.groupHealthApplicability,
      groupLifeApplicability: c.groupLifeApplicability,
      otherProviderApplicability: c.otherProviderApplicability,
      surveyEligibilityOverridden: overriddenInvitation !== null,
      issuedAssets: issuedAssets.map((a) => ({
        id: a.id,
        assetType: a.assetType,
        label: a.catalogueLabel,
      })),
    },
  };
}

/**
 * Run (or re-run) the derivation for a case. Called at workflow activation
 * and after any material input changes (benefits confirmation, effective-time
 * or departure-type corrections). Safe to call repeatedly.
 */
export async function deriveActionsForCase(
  caseId: string,
  now: Date = new Date(),
): Promise<{ derived: number; notApplicable: number; requiresReview: number } | null> {
  const prisma = getPrisma();
  const gathered = await gatherFacts(caseId);
  if (!gathered) return null;
  const { facts, caseRow } = gathered;
  const instance = await prisma.workflowInstance.findFirst({
    where: { caseId, status: { in: ['ACTIVE', 'ON_HOLD', 'CLEARANCE_PENDING'] } },
    select: {
      id: true,
      tasks: { select: { department: true }, where: { department: { in: ['IT', 'FINANCE'] } } },
    },
  });
  // AD: instances pinned to a legacy definition still carry IT/FINANCE login
  // tasks - they clear task-based and never receive derived email actions
  // (no double notification, no reinterpretation of running work).
  const legacyInstance = (instance?.tasks.length ?? 0) > 0;
  const allSpecs = deriveRequiredActions(facts, now);
  const specs = legacyInstance ? allSpecs.filter((s) => s.kind !== 'EMAIL_ACTION') : allSpecs;
  const correlationId = newCorrelationId();

  for (const spec of specs) {
    await prisma.caseRequiredAction.upsert({
      where: { caseId_actionKey: { caseId, actionKey: spec.actionKey } },
      create: {
        caseId,
        workflowInstanceId: instance?.id ?? null,
        actionKey: spec.actionKey,
        actionGroup: spec.group,
        kind: spec.kind,
        title: spec.title,
        applicable: spec.applicable,
        determination: spec.determination,
        ruleKey: spec.ruleKey,
        rulesVersion: DERIVATION_RULES_VERSION,
        sourceFields: spec.sourceFields as object,
        result: spec.result as object,
        derivedAt: now,
      },
      update: {
        // Overridden rows keep the human decision; the rule only refreshes
        // its provenance (C: overrides always win until removed).
        title: spec.title,
        determination: spec.determination,
        ruleKey: spec.ruleKey,
        rulesVersion: DERIVATION_RULES_VERSION,
        sourceFields: spec.sourceFields as object,
        result: spec.result as object,
        derivedAt: now,
        supersededAt: null,
        supersededReason: null,
        rowVersion: { increment: 1 },
      },
    });
    // applicable only refreshes when NOT manually overridden.
    await prisma.caseRequiredAction.updateMany({
      where: { caseId, actionKey: spec.actionKey, overridden: false },
      data: { applicable: spec.applicable },
    });
  }

  // Link asset actions to their recovery items (created at activation).
  const assetSpecs = specs.filter((s) => s.kind === 'ASSET_RECOVERY' && s.applicable);
  for (const spec of assetSpecs) {
    const issuedAssetId = spec.actionKey.slice('ASSET:'.length);
    const item = await prisma.assetRecoveryItem.findFirst({
      where: { caseId, issuedAssetId },
      select: { id: true },
    });
    if (item) {
      await prisma.caseRequiredAction.updateMany({
        where: { caseId, actionKey: spec.actionKey, refId: null },
        data: { refType: 'ASSET_RECOVERY_ITEM', refId: item.id },
      });
    }
  }

  // Create/refresh the derived email actions (email creation is itself
  // idempotent per case + type + effective event).
  const emailSpecs = specs.filter(
    (s): s is DerivedActionSpec & { notificationType: NotificationType } =>
      s.kind === 'EMAIL_ACTION' && s.applicable && s.notificationType !== null,
  );
  for (const spec of emailSpecs) {
    const row = await prisma.caseRequiredAction.findUnique({
      where: { caseId_actionKey: { caseId, actionKey: spec.actionKey } },
      select: { id: true, overridden: true, applicable: true },
    });
    if (!row || (row.overridden === true && row.applicable === false)) continue;
    const prepared = await prepareDerivedNotification({
      caseId,
      notificationType: spec.notificationType,
      derivedActionId: row.id,
      scheduledSendAt: spec.scheduledSendAt,
      now,
    });
    if (prepared.recordId) {
      await prisma.caseRequiredAction.updateMany({
        where: { id: row.id },
        data: { refType: 'NOTIFICATION_RECORD', refId: prepared.recordId },
      });
    }
  }

  // Benefits uncertainty is an actionable exception; resolution clears it.
  const unknowns = [
    facts.groupHealthApplicability,
    facts.groupLifeApplicability,
    facts.otherProviderApplicability,
  ].filter((v) => v === 'UNKNOWN').length;
  if (unknowns > 0) {
    await openException(caseId, {
      exceptionType: 'BENEFITS_APPLICABILITY_UNKNOWN',
      severity: 'WARNING',
      title: 'Confirm benefits applicability',
      detail: `${unknowns} benefits determination(s) are UNKNOWN. Confirm group health, group life and other-provider applicability under Benefits & providers.`,
      refType: 'OffboardingCase',
      refId: caseId,
      ownerDepartment: 'HR',
    });
  } else {
    await autoResolveException(
      caseId,
      'BENEFITS_APPLICABILITY_UNKNOWN',
      caseId,
      'All benefits applicability determinations are resolved.',
    );
  }

  const counts = {
    derived: specs.filter((s) => s.determination === 'DERIVED').length,
    notApplicable: specs.filter((s) => s.determination === 'NOT_APPLICABLE').length,
    requiresReview: specs.filter((s) => s.determination === 'REQUIRES_REVIEW').length,
  };
  await appendAudit(prisma, {
    eventType: 'DERIVED_ACTIONS_COMPUTED',
    actorType: 'SYSTEM',
    objectType: 'OffboardingCase',
    objectId: caseId,
    caseId,
    result: 'SUCCESS',
    correlationId,
    metadata: {
      rulesVersion: DERIVATION_RULES_VERSION,
      derivedCount: counts.derived,
      notApplicableCount: counts.notApplicable,
      requiresReviewCount: counts.requiresReview,
      caseNumber: caseRow.caseNumber,
    },
  });
  return counts;
}

export const benefitsSchema = z.object({
  groupHealth: z.enum(['YES', 'NO', 'UNKNOWN']),
  groupLife: z.enum(['YES', 'NO', 'UNKNOWN']),
  // Owner request 2026-08-19: the "other provider" question left the benefits
  // section. The column stays for historical records and is always NO for new
  // confirmations, so the rules engine derives nothing for it.
  otherProvider: z.enum(['YES', 'NO']).default('NO'),
});

/**
 * Directive 6.3 V: HR confirms benefits applicability once; the rules engine
 * derives everything downstream (YES prepares, NO creates nothing).
 */
export async function confirmBenefits(actor: Actor, caseId: string, rawInput: unknown) {
  const parsed = benefitsSchema.safeParse(rawInput);
  if (!parsed.success)
    throw ServiceError.validation(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  const input = parsed.data;
  const { c, ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'benefits.confirm', ctx)) throw ServiceError.forbidden();
  if (['COMPLETED', 'CANCELLED', 'VOIDED'].includes(c.status))
    throw ServiceError.conflict('Benefits applicability cannot change on a closed case.');

  const prisma = getPrisma();
  const now = new Date();
  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    const u = await tx.offboardingCase.updateMany({
      where: { id: caseId, version: c.version },
      data: {
        groupHealthApplicability: input.groupHealth,
        groupLifeApplicability: input.groupLife,
        otherProviderApplicability: input.otherProvider,
        benefitsConfirmedById: actor.userId,
        benefitsConfirmedAt: now,
        benefitsSource: 'HR_CONFIRMED',
        version: { increment: 1 },
      },
    });
    if (u.count === 0) throw ServiceError.conflict('The case was changed; reload and retry.');
    await appendAudit(tx, {
      eventType: 'BENEFITS_APPLICABILITY_SET',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'OffboardingCase',
      objectId: caseId,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        groupHealth: input.groupHealth,
        groupLife: input.groupLife,
        otherProvider: input.otherProvider,
      },
    });
  });
  // Re-derive so YES prepares notifications and NO clears them.
  await deriveActionsForCase(caseId, now);
}

/** C: authorized override with a mandatory reason - always audited. */
export async function overrideDerivedAction(
  actor: Actor,
  actionId: string,
  input: { applicable: boolean; reason: string },
) {
  const prisma = getPrisma();
  const action = await prisma.caseRequiredAction.findUnique({ where: { id: actionId } });
  if (!action) throw ServiceError.notFound();
  const { ctx } = await loadCaseAccess(actor, action.caseId);
  if (!canActOnCase(actor, 'derivedAction.override', ctx)) throw ServiceError.forbidden();
  if (!input.reason.trim()) throw ServiceError.validation(['An override reason is required.']);

  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    const u = await tx.caseRequiredAction.updateMany({
      where: { id: actionId, rowVersion: action.rowVersion },
      data: {
        applicable: input.applicable,
        overridden: true,
        overrideReason: input.reason.trim(),
        overriddenById: actor.userId,
        overriddenAt: new Date(),
        rowVersion: { increment: 1 },
      },
    });
    if (u.count === 0) throw ServiceError.conflict('The action changed; reload and retry.');
    await appendAudit(tx, {
      eventType: 'DERIVED_ACTION_OVERRIDDEN',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'CaseRequiredAction',
      objectId: actionId,
      caseId: action.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        actionKey: action.actionKey,
        title: action.title,
        applicable: input.applicable,
        reason: input.reason.trim(),
      },
    });
  });
  // Overriding to applicable re-runs preparation for that action.
  if (input.applicable) await deriveActionsForCase(action.caseId, new Date());
}

/**
 * The exception-first Required Actions panel (Directive 6.3 X/Y, correction
 * 8): "Requires your attention" first, then "In progress automatically",
 * then "Completed" - HR never sees a 20-row click list.
 */
export async function listRequiredActions(actor: Actor, caseId: string) {
  const { c, ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'workflow.view', ctx)) throw ServiceError.forbidden();
  const prisma = getPrisma();
  const now = new Date();
  const base = `/cases/${caseId}`;

  const [actions, records, assetItems, invitation] = await Promise.all([
    prisma.caseRequiredAction.findMany({
      where: { caseId, supersededAt: null },
      orderBy: [{ actionGroup: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.notificationRecord.findMany({
      where: { caseId },
      select: {
        id: true,
        notificationType: true,
        status: true,
        origin: true,
        scheduledSendAt: true,
        sentAt: true,
        acknowledgedAt: true,
        completionConfirmedAt: true,
        recipientConfigId: true,
        caseRecipientCiphertext: true,
        derivedActionId: true,
      },
    }),
    prisma.assetRecoveryItem.findMany({
      where: { caseId },
      select: { id: true, status: true, label: true },
    }),
    prisma.surveyInvitation.findFirst({ where: { caseId }, orderBy: { createdAt: 'desc' } }),
  ]);

  const rows: RequiredActionRow[] = [];
  for (const a of actions) {
    if (a.kind === 'EMAIL_ACTION') {
      const record =
        records.find((r) => r.derivedActionId === a.id) ??
        records.find((r) => r.id === a.refId) ??
        null;
      const state = emailActionDisplayState({
        applicable: a.applicable,
        status: record?.status ?? null,
        recipientResolved: record
          ? record.recipientConfigId !== null || record.caseRecipientCiphertext !== null
          : false,
        scheduledSendAt: record?.scheduledSendAt ?? null,
        ackDeadlineAt: a.actionKey === 'EMAIL:IT_ACCESS_REMOVAL' ? c.effectiveSeparationAt : null,
        requiresCompletionEvidence: a.actionKey === 'EMAIL:IT_ACCESS_REMOVAL',
        now,
      });
      const status =
        state === 'NOT_APPLICABLE'
          ? ('NOT_APPLICABLE' as const)
          : state === 'COMPLETED'
            ? ('COMPLETE' as const)
            : state === 'FAILED'
              ? ('FAILED' as const)
              : state === 'OVERDUE'
                ? ('OVERDUE' as const)
                : state === 'RECIPIENT_REQUIRED'
                  ? ('ACTION_REQUIRED' as const)
                  : state === 'NEEDS_REVIEW'
                    ? a.determination === 'REQUIRES_REVIEW'
                      ? ('ACTION_REQUIRED' as const)
                      : ('WAITING' as const)
                    : ('AUTOMATED' as const);
      rows.push({
        key: a.actionKey,
        label: a.title,
        detail: EMAIL_ACTION_STATE_LABELS[state],
        status,
        group: a.actionGroup,
        href: `${base}/notifications`,
        dueAt: record?.scheduledSendAt ?? null,
        automated: status === 'AUTOMATED' || status === 'WAITING',
      });
    } else if (a.kind === 'ASSET_RECOVERY') {
      if (!a.applicable) {
        rows.push({
          key: a.actionKey,
          label: a.title,
          detail: 'No company assets are recorded as issued to this employee.',
          status: 'NOT_APPLICABLE',
          group: 'ASSETS',
          href: `${base}/assets`,
          dueAt: null,
          automated: false,
        });
        continue;
      }
      const item = assetItems.find((i) => i.id === a.refId);
      const done =
        item && ['RETURNED', 'NOT_ISSUED', 'WAIVED', 'WRITTEN_OFF'].includes(item.status);
      const trouble = item && ['LOST', 'DAMAGED', 'UNRESOLVED'].includes(item.status);
      rows.push({
        key: a.actionKey,
        label: a.title,
        detail: done ? 'Returned / documented' : trouble ? 'Needs a decision' : 'Awaiting return',
        status: done ? 'COMPLETE' : trouble ? 'ACTION_REQUIRED' : 'READY',
        group: 'ASSETS',
        href: `${base}/assets`,
        dueAt: null,
        automated: false,
      });
    } else if (a.kind === 'BENEFITS_CONFIRMATION') {
      const unresolved = a.applicable;
      rows.push({
        key: a.actionKey,
        label: a.title,
        detail: unresolved ? 'Confirm group health, group life and other providers' : 'Confirmed',
        status: unresolved ? 'ACTION_REQUIRED' : 'COMPLETE',
        group: 'BENEFITS',
        href: base,
        dueAt: null,
        automated: false,
      });
    } else {
      // SURVEY_INVITATION
      const surveyDone =
        invitation && ['COMPLETED', 'DECLINED', 'EXPIRED', 'CANCELLED'].includes(invitation.status);
      rows.push({
        key: a.actionKey,
        label: a.title,
        detail: !a.applicable
          ? 'Not applicable for this departure type'
          : surveyDone
            ? 'Closed'
            : invitation
              ? 'Scheduled - never blocks clearance'
              : 'Will be scheduled after separation',
        status: !a.applicable ? 'NOT_APPLICABLE' : surveyDone ? 'COMPLETE' : 'AUTOMATED',
        group: 'SURVEY',
        href: `${base}/survey`,
        dueAt: null,
        automated: true,
      });
    }
  }

  const summary = summarizeRequiredActions(rows);
  return {
    caseNumber: c.caseNumber,
    summary,
    attentionCount: summary.counts.attention,
    firstAttention: summary.attention[0] ?? null,
    canOverride: canActOnCase(actor, 'derivedAction.override', ctx),
    canConfirmBenefits: canActOnCase(actor, 'benefits.confirm', ctx),
    benefits: {
      groupHealth: c.groupHealthApplicability,
      groupLife: c.groupLifeApplicability,
      otherProvider: c.otherProviderApplicability,
      confirmedAt: c.benefitsConfirmedAt,
    },
    actions: actions.map((a) => ({
      id: a.id,
      actionKey: a.actionKey,
      title: a.title,
      applicable: a.applicable,
      determination: a.determination,
      overridden: a.overridden,
      overrideReason: a.overrideReason,
    })),
  };
}
