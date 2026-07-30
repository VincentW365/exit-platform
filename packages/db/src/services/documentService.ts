/**
 * Document instance workflow (Directive 2 sections C-E).
 * Maker-checker with checksum-bound attestations; deterministic idempotent
 * rendering; strict no-hard-delete; restricted-case inheritance.
 */
import {
  buildFieldSnapshot,
  canActOnCase,
  contentChecksum,
  docTransitionError,
  documentValidationErrors,
  hasMissingMarkers,
  letterTypeForDeparture,
  substitute,
  DOWNLOADABLE_DOC_STATUSES,
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

async function managerNameForCase(caseId: string): Promise<string | null> {
  const row = await getPrisma().caseParticipant.findFirst({
    where: { caseId, participantRole: 'MANAGER', removedAt: null },
    include: { user: { select: { displayName: true } } },
  });
  return row?.user.displayName ?? null;
}

async function snapshotForCase(caseId: string, documentVersion: number, templateVersion: number) {
  const c = await getPrisma().offboardingCase.findUniqueOrThrow({ where: { id: caseId } });
  return buildFieldSnapshot(
    {
      caseNumber: c.caseNumber,
      departureType: c.departureType,
      employeeDisplayName: c.employeeDisplayName,
      employeeLegalName: c.employeeDisplayName,
      employeeSourceId: c.employeeSourceId,
      jobTitle: c.jobTitle,
      department: c.department,
      location: c.location,
      managerName: await managerNameForCase(caseId),
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
    include: { template: { select: { name: true } } },
  });
  const attestations = await getPrisma().attestation.findMany({
    where: { subjectType: 'DOCUMENT', subjectId: { in: docs.map((x) => x.id) } },
  });
  return {
    docs,
    attestations,
    capabilities: {
      canCreate: canActOnCase(actor, 'doc.create', ctx),
      canApprove: canActOnCase(actor, 'doc.approve', ctx),
      canDownload: canActOnCase(actor, 'doc.download', ctx),
    },
  };
}

/** Preview body: substituted content with approver placeholders labelled. */
export function previewContent(
  templateBody: string,
  fieldSnapshot: DocumentFieldSnapshot,
  approver?: { name: string; title: string },
): string {
  const snap: DocumentFieldSnapshot = {
    ...fieldSnapshot,
    HR_APPROVER_NAME: approver?.name ?? '(approver name - completed at approval)',
    HR_APPROVER_TITLE: approver?.title ?? '(approver title - completed at approval)',
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
      canSubmit: canActOnCase(actor, 'doc.submit', ctx),
      canApprove: canActOnCase(actor, 'doc.approve', ctx),
      canReturn: canActOnCase(actor, 'doc.return', ctx),
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
  if (!['DRAFT', 'RETURNED', 'VALIDATION_FAILED'].includes(d.status))
    throw ServiceError.conflict('Only draft/returned documents can be edited.');
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

export async function submitDocument(actor: Actor, docId: string) {
  const { d, c, ctx } = await loadDoc(actor, docId);
  if (!canActOnCase(actor, 'doc.submit', ctx)) throw ServiceError.forbidden();
  const guard = docTransitionError('submit', d.status);
  if (guard) throw ServiceError.validation([guard]);

  const correlationId = newCorrelationId();
  const prisma = getPrisma();

  if (d.documentType === 'MANUAL_EXCEPTION_DOCUMENT') {
    if (!d.exceptionAttachmentId)
      throw ServiceError.validation(['The exception document upload is missing.']);
    return prisma.$transaction(async (tx) => {
      const u = await tx.documentInstance.updateMany({
        where: { id: docId, rowVersion: d.rowVersion },
        data: {
          status: 'PENDING_APPROVAL',
          submittedAt: new Date(),
          submittedById: actor.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (u.count === 0) throw ServiceError.conflict('The document changed; reload and retry.');
      await appendAudit(tx, {
        eventType: 'DOC_SUBMITTED',
        actorType: 'USER',
        actorId: actor.userId,
        effectiveRoles: actor.roles,
        objectType: 'DocumentInstance',
        objectId: docId,
        caseId: d.caseId,
        result: 'SUCCESS',
        correlationId,
        metadata: { documentType: d.documentType, documentVersion: d.version },
      });
    });
  }

  if (!d.template) throw ServiceError.conflict('Template missing for this document.');
  const snapshot = d.fieldSnapshot as DocumentFieldSnapshot;
  const errors = documentValidationErrors(d.documentType, d.template.contentBody, snapshot);
  // Date-order check from live case values (C.5): confirmed >= received.
  if (c.confirmedLastDay && c.receivedAt && c.confirmedLastDay < c.receivedAt)
    errors.push('Confirmed last working date is before the resignation received date.');
  // Changed-case-data check (C.5): re-derive and compare material values.
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

  return prisma.$transaction(async (tx) => {
    if (errors.length) {
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
      throw ServiceError.validation(errors);
    }
    const content = previewContent(d.template!.contentBody, snapshot);
    const u = await tx.documentInstance.updateMany({
      where: { id: docId, rowVersion: d.rowVersion },
      data: {
        status: 'PENDING_APPROVAL',
        contentSnapshot: content,
        validationErrors: undefined,
        submittedAt: new Date(),
        submittedById: actor.userId,
        rowVersion: { increment: 1 },
      },
    });
    if (u.count === 0) throw ServiceError.conflict('The document changed; reload and retry.');
    await appendAudit(tx, {
      eventType: 'DOC_SUBMITTED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'DocumentInstance',
      objectId: docId,
      caseId: d.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { documentType: d.documentType, documentVersion: d.version },
    });
  });
}

export async function returnDocument(actor: Actor, docId: string, reason: string) {
  const { d, ctx } = await loadDoc(actor, docId);
  if (!canActOnCase(actor, 'doc.return', ctx)) throw ServiceError.forbidden();
  const guard = docTransitionError('return', d.status, reason);
  if (guard) throw ServiceError.validation([guard]);
  const correlationId = newCorrelationId();
  await getPrisma().$transaction(async (tx) => {
    const u = await tx.documentInstance.updateMany({
      where: { id: docId, rowVersion: d.rowVersion },
      data: { status: 'RETURNED', returnReason: reason.trim(), rowVersion: { increment: 1 } },
    });
    if (u.count === 0) throw ServiceError.conflict('The document changed; reload and retry.');
    await appendAudit(tx, {
      eventType: 'DOC_RETURNED',
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

/** Maker-checker approval bound to exact content checksum (D.7/D.8). */
export async function approveDocument(actor: Actor, docId: string) {
  const { d, ctx } = await loadDoc(actor, docId);
  if (!canActOnCase(actor, 'doc.approve', ctx)) {
    await auditDenied(actor, 'ACCESS_DENIED', 'DocumentInstance', docId, d.caseId);
    throw ServiceError.forbidden();
  }
  // Maker-checker (UAT-4 finding): the human who VALIDATED AND SUBMITTED this
  // version is the maker; they can never also be the approver. The mechanical
  // creator is used only as a fallback for legacy rows submitted before the
  // submitter was recorded. This keeps supersede-and-recreate workable in a
  // single-HR-Manager organization (the manager's auto-created corrected
  // draft is reviewed and submitted by an HR officer, then manager-approved)
  // without ever allowing one person to both submit and approve.
  const makerId = d.submittedById ?? d.createdById;
  if (makerId === actor.userId)
    throw ServiceError.forbidden(
      'The user who submitted this document for approval cannot also approve it (maker-checker).',
    );
  const guard = docTransitionError('approve', d.status);
  if (guard) throw ServiceError.validation([guard]);

  const prisma = getPrisma();
  const approverUser = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  const approverTitle = actor.roles.includes('HR_MANAGER') ? 'HR Manager' : actor.roles.join(', ');
  const correlationId = newCorrelationId();

  let finalContent: string | null = null;
  let checksum: string;
  if (d.documentType === 'MANUAL_EXCEPTION_DOCUMENT') {
    const att = await prisma.attachment.findUniqueOrThrow({
      where: { id: d.exceptionAttachmentId! },
    });
    checksum = att.checksum;
  } else {
    const snapshot = {
      ...(d.fieldSnapshot as DocumentFieldSnapshot),
      HR_APPROVER_NAME: approverUser.displayName,
      HR_APPROVER_TITLE: approverTitle,
    };
    finalContent = substitute(d.template!.contentBody, snapshot);
    if (hasMissingMarkers(finalContent))
      throw ServiceError.validation([
        'The document still contains unresolved fields; return it for correction.',
      ]);
    checksum = contentChecksum(finalContent);
  }

  await prisma.$transaction(async (tx) => {
    const u = await tx.documentInstance.updateMany({
      where: { id: docId, rowVersion: d.rowVersion, status: 'PENDING_APPROVAL' },
      data: {
        status: 'APPROVED',
        contentSnapshot: finalContent ?? undefined,
        contentChecksum: checksum,
        fieldSnapshot: {
          ...(d.fieldSnapshot as object),
          HR_APPROVER_NAME: approverUser.displayName,
          HR_APPROVER_TITLE: approverTitle,
        },
        approvedAt: new Date(),
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
        kind: 'HR_DOCUMENT_APPROVAL',
        caseId: d.caseId,
        actorId: actor.userId,
        actorDisplayName: approverUser.displayName,
        actorRole: approverTitle,
        meaning:
          'I approve this exact document version and content for release as the final employee-facing document.',
        contentChecksum: checksum,
        correlationId,
      },
    });
    await appendAudit(tx, {
      eventType: 'DOC_APPROVED',
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
      },
    });
  });

  // Approval invokes rendering (D.9); failures fall to the worker retry job.
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
  const { d, ctx } = await loadDoc(actor, docId);
  if (!canActOnCase(actor, 'doc.markIssued', ctx)) throw ServiceError.forbidden();
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
 * Called after a material case correction: pre-approval versions fall back to
 * VALIDATION_FAILED (stale fields), approved/rendered-but-unissued versions
 * are superseded with their attestations invalidated. Issued documents are
 * never touched.
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
