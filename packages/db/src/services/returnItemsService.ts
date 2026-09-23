/**
 * Exit Checklist for Return Items (owner directive, 2026-08-19; DEC-053) -
 * since DEC-069 an editable, versioned, signable document.
 *
 * One LIVE checklist per case, created at activation with the ten items from
 * the HR paper form. HR sends a secure no-login link to whoever receives the
 * property; that person records a status and remarks per item and submits.
 * HR may also edit the receipt in place - rows, quantities, condition,
 * return dates, asset references, notes - preview and download it as a PDF,
 * collect signatures on it, finalize it, and, when a signed version must
 * change, start a new version that supersedes the old one.
 *
 * Two rules from the original directive still shape everything here:
 *   - submitting never clears an item that is still outstanding, and
 *   - the checklist never marks an asset record cleared on its own.
 */
import { z } from 'zod';
import {
  type Actor,
  canActOnCase,
  checklistSubmissionErrors,
  deriveChecklistStatus,
  receiptDisplayStatus,
  receiptRowErrors,
  RECEIPT_NOTES_LIMIT,
  RETURN_ITEM_CATALOGUE,
  RETURN_ITEM_STATUSES,
  RETURN_ITEM_STATUS_LABEL,
  SIGNER_ROLE_LABELS,
  type ReceiptRowInput,
  type ReturnItemKey,
  type ReturnItemStatus,
  unresolvedItems,
} from '@exit/domain';
import { getPrisma } from '../client.ts';
import type { Prisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, auditDenied, newCorrelationId } from './auditService.ts';
import { loadCaseAccess } from './shared.ts';
import { listRevisions, recordRevisionTx } from './revisionService.ts';
import {
  renderReturnItemsPdf,
  renderReturnItemsPdfBytes,
  type ReturnItemsRenderInput,
} from './renderRecordsService.ts';

type Tx = Prisma.TransactionClient;

const LIVE_LIFECYCLES = ['DRAFT', 'READY', 'FINAL'] as const;

/** The live version of a case's checklist: the newest not superseded/voided. */
async function liveChecklist(client: Tx | ReturnType<typeof getPrisma>, caseId: string) {
  return client.returnItemsChecklist.findFirst({
    where: { caseId, lifecycle: { in: [...LIVE_LIFECYCLES] } },
    orderBy: { version: 'desc' },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
  });
}

/** Create the checklist with its ten items. Idempotent per case. */
export async function ensureReturnItemsChecklist(tx: Tx, caseId: string): Promise<string> {
  const existing = await liveChecklist(tx, caseId);
  if (existing) return existing.id;
  const created = await tx.returnItemsChecklist.create({
    data: {
      caseId,
      version: 1,
      lifecycle: 'DRAFT',
      items: {
        create: RETURN_ITEM_CATALOGUE.map((item, index) => ({
          itemKey: item.key,
          label: item.label,
          sortOrder: index,
        })),
      },
    },
    include: { items: true },
  });
  await recordRevisionTx(tx, {
    caseId,
    documentKind: 'ASSET_RECEIPT',
    documentId: created.id,
    kind: 'GENERATED',
    content: receiptContent(created),
    note: 'Generated from the company checklist at activation',
  });
  return created.id;
}

/** The editable parts of a receipt, as the revision log stores them. */
function receiptContent(r: {
  hrNotes?: string | null;
  receivedByName?: string | null;
  receivedAt?: Date | null;
  items: Array<{
    itemKey: ReturnItemKey | null;
    label: string;
    status: ReturnItemStatus | string;
    remarks: string | null;
    quantity?: number | null;
    condition?: string | null;
    returnedAt?: Date | null;
    assetReference?: string | null;
  }>;
}) {
  return {
    hrNotes: r.hrNotes ?? null,
    receivedByName: r.receivedByName ?? null,
    receivedAt: r.receivedAt ? r.receivedAt.toISOString().slice(0, 10) : null,
    rows: r.items.map((i) => ({
      itemKey: i.itemKey,
      label: i.label,
      status: i.status,
      remarks: i.remarks,
      quantity: i.quantity ?? null,
      condition: i.condition ?? null,
      returnedAt: i.returnedAt ? i.returnedAt.toISOString().slice(0, 10) : null,
      assetReference: i.assetReference ?? null,
    })),
  };
}

/** HR-facing view of the checklist for a case, as a document workspace. */
export async function getReturnItemsChecklist(actor: Actor, caseId: string) {
  const { ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'asset.view', ctx)) throw ServiceError.forbidden();
  const checklist = await liveChecklist(getPrisma(), caseId);
  if (!checklist) return null;
  const { signatureSummaryFor } = await import('./signatureService.ts');
  const signatures = await signatureSummaryFor('ASSET_RECEIPT', checklist.id);
  const signedRequests = await getPrisma().signatureRequest.count({
    where: { checklistId: checklist.id, status: 'SIGNED' },
  });
  const locked = ['FINAL', 'SUPERSEDED', 'VOIDED'].includes(checklist.lifecycle);
  const hasLiveSignatures = signatures.applied.length > 0;
  const history = await getPrisma().returnItemsChecklist.findMany({
    where: { caseId, id: { not: checklist.id } },
    orderBy: { version: 'desc' },
    select: {
      id: true,
      version: true,
      lifecycle: true,
      supersededReason: true,
      pdfChecksum: true,
      finalizedAt: true,
    },
  });
  return {
    ...checklist,
    unresolved: unresolvedItems(checklist.items),
    canRecord: canActOnCase(actor, 'asset.manage', ctx) && !locked,
    canManage: canActOnCase(actor, 'asset.manage', ctx),
    /** Editing is refused once a signature is on this version (section 5). */
    editable: canActOnCase(actor, 'asset.manage', ctx) && !locked && !hasLiveSignatures,
    locked,
    hasLiveSignatures,
    displayStatus: receiptDisplayStatus({
      lifecycle: checklist.lifecycle,
      openSignatureRequests: signatures.pendingRequests,
      signedSignatureRequests: signedRequests,
    }),
    signatures: signatures.applied.map((s) => ({
      blockKey: s.blockKey,
      blockLabel: s.blockLabel,
      signerName: s.signerName,
      signerRole: SIGNER_ROLE_LABELS[s.signerRole],
      signedAt: s.signedAt,
    })),
    revisions: await listRevisions('ASSET_RECEIPT', checklist.id),
    history,
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

/**
 * Open the checklist behind a secure link. The caller has already proved they
 * hold the token, so this returns exactly what the form needs and nothing
 * more.
 */
export async function getChecklistForToken(caseId: string) {
  const prisma = getPrisma();
  const [checklist, c] = await Promise.all([
    liveChecklist(prisma, caseId),
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
  const checklist = await liveChecklist(prisma, caseId);
  if (!checklist) throw ServiceError.notFound();
  // DEC-069 section 5: a finalized or signed version is never changed in
  // place. HR starts a new version first.
  if (checklist.lifecycle === 'FINAL')
    throw ServiceError.conflict(
      'This checklist version is final. Start a new version to record a change.',
    );
  const signed = await prisma.signatureRecord.count({
    where: { checklistId: checklist.id, supersededAt: null },
  });
  if (signed > 0)
    throw ServiceError.conflict(
      'This checklist version has been signed. Start a new version to record a change.',
    );

  // Map the submitted statuses onto the stored rows, keeping the labels the
  // form was built from so the validation messages name real items. Rows HR
  // added (no catalogue key) keep what HR recorded.
  const merged = checklist.items.map((row) => {
    const sent = row.itemKey ? input.items.find((i) => i.itemKey === row.itemKey) : undefined;
    return {
      id: row.id,
      key: (row.itemKey ?? `custom:${row.id}`) as ReturnItemKey,
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

    await recordRevisionTx(tx, {
      caseId,
      documentKind: 'ASSET_RECEIPT',
      documentId: checklist.id,
      kind: 'EDITED',
      content: receiptContent({
        hrNotes: checklist.hrNotes,
        receivedByName: input.receivedByName,
        receivedAt,
        items: checklist.items.map((row) => ({
          ...row,
          status: merged.find((m) => m.id === row.id)?.status ?? row.status,
          remarks: merged.find((m) => m.id === row.id)?.remarks ?? row.remarks,
        })),
      }),
      editedById: actorLabel.userId ?? null,
      note:
        actorLabel.via === 'TOKEN'
          ? 'Completed through the secure link'
          : wasSubmitted
            ? 'Corrected by HR'
            : 'Recorded by HR',
    });
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
  const checklist = await tx.returnItemsChecklist.findFirst({
    where: { caseId, lifecycle: { in: [...LIVE_LIFECYCLES] } },
    orderBy: { version: 'desc' },
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

// --- DEC-069: the receipt as an editable, versioned document -----------------------

const editRowSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  itemKey: z.string().min(1).nullable().optional(),
  label: z.string().trim().max(120),
  status: z.enum(RETURN_ITEM_STATUSES),
  remarks: z.string().trim().max(500).nullable().optional(),
  quantity: z.number().int().nullable().optional(),
  condition: z.string().trim().max(300).nullable().optional(),
  returnedAt: z.string().nullable().optional(),
  assetReference: z.string().trim().max(120).nullable().optional(),
});

const editSchema = z.object({
  rows: z.array(editRowSchema).min(1).max(60),
  hrNotes: z.string().trim().max(RECEIPT_NOTES_LIMIT).nullable().optional(),
  receivedByName: z.string().trim().max(120).nullable().optional(),
  receivedAt: z.string().nullable().optional(),
});

async function loadForEdit(actor: Actor, caseId: string) {
  const { ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'asset.manage', ctx)) {
    await auditDenied(actor, 'ACCESS_DENIED', 'ReturnItemsChecklist', caseId, caseId);
    throw ServiceError.forbidden();
  }
  const checklist = await liveChecklist(getPrisma(), caseId);
  if (!checklist) throw ServiceError.notFound();
  return { checklist, ctx };
}

/**
 * Directive section 14: HR edits the receipt before finalization - adds and
 * removes rows for property the form does not list, corrects descriptions,
 * records quantity, condition, return date and asset reference, adds notes,
 * and identifies what is still outstanding. Every save is a revision.
 */
export async function updateReturnItemsChecklist(actor: Actor, caseId: string, rawInput: unknown) {
  const parsed = editSchema.safeParse(rawInput);
  if (!parsed.success)
    throw ServiceError.validation(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  const input = parsed.data;
  const { checklist } = await loadForEdit(actor, caseId);
  if (checklist.lifecycle === 'FINAL')
    throw ServiceError.conflict(
      'This checklist version is final. Start a new version to change it.',
    );
  const prisma = getPrisma();
  const signed = await prisma.signatureRecord.count({
    where: { checklistId: checklist.id, supersededAt: null },
  });
  if (signed > 0)
    throw ServiceError.conflict(
      'This checklist version has been signed. Start a new version to change it.',
    );

  const rows: ReceiptRowInput[] = input.rows.map((r) => ({
    id: r.id ?? null,
    itemKey: (r.itemKey as ReturnItemKey | null | undefined) ?? null,
    label: r.label,
    status: r.status,
    remarks: r.remarks ?? null,
    quantity: r.quantity ?? null,
    condition: r.condition ?? null,
    returnedAt: r.returnedAt || null,
    assetReference: r.assetReference ?? null,
  }));
  const errors = receiptRowErrors(rows);
  if (input.receivedAt && !/^\d{4}-\d{2}-\d{2}$/.test(input.receivedAt))
    errors.push('The received date must be a valid date.');
  if (errors.length) throw ServiceError.validation(errors);

  const existingById = new Map(checklist.items.map((i) => [i.id, i]));
  const keptIds = new Set(rows.map((r) => r.id).filter((v): v is string => !!v));
  // Catalogue rows are never removed; HR-added rows may be.
  const removable = checklist.items.filter((i) => i.custom && !keptIds.has(i.id));

  const correlationId = newCorrelationId();
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    for (const r of removable) {
      // A removed HR-added row is history: the revision log keeps it, and
      // the row itself is marked not applicable rather than deleted (the
      // runtime role holds no DELETE).
      await tx.returnItemsChecklistEntry.update({
        where: { id: r.id },
        data: {
          status: 'NOT_APPLICABLE',
          remarks: 'Row removed by HR',
          label: `${r.label} (removed)`,
        },
      });
    }
    let sortOrder = 0;
    for (const r of rows) {
      const data = {
        label: r.label.trim(),
        status: r.status,
        remarks: r.remarks?.trim() || null,
        quantity: r.quantity ?? null,
        condition: r.condition?.trim() || null,
        returnedAt: r.returnedAt ? new Date(`${r.returnedAt}T12:00:00.000Z`) : null,
        assetReference: r.assetReference?.trim() || null,
        sortOrder: sortOrder++,
      };
      if (r.id && existingById.has(r.id)) {
        const existing = existingById.get(r.id)!;
        await tx.returnItemsChecklistEntry.update({
          where: { id: r.id },
          // The printed form's own labels are not renamed.
          data: existing.itemKey ? { ...data, label: existing.label } : data,
        });
      } else {
        await tx.returnItemsChecklistEntry.create({
          data: { checklistId: checklist.id, itemKey: null, custom: true, ...data },
        });
      }
    }
    const items = await tx.returnItemsChecklistEntry.findMany({
      where: { checklistId: checklist.id },
      orderBy: { sortOrder: 'asc' },
    });
    const hrNotes = input.hrNotes === undefined ? checklist.hrNotes : input.hrNotes?.trim() || null;
    const receivedByName =
      input.receivedByName === undefined
        ? checklist.receivedByName
        : input.receivedByName?.trim() || null;
    const receivedAt =
      input.receivedAt === undefined
        ? checklist.receivedAt
        : input.receivedAt
          ? new Date(`${input.receivedAt}T12:00:00.000Z`)
          : null;
    const updated = await tx.returnItemsChecklist.updateMany({
      where: { id: checklist.id, rowVersion: checklist.rowVersion },
      data: {
        status: deriveChecklistStatus(items, checklist.submittedAt != null),
        hrNotes,
        receivedByName,
        receivedAt,
        // An edit reopens a receipt marked ready for signature.
        lifecycle: 'DRAFT',
        rowVersion: { increment: 1 },
      },
    });
    if (updated.count === 0)
      throw ServiceError.conflict('The checklist changed; reload and retry.');
    const rev = await recordRevisionTx(tx, {
      caseId,
      documentKind: 'ASSET_RECEIPT',
      documentId: checklist.id,
      kind: 'EDITED',
      content: receiptContent({ hrNotes, receivedByName, receivedAt, items }),
      editedById: actor.userId,
    });
    await appendAudit(tx, {
      eventType: 'RETURN_CHECKLIST_EDITED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'ReturnItemsChecklist',
      objectId: checklist.id,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        version: checklist.version,
        revision: rev.revision,
        rows: items.length,
        rowsAdded: rows.filter((r) => !r.id).length,
        rowsRemoved: removable.length,
        notesChanged: hrNotes !== checklist.hrNotes,
        unresolvedCount: unresolvedItems(items).length,
      },
    });
  });
  return { at: now };
}

/** Mark the receipt reviewed and ready for signature or finalization. */
export async function markReceiptReady(actor: Actor, caseId: string): Promise<void> {
  const { checklist } = await loadForEdit(actor, caseId);
  if (checklist.lifecycle !== 'DRAFT')
    throw ServiceError.conflict('Only a draft checklist can be marked ready.');
  await getPrisma().returnItemsChecklist.updateMany({
    where: { id: checklist.id, rowVersion: checklist.rowVersion },
    data: { lifecycle: 'READY', rowVersion: { increment: 1 } },
  });
}

/** The sheet as the renderer and the signing page present it. */
async function renderInputFor(
  checklistId: string,
  draft: boolean,
): Promise<ReturnItemsRenderInput> {
  const prisma = getPrisma();
  const r = await prisma.returnItemsChecklist.findUniqueOrThrow({
    where: { id: checklistId },
    include: {
      items: { orderBy: { sortOrder: 'asc' } },
      case: {
        select: {
          caseNumber: true,
          employeeDisplayName: true,
          departureType: true,
          confirmedLastDay: true,
          effectiveSeparationAt: true,
        },
      },
    },
  });
  const { signatureSummaryFor, readVerifiedSignature } = await import('./signatureService.ts');
  const summary = await signatureSummaryFor('ASSET_RECEIPT', checklistId);
  const signatures = await Promise.all(
    summary.applied.map(async (s) => ({
      blockLabel: s.blockLabel,
      signerName: s.signerName,
      signerRole: SIGNER_ROLE_LABELS[s.signerRole],
      signatureType: s.signatureType,
      provenance: s.provenance,
      signedAt: s.signedAt,
      bytes: await readVerifiedSignature(s),
      width: s.width,
      height: s.height,
    })),
  );
  const dateOfExit = r.case.confirmedLastDay ?? r.case.effectiveSeparationAt;
  return {
    draft,
    caseReference: r.case.caseNumber,
    version: r.version,
    employeeName: r.case.employeeDisplayName,
    reasonForExit: r.case.departureType.toLowerCase().replace(/_/g, ' '),
    dateOfExit: dateOfExit ? dateOfExit.toISOString().slice(0, 10) : '-',
    rows: r.items.map((i, index) => ({
      number: index + 1,
      label: i.label,
      group: i.itemKey?.startsWith('KEYS_') ? ('KEYS' as const) : null,
      status: RETURN_ITEM_STATUS_LABEL[i.status as ReturnItemStatus] ?? i.status,
      remarks: i.remarks,
      quantity: i.quantity,
      condition: i.condition,
      returnedAt: i.returnedAt ? i.returnedAt.toISOString().slice(0, 10) : null,
      assetReference: i.assetReference,
    })),
    receivedByName: r.receivedByName,
    receivedAt: r.receivedAt ? r.receivedAt.toISOString().slice(0, 10) : null,
    submittedByName: r.submittedByName,
    employeeAcknowledgedBy: r.employeeAcknowledgedBy,
    hrNotes: r.hrNotes,
    outstanding: unresolvedItems(r.items).map((i) => i.label),
    signatures,
    renderedAt: r.finalizedAt ?? r.updatedAt,
  };
}

/** The current saved receipt as a PDF, marked draft until final. */
export async function previewReturnItemsPdf(actor: Actor, caseId: string) {
  const { ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'asset.view', ctx)) throw ServiceError.forbidden();
  const checklist = await liveChecklist(getPrisma(), caseId);
  if (!checklist) throw ServiceError.notFound();
  if (checklist.lifecycle === 'FINAL' && checklist.pdfObjectKey && checklist.pdfChecksum) {
    const { readVerifiedPdf } = await import('./renderService.ts');
    const bytes = await readVerifiedPdf(checklist.pdfObjectKey, checklist.pdfChecksum);
    return { bytes, fileName: `exit-checklist-v${checklist.version}.pdf`, draft: false };
  }
  const bytes = await renderReturnItemsPdfBytes(await renderInputFor(checklist.id, true));
  await appendAudit(getPrisma(), {
    eventType: 'DOC_DOWNLOADED',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'ReturnItemsChecklist',
    objectId: checklist.id,
    caseId,
    result: 'SUCCESS',
    correlationId: newCorrelationId(),
    metadata: { version: checklist.version, preview: true },
  });
  return { bytes, fileName: `exit-checklist-v${checklist.version}-draft.pdf`, draft: true };
}

/**
 * Finalize the receipt: lock it, render and store its PDF with the marks on
 * it. Completion is not blocked on signatures - the officer sees what is
 * still open before choosing to finalize, as with the action form.
 */
export async function finalizeReturnItemsChecklist(actor: Actor, caseId: string) {
  const { checklist } = await loadForEdit(actor, caseId);
  if (checklist.lifecycle === 'FINAL')
    throw ServiceError.conflict('This checklist is already final.');
  const prisma = getPrisma();
  const pending = await prisma.signatureRequest.count({
    where: { checklistId: checklist.id, status: 'PENDING' },
  });
  const now = new Date();
  const correlationId = newCorrelationId();
  const pdf = await renderReturnItemsPdf({
    ...(await renderInputFor(checklist.id, false)),
    renderedAt: now,
  });
  await prisma.$transaction(async (tx) => {
    const u = await tx.returnItemsChecklist.updateMany({
      where: { id: checklist.id, rowVersion: checklist.rowVersion },
      data: {
        lifecycle: 'FINAL',
        finalizedById: actor.userId,
        finalizedAt: now,
        pdfObjectKey: pdf.objectKey,
        pdfChecksum: pdf.checksum,
        rowVersion: { increment: 1 },
      },
    });
    if (u.count === 0) throw ServiceError.conflict('The checklist changed; reload and retry.');
    await recordRevisionTx(tx, {
      caseId,
      documentKind: 'ASSET_RECEIPT',
      documentId: checklist.id,
      kind: 'FINALIZED',
      content: receiptContent(checklist),
      editedById: actor.userId,
      note: pending > 0 ? `Finalized with ${pending} signature request(s) still open` : null,
    });
    await appendAudit(tx, {
      eventType: 'RETURN_CHECKLIST_FINALIZED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'ReturnItemsChecklist',
      objectId: checklist.id,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        version: checklist.version,
        checksum: pdf.checksum,
        openSignatureRequests: pending,
      },
    });
  });
  return { checksum: pdf.checksum };
}

/**
 * Directive section 5: a material change after signing means a NEW version.
 * The signed version is superseded and kept, its open requests are revoked,
 * and the new version starts from the same rows and notes - never from the
 * old signatures.
 */
export async function startNewReceiptVersion(actor: Actor, caseId: string, reason: string) {
  const { checklist } = await loadForEdit(actor, caseId);
  if (!reason.trim()) throw ServiceError.validation(['Give the reason for the new version.']);
  const prisma = getPrisma();
  const correlationId = newCorrelationId();
  const now = new Date();
  const { revokeRequestsForDocumentTx } = await import('./signatureService.ts');
  return prisma.$transaction(async (tx) => {
    const u = await tx.returnItemsChecklist.updateMany({
      where: { id: checklist.id, rowVersion: checklist.rowVersion },
      data: {
        lifecycle: 'SUPERSEDED',
        supersededReason: reason.trim().slice(0, 300),
        rowVersion: { increment: 1 },
      },
    });
    if (u.count === 0) throw ServiceError.conflict('The checklist changed; reload and retry.');
    await revokeRequestsForDocumentTx(
      tx,
      'ASSET_RECEIPT',
      checklist.id,
      caseId,
      `Superseded by a new version: ${reason.trim()}`.slice(0, 300),
    );
    const next = await tx.returnItemsChecklist.create({
      data: {
        caseId,
        version: checklist.version + 1,
        lifecycle: 'DRAFT',
        status: checklist.status,
        hrNotes: checklist.hrNotes,
        sentAt: checklist.sentAt,
        sentToName: checklist.sentToName,
        sentToMask: checklist.sentToMask,
        submittedAt: checklist.submittedAt,
        submittedByName: checklist.submittedByName,
        submittedByUserId: checklist.submittedByUserId,
        receivedByName: checklist.receivedByName,
        receivedAt: checklist.receivedAt,
        // Acknowledgement is what the old signature stood for: it does not
        // carry to content the signer has not seen.
        employeeAcknowledgedAt: null,
        employeeAcknowledgedBy: null,
        createdById: actor.userId,
        items: {
          create: checklist.items.map((i) => ({
            itemKey: i.itemKey,
            label: i.label,
            sortOrder: i.sortOrder,
            status: i.status,
            remarks: i.remarks,
            quantity: i.quantity,
            condition: i.condition,
            returnedAt: i.returnedAt,
            assetReference: i.assetReference,
            custom: i.custom,
          })),
        },
      },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    });
    await recordRevisionTx(tx, {
      caseId,
      documentKind: 'ASSET_RECEIPT',
      documentId: checklist.id,
      kind: 'SUPERSEDED',
      content: receiptContent(checklist),
      editedById: actor.userId,
      note: `Superseded by version ${next.version}: ${reason.trim()}`,
    });
    await recordRevisionTx(tx, {
      caseId,
      documentKind: 'ASSET_RECEIPT',
      documentId: next.id,
      kind: 'GENERATED',
      content: receiptContent(next),
      editedById: actor.userId,
      note: `Started from version ${checklist.version}`,
    });
    await appendAudit(tx, {
      eventType: 'RETURN_CHECKLIST_SUPERSEDED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'ReturnItemsChecklist',
      objectId: checklist.id,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        version: checklist.version,
        replacementVersion: next.version,
        reason: reason.trim(),
      },
    });
    return { id: next.id, version: next.version, at: now };
  });
}
