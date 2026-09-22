/**
 * Document instance workflow (Directive 2 sections C-E; DEC-066).
 *
 * The HR Manager approves the CASE once. The HR person executing the
 * approved case then finalizes each document in one attested, checksum-bound
 * step - there is no per-document manager approval. Deterministic idempotent
 * rendering; strict no-hard-delete; restricted-case inheritance.
 */
import {
  buildFieldSnapshot,
  canActOnCase,
  contentChecksum,
  docTransitionError,
  documentValidationErrors,
  executionBlockedReason,
  hasMissingMarkers,
  hasRole,
  isoDateInZone,
  letterTypeForDeparture,
  maskDestination,
  substitute,
  DOWNLOADABLE_DOC_STATUSES,
  EDITABLE_DOC_STATUSES,
  LIVE_DOC_STATUSES,
  type Actor,
  type DocumentFieldSnapshot,
  type DocumentType,
} from '@exit/domain';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, auditDenied, newCorrelationId } from './auditService.ts';
import { renderLetterPdf, readVerifiedPdf } from './renderService.ts';
import { assertFeatureAllowed, assertFullView, loadCaseAccess } from './shared.ts';

const LETTER_TITLES: Partial<Record<DocumentType, string>> = {
  RESIGNATION_ACCEPTANCE_WITH_NOTICE: 'Acknowledgement and Acceptance of Resignation',
  IMMEDIATE_RESIGNATION_ACKNOWLEDGEMENT: 'Acknowledgement of Immediate Resignation',
};

async function snapshotForCase(caseId: string, documentVersion: number, templateVersion: number) {
  const c = await getPrisma().offboardingCase.findUniqueOrThrow({ where: { id: caseId } });
  return buildFieldSnapshot(
    {
      caseNumber: c.caseNumber,
      departureType: c.departureType,
      employeeDisplayName: c.employeeDisplayName,
      employeeLegalName: c.employeeDisplayName,
      employeeSourceId: c.employeeSourceId,
      employeeNumber: c.employeeNumber,
      jobTitle: c.jobTitle,
      department: c.department,
      location: c.location,
      managerName: c.managerName,
      employeeAddress: c.employeeAddress,
      receivedAt: c.receivedAt,
      proposedLastDay: c.proposedLastDay,
      confirmedLastDay: c.confirmedLastDay,
      effectiveSeparationAt: c.effectiveSeparationAt,
    },
    new Date(),
    documentVersion,
    templateVersion,
  );
}

// --- creation ----------------------------------------------------------------

export async function createLetterDraft(actor: Actor, caseId: string) {
  const { c, ctx } = await loadCaseAccess(actor, caseId);
  assertFullView(actor, ctx);
  if (!canActOnCase(actor, 'doc.create', ctx)) {
    await auditDenied(actor, 'ACCESS_DENIED', 'DocumentInstance', 'create', caseId);
    throw ServiceError.forbidden();
  }
  const type = letterTypeForDeparture(c.departureType);
  if (!type)
    throw ServiceError.validation([
      'No operational letter exists for this departure type (termination letters are out of scope in this increment).',
    ]);
  await assertFeatureAllowed(c, 'automation.letterGeneration');

  const prisma = getPrisma();
  const template = await prisma.documentTemplate.findFirst({
    where: { documentType: type, status: 'ACTIVE' },
  });
  if (!template)
    throw ServiceError.validation([`No ACTIVE template exists for ${type}; activate one first.`]);

  const live = await prisma.documentInstance.findFirst({
    where: { caseId, documentType: type, status: { in: [...LIVE_DOC_STATUSES] } },
  });
  if (live)
    throw ServiceError.conflict(
      `A live ${type} document already exists (version ${live.version}, ${live.status}).`,
    );

  const latest = await prisma.documentInstance.findFirst({
    where: { caseId, documentType: type },
    orderBy: { version: 'desc' },
  });
  const version = (latest?.version ?? 0) + 1;
  const fieldSnapshot = await snapshotForCase(caseId, version, template.version);

  const correlationId = newCorrelationId();
  return prisma.$transaction(async (tx) => {
    const d = await tx.documentInstance.create({
      data: {
        caseId,
        documentType: type,
        templateId: template.id,
        templateVersion: template.version,
        version,
        status: 'DRAFT',
        fieldSnapshot: fieldSnapshot as object,
        createdById: actor.userId,
      },
    });
    await appendAudit(tx, {
      eventType: 'DOC_CREATED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'DocumentInstance',
      objectId: d.id,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { documentType: type, documentVersion: version, templateVersion: template.version },
    });
    return d;
  });
}

export async function createManualExceptionDraft(
  actor: Actor,
  caseId: string,
  input: { reason: string; attachmentId: string },
) {
  const { c, ctx } = await loadCaseAccess(actor, caseId);
  assertFullView(actor, ctx);
  if (!canActOnCase(actor, 'doc.create', ctx)) throw ServiceError.forbidden();
  if (!input.reason.trim() || input.reason.length > 500)
    throw ServiceError.validation(['An exception reason of 1-500 characters is required.']);
  await assertFeatureAllowed(c, 'automation.letterGeneration');

  const prisma = getPrisma();
  const attachment = await prisma.attachment.findUnique({ where: { id: input.attachmentId } });
  if (!attachment || attachment.caseId !== caseId)
    throw ServiceError.validation(['The uploaded exception document was not found on this case.']);

  const live = await prisma.documentInstance.findFirst({
    where: {
      caseId,
      documentType: 'MANUAL_EXCEPTION_DOCUMENT',
      status: { in: [...LIVE_DOC_STATUSES] },
    },
  });
  if (live) throw ServiceError.conflict('A live manual-exception document already exists.');
  const latest = await prisma.documentInstance.findFirst({
    where: { caseId, documentType: 'MANUAL_EXCEPTION_DOCUMENT' },
    orderBy: { version: 'desc' },
  });

  const correlationId = newCorrelationId();
  return prisma.$transaction(async (tx) => {
    const d = await tx.documentInstance.create({
      data: {
        caseId,
        documentType: 'MANUAL_EXCEPTION_DOCUMENT',
        version: (latest?.version ?? 0) + 1,
        status: 'DRAFT',
        fieldSnapshot: { CASE_REFERENCE: c.caseNumber } as object,
        exceptionAttachmentId: input.attachmentId,
        exceptionReason: input.reason.trim(),
        createdById: actor.userId,
      },
    });
    await appendAudit(tx, {
      eventType: 'DOC_CREATED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'DocumentInstance',
      objectId: d.id,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { documentType: 'MANUAL_EXCEPTION_DOCUMENT', documentVersion: d.version },
    });
    return d;
  });
}

// --- read --------------------------------------------------------------------

async function loadDoc(actor: Actor, docId: string) {
  const d = await getPrisma().documentInstance.findUnique({
    where: { id: docId },
    include: { template: { select: { name: true, contentBody: true, version: true } } },
  });
  if (!d) throw ServiceError.notFound();
  const { c, ctx } = await loadCaseAccess(actor, d.caseId);
  assertFullView(actor, ctx);
  return { d, c, ctx };
}

export async function getCaseDocuments(actor: Actor, caseId: string) {
  const { ctx } = await loadCaseAccess(actor, caseId);
  assertFullView(actor, ctx);
  const docs = await getPrisma().documentInstance.findMany({
    where: { caseId },
    orderBy: [{ documentType: 'asc' }, { version: 'desc' }],
    // The template body lets the page show a draft's content BEFORE it is
    // finalized (DEC-066: the officer reviews, then finalizes).
    include: { template: { select: { name: true, contentBody: true } } },
  });
  const attestations = await getPrisma().attestation.findMany({
    where: { subjectType: 'DOCUMENT', subjectId: { in: docs.map((x) => x.id) } },
  });
  // DEC-054: what the page needs to address and send the letter. The
  // employee's address is shown to HR because HR typed it; the email is
  // masked because nothing on a page needs the whole address.
  const c = await getPrisma().offboardingCase.findUniqueOrThrow({
    where: { id: caseId },
    select: { employeeAddress: true, employeeWorkEmail: true, status: true },
  });
  return {
    docs,
    attestations,
    delivery: {
      employeeAddress: c.employeeAddress,
      employeeEmailMask: c.employeeWorkEmail ? maskDestination(c.employeeWorkEmail) : null,
    },
    /**
     * DEC-066: finalizing and issuing are gated on the CASE approval being in
     * force, not on a second document approval. Null means execution is
     * authorized; otherwise the sentence the page shows instead of the
     * finalize and send controls.
     */
    executionBlockedReason: executionBlockedReason(c.status),
    capabilities: {
      canCreate: canActOnCase(actor, 'doc.create', ctx),
      canFinalize: canActOnCase(actor, 'doc.finalize', ctx),
      canDownload: canActOnCase(actor, 'doc.download', ctx),
      canEdit: canActOnCase(actor, 'doc.edit', ctx),
      canIssue: canActOnCase(actor, 'doc.markIssued', ctx),
      canSupersede: canActOnCase(actor, 'doc.supersede', ctx),
      canVoid: canActOnCase(actor, 'doc.void', ctx),
    },
  };
}

/** Preview body: substituted content with the signatory placeholders labelled. */
export function previewContent(
  templateBody: string,
  fieldSnapshot: DocumentFieldSnapshot,
  approver?: { name: string; title: string },
): string {
  const snap: DocumentFieldSnapshot = {
    ...fieldSnapshot,
    HR_APPROVER_NAME: approver?.name ?? '(signatory name - completed when finalized)',
    HR_APPROVER_TITLE: approver?.title ?? '(signatory title - completed when finalized)',
  };
  return substitute(templateBody, snap);
}

export async function getDocumentForView(actor: Actor, docId: string) {
  const { d, ctx } = await loadDoc(actor, docId);
  const attestations = await getPrisma().attestation.findMany({
    where: { subjectType: 'DOCUMENT', subjectId: d.id },
    orderBy: { createdAt: 'asc' },
  });
  return {
    doc: d,
    attestations,
    preview:
      d.contentSnapshot ??
      (d.template
        ? previewContent(d.template.contentBody, d.fieldSnapshot as DocumentFieldSnapshot)
        : null),
    capabilities: {
      canEdit: canActOnCase(actor, 'doc.edit', ctx),
      canFinalize: canActOnCase(actor, 'doc.finalize', ctx),
      canVoid: canActOnCase(actor, 'doc.void', ctx),
      canMarkIssued: canActOnCase(actor, 'doc.markIssued', ctx),
      canSupersede: canActOnCase(actor, 'doc.supersede', ctx),
      canDownload: canActOnCase(actor, 'doc.download', ctx),
    },
  };
}

// --- edit / refresh ----------------------------------------------------------

/** Editing a draft re-captures the field snapshot from the CURRENT case data. */
export async function refreshDraftFields(actor: Actor, docId: string) {
  const { d, ctx } = await loadDoc(actor, docId);
  if (!canActOnCase(actor, 'doc.edit', ctx)) throw ServiceError.forbidden();
  if (!EDITABLE_DOC_STATUSES.includes(d.status as never))
    throw ServiceError.conflict('Only draft documents can be edited.');
  if (d.documentType === 'MANUAL_EXCEPTION_DOCUMENT')
    throw ServiceError.conflict('Manual-exception documents have no generated fields.');

  const fieldSnapshot = await snapshotForCase(d.caseId, d.version, d.templateVersion ?? 0);
  const correlationId = newCorrelationId();
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const updated = await tx.documentInstance.update({
      where: { id: docId },
      data: {
        fieldSnapshot: fieldSnapshot as object,
        status: 'DRAFT',
        validationErrors: undefined,
        outdatedReason: null,
        rowVersion: { increment: 1 },
      },
    });
    await appendAudit(tx, {
      eventType: 'DOC_UPDATED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'DocumentInstance',
      objectId: docId,
      caseId: d.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        documentType: d.documentType,
        documentVersion: d.version,
        action: 'fields-refreshed',
      },
    });
    return updated;
  });
}

// --- transitions -------------------------------------------------------------

export async function voidDocument(actor: Actor, docId: string, reason: string) {
  const { d, ctx } = await loadDoc(actor, docId);
  if (!canActOnCase(actor, 'doc.void', ctx)) throw ServiceError.forbidden();
  const guard = docTransitionError('void', d.status, reason);
  if (guard) throw ServiceError.validation([guard]);
  const correlationId = newCorrelationId();
  await getPrisma().$transaction(async (tx) => {
    const u = await tx.documentInstance.updateMany({
      where: { id: docId, rowVersion: d.rowVersion },
      data: { status: 'VOIDED', voidReason: reason.trim(), rowVersion: { increment: 1 } },
    });
    if (u.count === 0) throw ServiceError.conflict('The document changed; reload and retry.');
    await appendAudit(tx, {
      eventType: 'DOC_VOIDED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'DocumentInstance',
      objectId: docId,
      caseId: d.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { documentType: d.documentType, documentVersion: d.version, reason },
    });
  });
}

/**
 * DEC-066: the case approval is the only management authorization a document
 * needs. Who approved the case, and when, travels with every finalization so
 * the attestation says under whose authority the document was released.
 */
async function caseApprovalAuthority(caseId: string): Promise<{
  approvedById: string;
  approvedAt: Date;
} | null> {
  const row = await getPrisma().caseStatusHistory.findFirst({
    where: { caseId, toStatus: 'APPROVED' },
    orderBy: { occurredAt: 'desc' },
    select: { actorId: true, occurredAt: true },
  });
  return row ? { approvedById: row.actorId, approvedAt: row.occurredAt } : null;
}

/**
 * Validate, attest and release a document for rendering in ONE step (owner
 * directive 2026-09-22, DEC-066). The HR Manager approved the case; the HR
 * person executing it - the assigned HR Officer, or the HR Manager stepping
 * in - finalizes the document. No second, per-document manager approval.
 *
 * The gate that matters is the CASE: nothing finalizes while the case is a
 * draft, awaiting approval, on hold or closed. Validation is unchanged from
 * the retired submit step (placeholders, date order, changed-case data),
 * because those checks protect the employee, not a management signature.
 */
export async function finalizeDocument(actor: Actor, docId: string) {
  const { d, c, ctx } = await loadDoc(actor, docId);
  if (!canActOnCase(actor, 'doc.finalize', ctx)) {
    await auditDenied(actor, 'ACCESS_DENIED', 'DocumentInstance', docId, d.caseId);
    throw ServiceError.forbidden();
  }
  const blocked = executionBlockedReason(c.status);
  if (blocked) throw ServiceError.validation([blocked]);
  const guard = docTransitionError('finalize', d.status);
  if (guard) throw ServiceError.validation([guard]);

  const authority = await caseApprovalAuthority(d.caseId);
  if (!authority)
    throw ServiceError.conflict('No case approval is recorded; the case must be approved first.');

  const prisma = getPrisma();
  const finalizer = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  const finalizerTitle = hasRole(actor, 'HR_MANAGER') ? 'HR Manager' : 'HR Officer';
  const correlationId = newCorrelationId();
  const now = new Date();

  let finalContent: string | null = null;
  let checksum: string;
  let fieldSnapshot: object = d.fieldSnapshot as object;

  if (d.documentType === 'MANUAL_EXCEPTION_DOCUMENT') {
    if (!d.exceptionAttachmentId)
      throw ServiceError.validation(['The exception document upload is missing.']);
    const att = await prisma.attachment.findUniqueOrThrow({
      where: { id: d.exceptionAttachmentId },
    });
    checksum = att.checksum;
  } else {
    if (!d.template) throw ServiceError.conflict('Template missing for this document.');
    const snapshot = d.fieldSnapshot as DocumentFieldSnapshot;
    const errors = documentValidationErrors(d.documentType, d.template.contentBody, snapshot);
    // Date-order check from live case values (C.5): confirmed >= received,
    // compared as CALENDAR DAYS in the business zone. The last working day is a
    // date-only column (midnight UTC) and the received value is an instant, so
    // comparing them raw called the platform's own defaults for an immediate
    // resignation - received today, last day today - an error (found by the
    // offboarding regression suite, 2026-09-09).
    if (
      c.confirmedLastDay &&
      c.receivedAt &&
      c.confirmedLastDay.toISOString().slice(0, 10) < isoDateInZone(c.receivedAt)
    )
      errors.push('Confirmed last working date is before the resignation received date.');
    // Changed-case-data check (C.5): re-derive and compare material values.
    // This is the officer-executes-what-was-approved safeguard for letters:
    // a draft captured before a correction cannot be finalized against it.
    const fresh = await snapshotForCase(d.caseId, d.version, d.templateVersion ?? 0);
    for (const key of [
      'EMPLOYEE_LEGAL_NAME',
      'RESIGNATION_RECEIVED_DATE',
      'CONFIRMED_LAST_WORKING_DATE',
      'EFFECTIVE_SEPARATION_DATE',
      'EFFECTIVE_SEPARATION_TIME',
    ] as const) {
      if ((snapshot[key] ?? '') !== (fresh[key] ?? ''))
        errors.push(
          `Case data changed since this draft captured ${key}; edit the draft to refresh fields.`,
        );
    }
    if (errors.length) {
      await prisma.$transaction(async (tx) => {
        await tx.documentInstance.updateMany({
          where: { id: docId, rowVersion: d.rowVersion },
          data: {
            status: 'VALIDATION_FAILED',
            validationErrors: errors,
            rowVersion: { increment: 1 },
          },
        });
        await appendAudit(tx, {
          eventType: 'DOC_VALIDATION_FAILED',
          actorType: 'USER',
          actorId: actor.userId,
          effectiveRoles: actor.roles,
          objectType: 'DocumentInstance',
          objectId: docId,
          caseId: d.caseId,
          result: 'FAILURE',
          correlationId,
          metadata: {
            documentType: d.documentType,
            documentVersion: d.version,
            errorCount: errors.length,
          },
        });
      });
      throw ServiceError.validation(errors);
    }
    const signed = {
      ...snapshot,
      HR_APPROVER_NAME: finalizer.displayName,
      HR_APPROVER_TITLE: finalizerTitle,
    };
    finalContent = substitute(d.template.contentBody, signed);
    if (hasMissingMarkers(finalContent))
      throw ServiceError.validation([
        'The document still contains unresolved fields; refresh the draft from the case and try again.',
      ]);
    checksum = contentChecksum(finalContent);
    fieldSnapshot = signed;
  }

  await prisma.$transaction(async (tx) => {
    const u = await tx.documentInstance.updateMany({
      where: { id: docId, rowVersion: d.rowVersion },
      data: {
        status: 'APPROVED',
        contentSnapshot: finalContent ?? undefined,
        contentChecksum: checksum,
        fieldSnapshot,
        validationErrors: undefined,
        submittedAt: now,
        submittedById: actor.userId,
        approvedAt: now,
        rowVersion: { increment: 1 },
      },
    });
    if (u.count === 0)
      throw ServiceError.conflict('The document was changed or already decided; reload and retry.');
    await tx.attestation.create({
      data: {
        subjectType: 'DOCUMENT',
        subjectId: docId,
        subjectVersion: d.version,
        kind: 'HR_DOCUMENT_FINALIZATION',
        caseId: d.caseId,
        actorId: actor.userId,
        actorDisplayName: finalizer.displayName,
        actorRole: finalizerTitle,
        meaning:
          'I confirm this exact document version and content for release as the final employee-facing document, under the HR Manager approval of this case.',
        contentChecksum: checksum,
        correlationId,
      },
    });
    await appendAudit(tx, {
      eventType: 'DOC_FINALIZED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'DocumentInstance',
      objectId: docId,
      caseId: d.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        documentType: d.documentType,
        documentVersion: d.version,
        checksum,
        authority: 'CASE_APPROVAL',
        caseApprovedById: authority.approvedById,
        caseApprovedAt: authority.approvedAt.toISOString(),
        caseStatus: c.status,
      },
    });
  });

  // Finalization invokes rendering (D.9); failures fall to the worker retry job.
  await renderApprovedDocument(docId, correlationId);
}

/** Idempotent render of an approved document (called inline and by the worker). */
export async function renderApprovedDocument(docId: string, correlationId: string): Promise<void> {
  const prisma = getPrisma();
  const d = await prisma.documentInstance.findUnique({ where: { id: docId } });
  if (!d) return;
  if (['RENDERED', 'MANUALLY_ISSUED', 'SUPERSEDED', 'VOIDED'].includes(d.status)) return; // idempotent

  if (d.documentType === 'MANUAL_EXCEPTION_DOCUMENT') {
    await prisma.documentInstance.updateMany({
      where: { id: docId, status: 'APPROVED' },
      data: { status: 'RENDERED', renderedAt: new Date(), rowVersion: { increment: 1 } },
    });
    return;
  }

  const claimed = await prisma.documentInstance.updateMany({
    where: { id: docId, status: { in: ['APPROVED', 'RENDER_FAILED'] } },
    data: { status: 'RENDERING', rowVersion: { increment: 1 } },
  });
  if (claimed.count === 0) return;

  try {
    const snap = d.fieldSnapshot as DocumentFieldSnapshot;
    const pdf = await renderLetterPdf({
      title: LETTER_TITLES[d.documentType] ?? 'Controlled Document',
      confidentiality: 'Confidential - HR controlled document',
      caseReference: snap.CASE_REFERENCE ?? '',
      documentReference: `DOC-${d.version}`,
      templateVersion: snap.TEMPLATE_VERSION ?? `v${d.templateVersion}`,
      documentVersion: snap.DOCUMENT_VERSION ?? `v${d.version}`,
      bodyText: d.contentSnapshot ?? '',
      approverName: snap.HR_APPROVER_NAME ?? '',
      approverTitle: snap.HR_APPROVER_TITLE ?? '',
      approvedAt: d.approvedAt ?? new Date(),
      attestationNote:
        'This is an authenticated application attestation, not a qualified or advanced electronic signature.',
    });
    await prisma.$transaction(async (tx) => {
      await tx.documentInstance.updateMany({
        where: { id: docId, status: 'RENDERING' },
        data: {
          status: 'RENDERED',
          pdfObjectKey: pdf.objectKey,
          pdfChecksum: pdf.checksum,
          renderedAt: new Date(),
          renderError: null,
          rowVersion: { increment: 1 },
        },
      });
      await appendAudit(tx, {
        eventType: 'DOC_RENDERED',
        actorType: 'SYSTEM',
        objectType: 'DocumentInstance',
        objectId: docId,
        caseId: d.caseId,
        result: 'SUCCESS',
        correlationId,
        metadata: {
          documentType: d.documentType,
          documentVersion: d.version,
          bytes: pdf.byteLength,
        },
      });
    });
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 300) : 'render failed';
    await prisma.$transaction(async (tx) => {
      await tx.documentInstance.updateMany({
        where: { id: docId, status: 'RENDERING' },
        data: {
          status: 'RENDER_FAILED',
          renderError: message,
          renderAttempts: { increment: 1 },
          rowVersion: { increment: 1 },
        },
      });
      await tx.renderJob.create({
        data: { subjectType: 'DOCUMENT', subjectId: docId, status: 'QUEUED', correlationId },
      });
      await appendAudit(tx, {
        eventType: 'DOC_RENDER_FAILED',
        actorType: 'SYSTEM',
        objectType: 'DocumentInstance',
        objectId: docId,
        caseId: d.caseId,
        result: 'FAILURE',
        correlationId,
        metadata: { documentType: d.documentType, documentVersion: d.version },
      });
    });
  }
}

export async function markManuallyIssued(
  actor: Actor,
  docId: string,
  input: {
    method: 'HAND_DELIVERY' | 'REGISTERED_MAIL' | 'OTHER_APPROVED';
    recipientClass: 'EMPLOYEE' | 'AUTHORIZED_REPRESENTATIVE' | 'INTERNAL_RECORD';
    note?: string;
  },
) {
  const { d, c, ctx } = await loadDoc(actor, docId);
  if (!canActOnCase(actor, 'doc.markIssued', ctx)) throw ServiceError.forbidden();
  // DEC-066: issuing executes the approved case; a returned or held case
  // cannot issue anything, whoever is asking.
  const blocked = executionBlockedReason(c.status);
  if (blocked) throw ServiceError.validation([blocked]);
  const guard = docTransitionError('markIssued', d.status);
  if (guard) throw ServiceError.validation([guard]);
  if (input.note && input.note.length > 300)
    throw ServiceError.validation(['Issue note is limited to 300 characters.']);

  const correlationId = newCorrelationId();
  await getPrisma().$transaction(async (tx) => {
    const u = await tx.documentInstance.updateMany({
      where: { id: docId, rowVersion: d.rowVersion, status: 'RENDERED' },
      data: {
        status: 'MANUALLY_ISSUED',
        issuedById: actor.userId,
        issuedAt: new Date(),
        issueMethod: input.method,
        recipientClass: input.recipientClass,
        issueNote: input.note?.trim() || null,
        rowVersion: { increment: 1 },
      },
    });
    if (u.count === 0) throw ServiceError.conflict('The document changed; reload and retry.');
    await appendAudit(tx, {
      eventType: 'DOC_MANUALLY_ISSUED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'DocumentInstance',
      objectId: docId,
      caseId: d.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        documentType: d.documentType,
        documentVersion: d.version,
        issueMethod: input.method,
        recipientClass: input.recipientClass,
      },
    });
  });
}

/** Supersede a final document and open a corrected new version (D.12 path). */
export async function supersedeAndRecreate(actor: Actor, docId: string, reason: string) {
  const { d, ctx } = await loadDoc(actor, docId);
  if (!canActOnCase(actor, 'doc.supersede', ctx)) throw ServiceError.forbidden();
  const guard = docTransitionError('supersede', d.status, reason);
  if (guard) throw ServiceError.validation([guard]);
  if (d.documentType === 'MANUAL_EXCEPTION_DOCUMENT')
    throw ServiceError.validation(['Create a new manual-exception document instead.']);

  const prisma = getPrisma();
  const template = await prisma.documentTemplate.findFirst({
    where: { documentType: d.documentType, status: 'ACTIVE' },
  });
  if (!template) throw ServiceError.conflict('No ACTIVE template available for the replacement.');
  const fieldSnapshot = await snapshotForCase(d.caseId, d.version + 1, template.version);

  const correlationId = newCorrelationId();
  return prisma.$transaction(async (tx) => {
    const u = await tx.documentInstance.updateMany({
      where: { id: docId, rowVersion: d.rowVersion },
      data: { status: 'SUPERSEDED', outdatedReason: reason.trim(), rowVersion: { increment: 1 } },
    });
    if (u.count === 0) throw ServiceError.conflict('The document changed; reload and retry.');
    const replacement = await tx.documentInstance.create({
      data: {
        caseId: d.caseId,
        documentType: d.documentType,
        templateId: template.id,
        templateVersion: template.version,
        version: d.version + 1,
        status: 'DRAFT',
        fieldSnapshot: fieldSnapshot as object,
        createdById: actor.userId,
      },
    });
    await appendAudit(tx, {
      eventType: 'DOC_SUPERSEDED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'DocumentInstance',
      objectId: docId,
      caseId: d.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: {
        documentType: d.documentType,
        documentVersion: d.version,
        reason,
        replacementVersion: replacement.version,
      },
    });
    return replacement;
  });
}

// --- download ----------------------------------------------------------------

export async function downloadDocumentPdf(actor: Actor, docId: string) {
  const { d, ctx } = await loadDoc(actor, docId);
  if (!canActOnCase(actor, 'doc.download', ctx)) {
    await auditDenied(actor, 'ACCESS_DENIED', 'DocumentInstance', docId, d.caseId);
    throw ServiceError.forbidden();
  }
  if (!DOWNLOADABLE_DOC_STATUSES.includes(d.status as never))
    throw ServiceError.conflict('Only rendered final documents can be downloaded.');
  if (!d.pdfObjectKey || !d.pdfChecksum)
    throw ServiceError.conflict(
      'This document has no generated PDF (manual-exception documents use their uploaded file).',
    );

  const bytes = await readVerifiedPdf(d.pdfObjectKey, d.pdfChecksum);
  await appendAudit(getPrisma(), {
    eventType: 'DOC_DOWNLOADED',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'DocumentInstance',
    objectId: docId,
    caseId: d.caseId,
    result: 'SUCCESS',
    correlationId: newCorrelationId(),
    metadata: { documentType: d.documentType, documentVersion: d.version, checksum: d.pdfChecksum },
  });
  const snap = d.fieldSnapshot as DocumentFieldSnapshot;
  return {
    bytes,
    fileName: `${snap.CASE_REFERENCE ?? 'document'}-${d.documentType.toLowerCase()}-v${d.version}.pdf`,
    superseded: d.status === 'SUPERSEDED',
  };
}

// --- material case corrections (D.12) ----------------------------------------

/**
 * Called after a material case correction: unfinalized versions fall back to
 * VALIDATION_FAILED (stale fields), finalized/rendered-but-unissued versions
 * are superseded with their attestations invalidated. Issued documents are
 * never touched. This is the "officer executes what was approved" safeguard
 * for documents (DEC-066 section 32): a corrected case never carries a
 * letter finalized against the old facts.
 */
export async function outdateDocumentsForCaseChange(caseId: string, reason: string): Promise<void> {
  const prisma = getPrisma();
  const correlationId = newCorrelationId();
  const live = await prisma.documentInstance.findMany({
    where: {
      caseId,
      documentType: { not: 'MANUAL_EXCEPTION_DOCUMENT' },
      status: {
        in: [
          'DRAFT',
          'PENDING_APPROVAL',
          'RETURNED',
          'APPROVED',
          'RENDERED',
          'RENDER_FAILED',
          'RENDERING',
        ],
      },
    },
  });
  for (const d of live) {
    await prisma.$transaction(async (tx) => {
      if (['DRAFT', 'PENDING_APPROVAL', 'RETURNED'].includes(d.status)) {
        await tx.documentInstance.update({
          where: { id: d.id },
          data: {
            status: 'VALIDATION_FAILED',
            validationErrors: [`Case data changed: ${reason}. Edit the draft to refresh fields.`],
            outdatedReason: reason,
            rowVersion: { increment: 1 },
          },
        });
      } else {
        await tx.documentInstance.update({
          where: { id: d.id },
          data: { status: 'SUPERSEDED', outdatedReason: reason, rowVersion: { increment: 1 } },
        });
        await tx.attestation.updateMany({
          where: { subjectType: 'DOCUMENT', subjectId: d.id, invalidatedAt: null },
          data: {
            invalidatedAt: new Date(),
            invalidatedReason: `Material case correction: ${reason}`,
          },
        });
        // D.12: the correction opens a fresh version; the original document
        // and its (invalidated) approval are preserved untouched.
        const template = await tx.documentTemplate.findFirst({
          where: { documentType: d.documentType, status: 'ACTIVE' },
        });
        if (template) {
          const fieldSnapshot = await snapshotForCase(caseId, d.version + 1, template.version);
          await tx.documentInstance.create({
            data: {
              caseId,
              documentType: d.documentType,
              templateId: template.id,
              templateVersion: template.version,
              version: d.version + 1,
              status: 'DRAFT',
              fieldSnapshot: fieldSnapshot as object,
              createdById: d.createdById,
            },
          });
        }
        await appendAudit(tx, {
          eventType: 'DOC_APPROVAL_INVALIDATED',
          actorType: 'SYSTEM',
          objectType: 'DocumentInstance',
          objectId: d.id,
          caseId,
          result: 'SUCCESS',
          correlationId,
          metadata: { documentType: d.documentType, documentVersion: d.version, reason },
        });
      }
    });
  }
}
