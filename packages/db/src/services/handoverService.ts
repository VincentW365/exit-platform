/**
 * Knowledge transfer and handover (Directive 3 section M).
 *
 * The LINE_MANAGER owns the content; HR monitors completion; HR_MANAGER may
 * waive or mark not applicable with a reason. Credential-like content is
 * rejected (M.1-M.3). Finance and IT never see handover content (R.6).
 */
import {
  canActOnCase,
  canViewCase,
  credentialFieldErrors,
  handoverCompletionErrors,
  handoverTransitionError,
  hasRole,
  HANDOVER_SECTIONS,
  type Actor,
  type AuditEventType,
  type CaseAccessContext,
  type HandoverAction,
} from '@exit/domain';
import { z } from 'zod';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';
import { loadCaseAccess } from './shared.ts';
import { autoResolveException } from './exceptionService.ts';
import { recalcInstanceCounts, releaseEligibleTasks } from './workflowService.ts';

type HandoverAccessLevel = 'HR' | 'MANAGER' | 'OVERSIGHT' | 'NONE';

function handoverAccess(
  actor: Actor,
  ctx: CaseAccessContext,
  record: { managerId: string | null },
): HandoverAccessLevel {
  if (canViewCase(actor, ctx) && hasRole(actor, 'HR_MANAGER', 'HR_OFFICER')) return 'HR';
  if (canViewCase(actor, ctx) && hasRole(actor, 'AUDITOR', 'PRIVACY_OFFICER')) return 'OVERSIGHT';
  // The assigned manager - or a MANAGER participant on the case (M.4/M.8).
  if (
    hasRole(actor, 'LINE_MANAGER') &&
    (record.managerId === actor.userId || ctx.participantUserIds.includes(actor.userId))
  )
    return 'MANAGER';
  return 'NONE';
}

async function loadHandover(actor: Actor, caseId: string) {
  // A MANAGER participant has access level MANAGER_FORM, which loadCaseAccess
  // permits; everyone else without discovery rights stays NOT_FOUND (R.6/H.8).
  const { c, ctx } = await loadCaseAccess(actor, caseId);
  const record = await getPrisma().handoverRecord.findUnique({ where: { caseId } });
  if (!record) throw ServiceError.notFound('No handover record exists for this case yet.');
  const access = handoverAccess(actor, ctx, record);
  if (access === 'NONE') throw ServiceError.notFound();
  return { c, ctx, record, access };
}

export async function getHandover(actor: Actor, caseId: string) {
  const { c, ctx, record, access } = await loadHandover(actor, caseId);
  return {
    caseNumber: c.caseNumber,
    caseStatus: c.status,
    access,
    record,
    sections: HANDOVER_SECTIONS,
    canEdit:
      access === 'MANAGER' &&
      ['NOT_STARTED', 'IN_PROGRESS'].includes(record.status) &&
      ['ACTIVE', 'ON_HOLD'].includes(c.status),
    canComplete: access === 'MANAGER' && ['NOT_STARTED', 'IN_PROGRESS'].includes(record.status),
    canReview: canActOnCase(actor, 'handover.review', ctx),
    canWaive:
      canActOnCase(actor, 'handover.waive', ctx) &&
      ['NOT_STARTED', 'IN_PROGRESS'].includes(record.status),
  };
}

const sectionFields = z.object(
  Object.fromEntries(
    HANDOVER_SECTIONS.map((s) => [s.key, z.string().trim().max(4000).optional()]),
  ) as Record<(typeof HANDOVER_SECTIONS)[number]['key'], z.ZodOptional<z.ZodString>>,
);

/** M.4: the manager records/edits handover content. */
export async function updateHandover(actor: Actor, caseId: string, rawInput: unknown) {
  const parsed = sectionFields.safeParse(rawInput);
  if (!parsed.success)
    throw ServiceError.validation(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  const input = parsed.data;
  const { record, access } = await loadHandover(actor, caseId);
  if (access !== 'MANAGER') throw ServiceError.forbidden();
  if (!['NOT_STARTED', 'IN_PROGRESS'].includes(record.status))
    throw ServiceError.conflict('The handover record is finalized.');

  // M.2/M.3: reject likely credentials in every section.
  const labelled: Record<string, string | undefined> = {};
  for (const s of HANDOVER_SECTIONS) labelled[s.label] = input[s.key];
  const credErrors = credentialFieldErrors(labelled);
  if (credErrors.length) throw ServiceError.validation(credErrors);

  const correlationId = newCorrelationId();
  await getPrisma().$transaction(async (tx) => {
    const updated = await tx.handoverRecord.updateMany({
      where: { id: record.id, rowVersion: record.rowVersion },
      data: {
        ...Object.fromEntries(
          HANDOVER_SECTIONS.filter((s) => input[s.key] !== undefined).map((s) => [
            s.key,
            input[s.key] || null,
          ]),
        ),
        status: 'IN_PROGRESS',
        managerId: record.managerId ?? actor.userId,
        rowVersion: { increment: 1 },
      },
    });
    if (updated.count === 0) throw ServiceError.conflict('The record changed; reload and retry.');
    await appendAudit(tx, {
      eventType: 'HANDOVER_UPDATED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'HandoverRecord',
      objectId: record.id,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        changedSections: HANDOVER_SECTIONS.filter((s) => input[s.key] !== undefined)
          .map((s) => s.key)
          .join(','),
      },
    });
  });
}

/**
 * M: completion (manager attestation), not-applicable and HR_MANAGER waiver.
 * Completion also completes the matching workflow handover task(s), so task
 * evidence and the handover record stay consistent.
 */
export async function transitionHandover(
  actor: Actor,
  caseId: string,
  action: HandoverAction,
  reason?: string,
) {
  const { c, ctx, record, access } = await loadHandover(actor, caseId);
  const transitionErr = handoverTransitionError(action, record.status, reason);
  if (transitionErr) throw ServiceError.validation([transitionErr]);

  if (action === 'complete' && access !== 'MANAGER') throw ServiceError.forbidden();
  if (
    (action === 'waive' || action === 'notApplicable' || action === 'reopen') &&
    !canActOnCase(actor, 'handover.waive', ctx)
  )
    throw ServiceError.forbidden();

  if (action === 'complete') {
    const completionErrors = handoverCompletionErrors(record);
    if (completionErrors.length) throw ServiceError.validation(completionErrors);
  }

  const now = new Date();
  const correlationId = newCorrelationId();
  const actorUser = await getPrisma().user.findUnique({ where: { id: actor.userId } });

  await getPrisma().$transaction(async (tx) => {
    const data: Record<string, unknown> = { rowVersion: { increment: 1 } };
    let eventType: AuditEventType = 'HANDOVER_UPDATED';
    switch (action) {
      case 'complete':
        Object.assign(data, {
          status: 'COMPLETED',
          completedAt: now,
          managerAttestedById: actor.userId,
          managerAttestedAt: now,
        });
        eventType = 'HANDOVER_COMPLETED';
        break;
      case 'notApplicable':
        Object.assign(data, { status: 'NOT_APPLICABLE', notApplicableReason: reason });
        eventType = 'HANDOVER_MARKED_NOT_APPLICABLE';
        break;
      case 'waive':
        Object.assign(data, {
          status: 'WAIVED',
          waiverReason: reason,
          waivedById: actor.userId,
          waivedAt: now,
        });
        eventType = 'HANDOVER_WAIVED';
        break;
      case 'reopen':
        Object.assign(data, {
          status: 'IN_PROGRESS',
          completedAt: null,
          notApplicableReason: null,
          waiverReason: null,
          waivedById: null,
          waivedAt: null,
        });
        eventType = 'HANDOVER_REOPENED';
        break;
    }
    const updated = await tx.handoverRecord.updateMany({
      where: { id: record.id, rowVersion: record.rowVersion, status: record.status },
      data,
    });
    if (updated.count === 0) throw ServiceError.conflict('The record changed; reload and retry.');

    if (action === 'complete') {
      // Manager attestation record bound to the content (M).
      await tx.attestation.create({
        data: {
          subjectType: 'HANDOVER',
          subjectId: record.id,
          subjectVersion: record.rowVersion + 1,
          kind: 'MANAGER_HANDOVER_ATTESTATION',
          caseId,
          actorId: actor.userId,
          actorDisplayName: actorUser?.displayName ?? '(unknown)',
          actorRole: 'LINE_MANAGER',
          meaning:
            'I confirm the recorded handover information is accurate and complete to the best of my knowledge. ' +
            'This is an administrative completion record, not a qualified or advanced electronic signature.',
          contentChecksum: record.id, // record-scoped; content lives in the audited row history
          correlationId,
        },
      });
    }

    // Keep required workflow handover tasks consistent (M.9): completion,
    // waiver or not-applicable satisfies the obligation.
    if (action !== 'reopen') {
      await tx.workflowTask.updateMany({
        where: {
          caseId,
          department: 'LINE_MANAGER',
          taskCode: { contains: 'HANDOVER' },
          status: { in: ['NOT_READY', 'READY', 'IN_PROGRESS', 'BLOCKED'] },
        },
        data:
          action === 'complete'
            ? {
                status: 'COMPLETED',
                completedAt: now,
                completedById: actor.userId,
                completionNote: 'Handover record completed with manager attestation.',
                rowVersion: { increment: 1 },
              }
            : {
                status: 'WAIVED',
                waivedAt: now,
                waivedById: actor.userId,
                waiverReason: `Handover ${action === 'waive' ? 'waived' : 'marked not applicable'}: ${reason}`,
                rowVersion: { increment: 1 },
              },
      });
    }

    await appendAudit(tx, {
      eventType,
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'HandoverRecord',
      objectId: record.id,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { caseNumber: c.caseNumber, action, reason: reason ?? null },
    });
  });

  if (action !== 'reopen') {
    await autoResolveException(caseId, 'HANDOVER_OVERDUE', record.id, `Handover ${action}.`);
    await releaseEligibleTasks(caseId, now);
    const instance = await getPrisma().workflowInstance.findFirst({
      where: { caseId, status: { in: ['ACTIVE', 'ON_HOLD', 'CLEARANCE_PENDING'] } },
      select: { id: true },
    });
    if (instance) await recalcInstanceCounts(instance.id, now);
  }
}

/** HR review note (M.5 monitoring; never content editing - J.7). */
export async function recordHandoverReview(actor: Actor, caseId: string, note: string) {
  const { record, ctx } = await loadHandover(actor, caseId);
  if (!canActOnCase(actor, 'handover.review', ctx)) throw ServiceError.forbidden();
  if (!note.trim() || note.length > 2000)
    throw ServiceError.validation(['A review note of 1-2000 characters is required.']);
  const credErrors = credentialFieldErrors({ 'Review note': note });
  if (credErrors.length) throw ServiceError.validation(credErrors);

  const correlationId = newCorrelationId();
  await getPrisma().$transaction(async (tx) => {
    const updated = await tx.handoverRecord.updateMany({
      where: { id: record.id, rowVersion: record.rowVersion },
      data: {
        hrReviewedById: actor.userId,
        hrReviewedAt: new Date(),
        hrReviewNote: note,
        rowVersion: { increment: 1 },
      },
    });
    if (updated.count === 0) throw ServiceError.conflict('The record changed; reload and retry.');
    await appendAudit(tx, {
      eventType: 'HANDOVER_HR_REVIEWED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'HandoverRecord',
      objectId: record.id,
      caseId,
      result: 'SUCCESS',
      correlationId,
    });
  });
}
