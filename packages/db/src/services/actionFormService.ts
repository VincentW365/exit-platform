/**
 * Digital offboarding Action Form (Directive 2 section F, redesigned by
 * Directive 6.3 D/E/F): an HR-controlled operational record. The assigned HR
 * Officer prepares, reviews and COMPLETES ordinary forms; there is no manager
 * approval and no mandatory HR-Manager sign-off (HR_REVIEWED is an optional
 * configuration-gated oversight step). Checklists are completion evidence;
 * completion is attested; no field touches pay. Historical manager-approval
 * attestations and legacy statuses render forever.
 */
import {
  acknowledgementErrors,
  canActOnCase,
  checklistErrors,
  emptyChecklist,
  formSubmitErrors,
  formTransitionError,
  suggestedAcknowledgement,
  FINANCE_CHECKLIST_ITEMS,
  FORM_LIVE_STATUSES,
  HR_CHECKLIST_ITEMS,
  type Actor,
  type ChecklistState,
} from '@exit/domain';
import { getPrisma } from '../client.ts';
import { ServiceError } from '../errors.ts';
import { appendAudit, auditDenied, newCorrelationId } from './auditService.ts';
import { renderActionFormPdf } from './renderService.ts';
import { assertFeatureAllowed, loadCaseAccess } from './shared.ts';
import { getSystemConfigValue } from './systemConfigService.ts';

const LIVE_FORM_STATUSES = FORM_LIVE_STATUSES;

function formFieldSnapshot(c: {
  caseNumber: string;
  employeeSourceId: string;
  employeeDisplayName: string;
  jobTitle: string | null;
  department: string;
  location: string;
  departureType: string;
  receivedAt: Date;
  proposedLastDay: Date | null;
  confirmedLastDay: Date | null;
  effectiveSeparationAt: Date | null;
  reasonCaptureStatus: string;
}) {
  return {
    caseReference: c.caseNumber,
    employeeId: c.employeeSourceId,
    employeeName: c.employeeDisplayName,
    position: c.jobTitle ?? '',
    department: c.department,
    location: c.location,
    departureType: c.departureType,
    receivedAt: c.receivedAt.toISOString(),
    proposedLastDay: c.proposedLastDay?.toISOString() ?? null,
    confirmedLastDay: c.confirmedLastDay?.toISOString() ?? null,
    effectiveSeparationAt: c.effectiveSeparationAt?.toISOString() ?? null,
    reasonCaptureStatus: c.reasonCaptureStatus,
  };
}

export async function createActionForm(actor: Actor, caseId: string) {
  const { c, ctx } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'form.edit', ctx)) {
    await auditDenied(actor, 'ACCESS_DENIED', 'ActionForm', 'create', caseId);
    throw ServiceError.forbidden();
  }
  await assertFeatureAllowed(c, 'automation.letterGeneration');

  const prisma = getPrisma();
  const live = await prisma.actionFormVersion.findFirst({
    where: { caseId, status: { in: [...LIVE_FORM_STATUSES] } },
  });
  if (live)
    throw ServiceError.conflict(`A live action form already exists (version ${live.version}).`);
  const latest = await prisma.actionFormVersion.findFirst({
    where: { caseId },
    orderBy: { version: 'desc' },
  });

  // Directive 6.3 B/E: pre-populate what the platform already knows,
  // including the acknowledgement treatment for departure types where the
  // employee cannot realistically acknowledge (immediate resignation).
  const suggestion = suggestedAcknowledgement(c.departureType);
  const correlationId = newCorrelationId();
  return prisma.$transaction(async (tx) => {
    const f = await tx.actionFormVersion.create({
      data: {
        caseId,
        version: (latest?.version ?? 0) + 1,
        status: 'DRAFT',
        fieldSnapshot: formFieldSnapshot(c) as object,
        hrChecklist: emptyChecklist(HR_CHECKLIST_ITEMS) as object,
        financeChecklist: emptyChecklist(FINANCE_CHECKLIST_ITEMS) as object,
        ...(suggestion.status !== 'PENDING'
          ? { ackStatus: suggestion.status, ackReason: suggestion.reasonSuggestion }
          : {}),
        createdById: actor.userId,
      },
    });
    await appendAudit(tx, {
      eventType: 'FORM_CREATED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'ActionFormVersion',
      objectId: f.id,
      caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { formVersion: f.version },
    });
    return f;
  });
}

async function loadForm(actor: Actor, formId: string) {
  const f = await getPrisma().actionFormVersion.findUnique({ where: { id: formId } });
  if (!f) throw ServiceError.notFound();
  const { c, ctx, level } = await loadCaseAccess(actor, f.caseId);
  return { f, c, ctx, level };
}

/** Access-level-scoped view (F role rules 3-4). */
export async function getActionForm(actor: Actor, caseId: string) {
  const { c, ctx, level } = await loadCaseAccess(actor, caseId);
  if (!canActOnCase(actor, 'form.view', ctx)) throw ServiceError.notFound();
  const prisma = getPrisma();
  const forms = await prisma.actionFormVersion.findMany({
    where: { caseId },
    orderBy: { version: 'desc' },
  });
  const current = forms[0] ?? null;
  const attestations = current
    ? await prisma.attestation.findMany({
        where: { subjectType: 'ACTION_FORM', subjectId: { in: forms.map((x) => x.id) } },
        orderBy: { createdAt: 'asc' },
      })
    : [];

  // Directive 6.3 corrections 1-2: the optional HR-Manager review step is
  // configuration-gated and OFF by default.
  const requireHrReview = (await getSystemConfigValue('actionForm.requireHrReview')) === true;

  const capabilities = {
    canEdit: canActOnCase(actor, 'form.edit', ctx),
    canSubmit: canActOnCase(actor, 'form.submit', ctx),
    canComplete: canActOnCase(actor, 'form.complete', ctx),
    canHrReview: canActOnCase(actor, 'form.hrReview', ctx),
    canReturn: canActOnCase(actor, 'form.return', ctx),
    canVoid: canActOnCase(actor, 'form.void', ctx),
    requireHrReview,
  };

  // Directive 6.3 D/I/J: the Action Form is HR-only; the old limited
  // Finance/Manager surfaces are never granted for new requests.
  const mask = (form: (typeof forms)[number]) => ({
    id: form.id,
    version: form.version,
    status: form.status,
    fieldSnapshot: form.fieldSnapshot,
    priorStatus: form.priorStatus,
    newStatus: form.newStatus,
    ackStatus: form.ackStatus,
    ackDate: form.ackDate,
    ackMethod: form.ackMethod,
    returnReason: form.returnReason,
    pdfChecksum: form.pdfChecksum,
    hasPdf: Boolean(form.pdfObjectKey),
    createdAt: form.createdAt,
    updatedAt: form.updatedAt,
    hrChecklist: form.hrChecklist,
    financeChecklist: form.financeChecklist,
    financeNotes: form.financeNotes,
    ackReason: form.ackReason,
    ackEvidenceAttachmentId: form.ackEvidenceAttachmentId,
    hrRemarks: form.hrRemarks,
    voidReason: form.voidReason,
    outdatedReason: form.outdatedReason,
    completedAt: form.completedAt,
    hrReviewedAt: form.hrReviewedAt,
  });

  return {
    caseNumber: c.caseNumber,
    level,
    current: current ? mask(current) : null,
    history: forms.slice(1).map((x) => ({ id: x.id, version: x.version, status: x.status })),
    attestations: attestations.map((a) => ({
      kind: a.kind,
      actorDisplayName: a.actorDisplayName,
      actorRole: a.actorRole,
      createdAt: a.createdAt,
      invalidatedAt: a.invalidatedAt,
      subjectVersion: a.subjectVersion,
    })),
    capabilities,
  };
}

export async function updateActionFormHr(
  actor: Actor,
  formId: string,
  input: {
    hrChecklist?: ChecklistState;
    ackStatus?: 'PENDING' | 'ACKNOWLEDGED' | 'NOT_OBTAINED' | 'NOT_APPLICABLE';
    ackDate?: Date | null;
    ackMethod?: string | null;
    ackReason?: string | null;
    ackEvidenceAttachmentId?: string | null;
    hrRemarks?: string | null;
  },
) {
  const { f, c, ctx } = await loadForm(actor, formId);
  if (!canActOnCase(actor, 'form.edit', ctx)) throw ServiceError.forbidden();
  if (!['DRAFT', 'RETURNED', 'RETURNED_FOR_CORRECTION'].includes(f.status))
    throw ServiceError.conflict('Only draft or returned forms can be edited.');

  const errors: string[] = [];
  if (input.hrChecklist) errors.push(...checklistErrors(input.hrChecklist, HR_CHECKLIST_ITEMS));
  const ackStatus = input.ackStatus ?? f.ackStatus;
  errors.push(
    ...acknowledgementErrors({
      departureType: c.departureType,
      status: ackStatus,
      method: input.ackMethod !== undefined ? input.ackMethod : f.ackMethod,
      date: input.ackDate !== undefined ? input.ackDate : f.ackDate,
      reason: input.ackReason !== undefined ? input.ackReason : f.ackReason,
    }),
  );
  if (input.hrRemarks && input.hrRemarks.length > 2000)
    errors.push('HR remarks are limited to 2000 characters.');
  if (input.ackEvidenceAttachmentId) {
    const att = await getPrisma().attachment.findUnique({
      where: { id: input.ackEvidenceAttachmentId },
    });
    if (!att || att.caseId !== f.caseId)
      errors.push('Acknowledgement evidence attachment not found on this case.');
  }
  if (errors.length) throw ServiceError.validation(errors);

  const correlationId = newCorrelationId();
  return getPrisma().$transaction(async (tx) => {
    const u = await tx.actionFormVersion.updateMany({
      where: { id: formId, rowVersion: f.rowVersion },
      data: {
        ...(input.hrChecklist ? { hrChecklist: input.hrChecklist as object } : {}),
        ...(input.ackStatus ? { ackStatus: input.ackStatus } : {}),
        ...(input.ackDate !== undefined ? { ackDate: input.ackDate } : {}),
        ...(input.ackMethod !== undefined ? { ackMethod: input.ackMethod?.trim() || null } : {}),
        ...(input.ackReason !== undefined ? { ackReason: input.ackReason?.trim() || null } : {}),
        ...(input.ackEvidenceAttachmentId !== undefined
          ? { ackEvidenceAttachmentId: input.ackEvidenceAttachmentId }
          : {}),
        ...(input.hrRemarks !== undefined ? { hrRemarks: input.hrRemarks?.trim() || null } : {}),
        rowVersion: { increment: 1 },
      },
    });
    if (u.count === 0) throw ServiceError.conflict('The form changed; reload and retry.');
    await appendAudit(tx, {
      eventType: 'FORM_UPDATED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'ActionFormVersion',
      objectId: formId,
      caseId: f.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { formVersion: f.version, section: 'hr' },
    });
  });
}

/**
 * The Finance section records evidence of Finance activity performed outside
 * the application (Directive 6.3 J: Finance never logs in - the automated
 * notification and any returned evidence are what HR records here).
 */
export async function updateActionFormFinance(
  actor: Actor,
  formId: string,
  input: { financeChecklist?: ChecklistState; financeNotes?: string | null },
) {
  const { f, ctx } = await loadForm(actor, formId);
  if (!canActOnCase(actor, 'form.edit', ctx)) {
    await auditDenied(actor, 'ACCESS_DENIED', 'ActionFormVersion', formId, f.caseId);
    throw ServiceError.forbidden();
  }
  if (
    ![
      'DRAFT',
      'RETURNED',
      'RETURNED_FOR_CORRECTION',
      'READY_FOR_HR_REVIEW',
      'HR_REVIEWED',
      'PENDING_MANAGER',
      'PENDING_HR',
    ].includes(f.status)
  )
    throw ServiceError.conflict('The form is finalized; finance updates are closed.');

  const errors: string[] = [];
  if (input.financeChecklist)
    errors.push(...checklistErrors(input.financeChecklist, FINANCE_CHECKLIST_ITEMS));
  if (input.financeNotes && input.financeNotes.length > 1000)
    errors.push('Finance notes are limited to 1000 characters.');
  if (errors.length) throw ServiceError.validation(errors);

  const correlationId = newCorrelationId();
  return getPrisma().$transaction(async (tx) => {
    const u = await tx.actionFormVersion.updateMany({
      where: { id: formId, rowVersion: f.rowVersion },
      data: {
        ...(input.financeChecklist ? { financeChecklist: input.financeChecklist as object } : {}),
        ...(input.financeNotes !== undefined
          ? { financeNotes: input.financeNotes?.trim() || null }
          : {}),
        rowVersion: { increment: 1 },
      },
    });
    if (u.count === 0) throw ServiceError.conflict('The form changed; reload and retry.');
    await appendAudit(tx, {
      eventType: 'FORM_UPDATED',
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'ActionFormVersion',
      objectId: formId,
      caseId: f.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { formVersion: f.version, section: 'finance' },
    });
  });
}

async function transitionForm(
  actor: Actor,
  formId: string,
  action: 'submitToHrReview' | 'hrReview' | 'complete' | 'return' | 'void',
  permission: 'form.submit' | 'form.hrReview' | 'form.complete' | 'form.return' | 'form.void',
  eventType:
    | 'FORM_SENT_FOR_HR_REVIEW'
    | 'FORM_HR_REVIEWED'
    | 'FORM_COMPLETED'
    | 'FORM_RETURNED'
    | 'FORM_VOIDED',
  reason?: string,
) {
  const { f, c, ctx } = await loadForm(actor, formId);
  if (!canActOnCase(actor, permission, ctx)) {
    await auditDenied(actor, 'ACCESS_DENIED', 'ActionFormVersion', formId, f.caseId);
    throw ServiceError.forbidden();
  }
  const guard = formTransitionError(action, f.status, reason);
  if (guard) throw ServiceError.validation([guard]);

  // Readiness gate: finishing preparation AND completing both require the
  // acknowledgement recorded and every HR checklist item resolved.
  if (action === 'submitToHrReview' || action === 'complete') {
    const errors = formSubmitErrors({
      departureType: c.departureType,
      ackStatus: f.ackStatus,
      ackReason: f.ackReason,
      hrChecklist: f.hrChecklist as ChecklistState,
    });
    if (errors.length) throw ServiceError.validation(errors);
  }

  // Directive 6.3 correction 1: where configured policy requires HR-Manager
  // review, completion must pass through HR_REVIEWED first. Legacy live rows
  // (PENDING_MANAGER/PENDING_HR) predate the policy and may complete directly.
  if (action === 'complete' && f.status === 'READY_FOR_HR_REVIEW') {
    const requireHrReview = (await getSystemConfigValue('actionForm.requireHrReview')) === true;
    if (requireHrReview && !canActOnCase(actor, 'form.hrReview', ctx))
      throw ServiceError.validation([
        'Policy requires HR-Manager review before completion (record the review first).',
      ]);
  }

  const to =
    action === 'submitToHrReview'
      ? 'READY_FOR_HR_REVIEW'
      : action === 'hrReview'
        ? 'HR_REVIEWED'
        : action === 'complete'
          ? 'COMPLETE'
          : action === 'void'
            ? 'VOIDED'
            : 'RETURNED_FOR_CORRECTION';

  const prisma = getPrisma();
  const actingUser = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  const actorRole = actor.roles.includes('HR_MANAGER') ? 'HR Manager' : 'HR Officer';
  const now = new Date();
  const correlationId = newCorrelationId();

  await prisma.$transaction(async (tx) => {
    const u = await tx.actionFormVersion.updateMany({
      where: { id: formId, rowVersion: f.rowVersion, status: f.status },
      data: {
        status: to,
        ...(action === 'submitToHrReview' ? { submittedById: actor.userId, submittedAt: now } : {}),
        ...(action === 'hrReview' ? { hrReviewedById: actor.userId, hrReviewedAt: now } : {}),
        ...(action === 'complete' ? { completedById: actor.userId, completedAt: now } : {}),
        ...(to === 'RETURNED_FOR_CORRECTION' ? { returnReason: reason?.trim() } : {}),
        ...(to === 'VOIDED' ? { voidReason: reason?.trim() } : {}),
        rowVersion: { increment: 1 },
      },
    });
    if (u.count === 0)
      throw ServiceError.conflict('The form was changed or already decided; reload and retry.');

    if (action === 'complete') {
      const checksum = JSON.stringify({
        v: f.version,
        snapshot: f.fieldSnapshot,
        hr: f.hrChecklist,
        fin: f.financeChecklist,
        ack: [f.ackStatus, f.ackDate, f.ackMethod, f.ackReason],
      });
      const { createHash } = await import('node:crypto');
      await tx.attestation.create({
        data: {
          subjectType: 'ACTION_FORM',
          subjectId: formId,
          subjectVersion: f.version,
          kind: 'HR_FORM_COMPLETION',
          caseId: f.caseId,
          actorId: actor.userId,
          actorDisplayName: actingUser.displayName,
          actorRole,
          meaning:
            'I confirm this offboarding action form is complete: the recorded information is accurate and every required HR action is done or covered by an approved exception.',
          contentChecksum: createHash('sha256').update(checksum, 'utf8').digest('hex'),
          correlationId,
        },
      });
    }

    await appendAudit(tx, {
      eventType,
      actorType: 'USER',
      actorId: actor.userId,
      effectiveRoles: actor.roles,
      objectType: 'ActionFormVersion',
      objectId: formId,
      caseId: f.caseId,
      result: 'SUCCESS',
      correlationId,
      metadata: { formVersion: f.version, toStatus: to, reason },
    });
  });

  // Completion renders the immutable form PDF (F.10).
  if (action === 'complete') await renderApprovedForm(formId, correlationId);
}

export const submitActionForm = (a: Actor, id: string) =>
  transitionForm(a, id, 'submitToHrReview', 'form.submit', 'FORM_SENT_FOR_HR_REVIEW');
export const hrReviewForm = (a: Actor, id: string) =>
  transitionForm(a, id, 'hrReview', 'form.hrReview', 'FORM_HR_REVIEWED');
export const completeActionForm = (a: Actor, id: string) =>
  transitionForm(a, id, 'complete', 'form.complete', 'FORM_COMPLETED');
export const returnActionForm = (a: Actor, id: string, reason: string) =>
  transitionForm(a, id, 'return', 'form.return', 'FORM_RETURNED', reason);
export const voidActionForm = (a: Actor, id: string, reason: string) =>
  transitionForm(a, id, 'void', 'form.void', 'FORM_VOIDED', reason);

/** Render the final form PDF (idempotent; COMPLETE new / APPROVED legacy). */
export async function renderApprovedForm(formId: string, correlationId: string): Promise<void> {
  const prisma = getPrisma();
  const f = await prisma.actionFormVersion.findUnique({ where: { id: formId } });
  if (!f || !['COMPLETE', 'APPROVED'].includes(f.status) || f.pdfObjectKey) return;

  const snap = f.fieldSnapshot as Record<string, string | null>;
  const attestations = await prisma.attestation.findMany({
    where: { subjectType: 'ACTION_FORM', subjectId: formId, invalidatedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  const hrChecklist = f.hrChecklist as Record<string, string>;
  const financeChecklist = f.financeChecklist as Record<string, string>;
  const fmtDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '-');

  try {
    const pdf = await renderActionFormPdf({
      confidentiality: 'Restricted - HR internal record',
      caseReference: snap['caseReference'] ?? '',
      formVersion: `v${f.version}`,
      approvedAt: f.updatedAt,
      sections: [
        {
          heading: '1. Employee and case details',
          rows: [
            ['Case reference', snap['caseReference'] ?? ''],
            ['Employee ID', snap['employeeId'] ?? ''],
            ['Employee name', snap['employeeName'] ?? ''],
            ['Position', snap['position'] ?? ''],
            ['Department', snap['department'] ?? ''],
            ['Location', snap['location'] ?? ''],
          ],
        },
        {
          heading: '2. Separation details',
          rows: [
            ['Departure type', snap['departureType'] ?? ''],
            ['Resignation received', fmtDate(snap['receivedAt'])],
            ['Final working date', fmtDate(snap['confirmedLastDay'])],
            ['Effective separation (instant)', snap['effectiveSeparationAt'] ?? '-'],
            ['Reason capture status', snap['reasonCaptureStatus'] ?? ''],
          ],
        },
        {
          heading: '3. Employment status',
          rows: [
            ['Prior status', f.priorStatus],
            ['New status', f.newStatus],
          ],
        },
        {
          heading: '4. HR checklist (completion evidence, not approval)',
          rows: HR_CHECKLIST_ITEMS.map((i) => [i.label, hrChecklist[i.key] ?? 'PENDING']),
        },
        {
          heading: '5. Finance checklist (all work performed outside this application)',
          rows: FINANCE_CHECKLIST_ITEMS.map((i) => [i.label, financeChecklist[i.key] ?? 'PENDING']),
        },
        {
          heading: '6. Employee acknowledgement (not an internal approval)',
          rows: [
            ['Status', f.ackStatus],
            ['Date', f.ackDate ? f.ackDate.toISOString().slice(0, 10) : '-'],
            ['Method', f.ackMethod ?? '-'],
          ],
        },
      ],
      approvals: attestations.map((a) => ({
        label:
          a.kind === 'MANAGER_FORM_APPROVAL'
            ? 'Manager approval'
            : a.kind === 'HR_FORM_COMPLETION'
              ? 'HR completion'
              : 'HR final approval',
        name: a.actorDisplayName,
        role: a.actorRole,
        at: a.createdAt,
      })),
    });
    await prisma.$transaction(async (tx) => {
      await tx.actionFormVersion.updateMany({
        where: { id: formId, status: { in: ['COMPLETE', 'APPROVED'] }, pdfObjectKey: null },
        data: { pdfObjectKey: pdf.objectKey, pdfChecksum: pdf.checksum, renderError: null },
      });
      await appendAudit(tx, {
        eventType: 'DOC_RENDERED',
        actorType: 'SYSTEM',
        objectType: 'ActionFormVersion',
        objectId: formId,
        caseId: f.caseId,
        result: 'SUCCESS',
        correlationId,
        metadata: { formVersion: f.version, bytes: pdf.byteLength },
      });
    });
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 300) : 'render failed';
    await prisma.actionFormVersion.update({
      where: { id: formId },
      data: { renderError: message },
    });
    await prisma.renderJob.create({
      data: { subjectType: 'ACTION_FORM', subjectId: formId, status: 'QUEUED', correlationId },
    });
  }
}

/** Material case correction: supersede finalized forms / flag live drafts. */
export async function outdateFormsForCaseChange(caseId: string, reason: string): Promise<void> {
  const prisma = getPrisma();
  const correlationId = newCorrelationId();
  const live = await prisma.actionFormVersion.findMany({
    where: { caseId, status: { in: [...LIVE_FORM_STATUSES] } },
  });
  for (const f of live) {
    await prisma.$transaction(async (tx) => {
      if (['APPROVED', 'COMPLETE'].includes(f.status)) {
        await tx.actionFormVersion.update({
          where: { id: f.id },
          data: { status: 'SUPERSEDED', outdatedReason: reason, rowVersion: { increment: 1 } },
        });
        await tx.attestation.updateMany({
          where: { subjectType: 'ACTION_FORM', subjectId: f.id, invalidatedAt: null },
          data: {
            invalidatedAt: new Date(),
            invalidatedReason: `Material case correction: ${reason}`,
          },
        });
        await appendAudit(tx, {
          eventType: 'FORM_APPROVAL_INVALIDATED',
          actorType: 'SYSTEM',
          objectType: 'ActionFormVersion',
          objectId: f.id,
          caseId,
          result: 'SUCCESS',
          correlationId,
          metadata: { formVersion: f.version, reason },
        });
        // Directive 6.3 logic-audit fix: the supersede itself is now audited
        // (FORM_SUPERSEDED was declared but never emitted).
        await appendAudit(tx, {
          eventType: 'FORM_SUPERSEDED',
          actorType: 'SYSTEM',
          objectType: 'ActionFormVersion',
          objectId: f.id,
          caseId,
          result: 'SUCCESS',
          correlationId,
          metadata: { formVersion: f.version, reason },
        });
      } else {
        await tx.actionFormVersion.update({
          where: { id: f.id },
          data: { outdatedReason: reason, rowVersion: { increment: 1 } },
        });
      }
    });
  }
}

export async function downloadActionFormPdf(actor: Actor, formId: string) {
  const { f, ctx } = await loadForm(actor, formId);
  if (!canActOnCase(actor, 'doc.download', ctx)) {
    await auditDenied(actor, 'ACCESS_DENIED', 'ActionFormVersion', formId, f.caseId);
    throw ServiceError.forbidden();
  }
  if (!f.pdfObjectKey || !f.pdfChecksum)
    throw ServiceError.conflict('No final PDF exists for this form version.');
  const { readVerifiedPdf } = await import('./renderService.ts');
  const bytes = await readVerifiedPdf(f.pdfObjectKey, f.pdfChecksum);
  await appendAudit(getPrisma(), {
    eventType: 'DOC_DOWNLOADED',
    actorType: 'USER',
    actorId: actor.userId,
    effectiveRoles: actor.roles,
    objectType: 'ActionFormVersion',
    objectId: formId,
    caseId: f.caseId,
    result: 'SUCCESS',
    correlationId: newCorrelationId(),
    metadata: { formVersion: f.version, checksum: f.pdfChecksum },
  });
  const snap = f.fieldSnapshot as Record<string, string>;
  return { bytes, fileName: `${snap['caseReference'] ?? 'case'}-action-form-v${f.version}.pdf` };
}
