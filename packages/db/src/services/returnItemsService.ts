/**
 * Exit Checklist for Return Items (owner directive, 2026-08-19).
 *
 * One checklist per case, created at activation with the ten items from the HR
 * paper form. HR sends a secure no-login link to whoever receives the
 * property; that person records a status and remarks per item and submits.
 *
 * Two rules from the directive shape everything here:
 *   - submitting never clears an item that is still outstanding, and
 *   - the checklist never marks an asset record cleared on its own.
 */
import { z } from 'zod';
import {
  type Actor,
  canActOnCase,
  checklistSubmissionErrors,
  deriveChecklistStatus,
  RETURN_ITEM_CATALOGUE,
  RETURN_ITEM_STATUSES,
  type ReturnItemKey,
  type ReturnItemStatus,
  unresolvedItems,
} from '@exit/domain';
import { getPrisma } from '../client.ts';
import type { Prisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, newCorrelationId } from './auditService.ts';
import { loadCaseAccess } from './shared.ts';

type Tx = Prisma.TransactionClient;

/** Create the checklist with its ten items. Idempotent per case. */
export async function ensureReturnItemsChecklist(tx: Tx, caseId: string): Promise<string> {
  const existing = await tx.returnItemsChecklist.findUnique({
    where: { caseId },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await tx.returnItemsChecklist.create({
    data: {
      caseId,
      items: {
        create: RETURN_ITEM_CATALOGUE.map((item, index) => ({
          itemKey: item.key,
          label: item.label,
          sortOrder: index,
        })),
      },
    },
    select: { id: true },
  });
  return created.id;
}

/** HR-facing view of the checklist for a case. */
export async function getReturnItemsChecklist(actor: Actor, caseId: string) {
  const { ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'asset.view', ctx)) throw ServiceError.forbidden();
  const checklist = await prismaChecklist(caseId);
  if (!checklist) return null;
  return {
    ...checklist,
    unresolved: unresolvedItems(checklist.items),
    canRecord: canActOnCase(actor, 'asset.manage', ctx),
  };
}

/**
 * HR records the checklist themselves - the paper form came back signed, or a
 * correction is needed after submission. Same validation and the same derived
 * status as the secure form; only the actor on the audit line differs.
 */
export async function recordReturnItemsChecklist(
  actor: Actor,
  caseId: string,
  rawInput: unknown,
): Promise<{ status: string; unresolvedCount: number }> {
  const { ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'asset.manage', ctx)) throw ServiceError.forbidden();
  return submitReturnItemsChecklist(caseId, rawInput, { userId: actor.userId, via: 'USER' });
}

async function prismaChecklist(caseId: string) {
  return getPrisma().returnItemsChecklist.findUnique({
    where: { caseId },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  });
}

/**
 * Open the checklist behind a secure link. The caller has already proved they
 * hold the token, so this returns exactly what the form needs and nothing
 * more: the employee, why and when they are leaving, and the items.
 */
export async function getChecklistForToken(caseId: string) {
  const prisma = getPrisma();
  const [checklist, c] = await Promise.all([
    prismaChecklist(caseId),
    prisma.offboardingCase.findUnique({
      where: { id: caseId },
      select: {
        caseNumber: true,
        employeeDisplayName: true,
        departureType: true,
        confirmedLastDay: true,
        effectiveSeparationAt: true,
      },
    }),
  ]);
  if (!checklist || !c) return null;
  return { checklist, case: c };
}

const itemInput = z.object({
  itemKey: z.string().min(1),
  status: z.enum(RETURN_ITEM_STATUSES),
  remarks: z.string().trim().max(500).optional(),
});

const submitSchema = z.object({
  items: z.array(itemInput).min(1),
  receivedByName: z.string().trim().min(1).max(120),
  receivedAt: z.union([z.string().min(1), z.date()]).optional(),
  submittedByName: z.string().trim().min(1).max(120),
  employeeAcknowledgedBy: z.string().trim().max(120).optional(),
});

export type SubmitChecklistInput = z.infer<typeof submitSchema>;

/**
 * Record a submission from the secure form. Every item keeps its own status
 * and remarks; the overall status is derived, never supplied.
 */
export async function submitReturnItemsChecklist(
  caseId: string,
  rawInput: unknown,
  actorLabel: { userId?: string | null; via: 'TOKEN' | 'USER' },
): Promise<{ status: string; unresolvedCount: number }> {
  const parsed = submitSchema.safeParse(rawInput);
  if (!parsed.success)
    throw ServiceError.validation(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  const input = parsed.data;

  const prisma = getPrisma();
  const checklist = await prismaChecklist(caseId);
  if (!checklist) throw ServiceError.notFound();

  // Map the submitted statuses onto the stored rows, keeping the labels the
  // form was built from so the validation messages name real items.
  const merged = checklist.items.map((row) => {
    const sent = input.items.find((i) => i.itemKey === row.itemKey);
    return {
      id: row.id,
      key: row.itemKey as ReturnItemKey,
      label: row.label,
      status: (sent?.status ?? row.status) as ReturnItemStatus,
      remarks: sent?.remarks ?? row.remarks ?? null,
    };
  });

  const errors = checklistSubmissionErrors(merged, input.receivedByName);
  if (errors.length) {
    await savePartialChecklist(checklist.id, caseId, merged, actorLabel);
    throw ServiceError.validation(errors);
  }

  const wasSubmitted = checklist.submittedAt != null;
  const status = deriveChecklistStatus(merged, true);
  const unresolved = unresolvedItems(merged);
  const now = new Date();
  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : now;
  const correlationId = newCorrelationId();

  await prisma.$transaction(async (tx) => {
    for (const item of merged) {
      await tx.returnItemsChecklistEntry.update({
        where: { id: item.id },
        data: { status: item.status, remarks: item.remarks },
      });
    }
    const updated = await tx.returnItemsChecklist.updateMany({
      where: { id: checklist.id, rowVersion: checklist.rowVersion },
      data: {
        status,
        submittedAt: now,
        submittedByName: input.submittedByName,
        submittedByUserId: actorLabel.userId ?? null,
        receivedByName: input.receivedByName,
        receivedAt,
        employeeAcknowledgedBy: input.employeeAcknowledgedBy || null,
        employeeAcknowledgedAt: input.employeeAcknowledgedBy ? now : null,
        rowVersion: { increment: 1 },
      },
    });
    if (updated.count === 0)
      throw ServiceError.conflict('The checklist changed while you were completing it.');

    await appendAudit(tx, {
      eventType: wasSubmitted ? 'RETURN_CHECKLIST_CORRECTED' : 'RETURN_CHECKLIST_SUBMITTED',
      actorType: actorLabel.via === 'TOKEN' ? 'SYSTEM' : 'USER',
      actorId: actorLabel.userId ?? null,
      effectiveRoles: [],
      objectType: 'ReturnItemsChecklist',
      objectId: checklist.id,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        status,
        submittedVia: actorLabel.via,
        itemCount: merged.length,
        unresolvedCount: unresolved.length,
        // Names of unresolved items only - no remarks, which are free text.
        unresolvedItems: unresolved.map((i) => i.label),
      },
    });
  });

  return { status, unresolvedCount: unresolved.length };
}

/**
 * Keep an incomplete form's work. The checklist stays un-submitted, so the
 * derived status can only be NOT_STARTED or IN_PROGRESS - never COMPLETED.
 */
async function savePartialChecklist(
  checklistId: string,
  caseId: string,
  merged: ReadonlyArray<{ id: string; status: ReturnItemStatus; remarks: string | null }>,
  actorLabel: { userId?: string | null; via: 'TOKEN' | 'USER' },
): Promise<void> {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    for (const item of merged) {
      await tx.returnItemsChecklistEntry.update({
        where: { id: item.id },
        data: { status: item.status, remarks: item.remarks },
      });
    }
    await tx.returnItemsChecklist.update({
      where: { id: checklistId },
      data: { status: deriveChecklistStatus(merged, false), rowVersion: { increment: 1 } },
    });
    await appendAudit(tx, {
      eventType: 'RETURN_CHECKLIST_SAVED',
      actorType: actorLabel.via === 'TOKEN' ? 'SYSTEM' : 'USER',
      actorId: actorLabel.userId ?? null,
      effectiveRoles: [],
      objectType: 'ReturnItemsChecklist',
      objectId: checklistId,
      caseId,
      result: 'SUCCESS',
      correlationId: newCorrelationId(),
      metadata: { submittedVia: actorLabel.via, itemCount: merged.length },
    });
  });
}

/** Record that the secure link was sent, for the case view and metrics. */
export async function markChecklistSent(
  tx: Tx,
  caseId: string,
  recipient: { name: string | null; mask: string | null },
): Promise<void> {
  const checklist = await tx.returnItemsChecklist.findUnique({
    where: { caseId },
    select: { id: true, sentAt: true },
  });
  if (!checklist || checklist.sentAt) return;
  await tx.returnItemsChecklist.update({
    where: { id: checklist.id },
    data: { sentAt: new Date(), sentToName: recipient.name, sentToMask: recipient.mask },
  });
  await appendAudit(tx, {
    eventType: 'RETURN_CHECKLIST_SENT',
    actorType: 'SYSTEM',
    effectiveRoles: [],
    objectType: 'ReturnItemsChecklist',
    objectId: checklist.id,
    caseId,
    result: 'SUCCESS',
    correlationId: newCorrelationId(),
    // The mask only - a recipient address never lands in the audit trail.
    metadata: { recipientName: recipient.name, recipientMask: recipient.mask },
  });
}
