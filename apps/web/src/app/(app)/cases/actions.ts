'use server';

/**
 * Case mutations. Every action re-authenticates, re-authorizes in the service
 * layer, and reports outcomes through redirect feedback parameters (rendered
 * as an accessible error/success summary).
 */
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  addNote,
  addParticipant,
  changeEffectiveTime,
  correctRecordPurpose,
  createDraft,
  recordBaselineEvent,
  removeParticipant,
  ServiceError,
  setRehireEligibility,
  transitionCase,
  updateDraft,
  uploadAttachment,
} from '@exit/db';
import type { CaseTransitionAction } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function feedbackRedirect(base: string, opts: { err?: string; ok?: string }): never {
  const p = new URLSearchParams();
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  redirect(`${base}?${p.toString()}`);
}

function errText(e: unknown): string {
  if (e instanceof ServiceError) {
    return e.details.length ? e.details.join('|') : e.message;
  }
  // Never leak internals (REQ-SEC-034).
  return 'Something went wrong. The event was logged with a reference id.';
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();
const opt = (fd: FormData, k: string): string | null => {
  const v = str(fd, k);
  return v === '' ? null : v;
};

export async function createCaseAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    const result = await createDraft(actor, {
      employeeSourceId: str(formData, 'employeeSourceId'),
      departureType: str(formData, 'departureType'),
      receivedAt: opt(formData, 'receivedAt'),
      receiptSource: str(formData, 'receiptSource'),
      proposedLastDay: opt(formData, 'proposedLastDay'),
      confirmedLastDay: opt(formData, 'confirmedLastDay'),
      effectiveSeparationAt: opt(formData, 'effectiveSeparationAt'),
      department: opt(formData, 'department') ?? undefined,
      location: opt(formData, 'location') ?? undefined,
      measurementCohort:
        str(formData, 'recordPurpose') === 'OPERATIONAL'
          ? (opt(formData, 'measurementCohort') ?? 'BASELINE')
          : null,
      recordPurpose: str(formData, 'recordPurpose') || 'OPERATIONAL',
      reasonCaptureStatus: str(formData, 'reasonCaptureStatus') || 'PENDING',
      reasonNotes: opt(formData, 'reasonNotes') ?? undefined,
      noticeProvidedDays: opt(formData, 'noticeProvidedDays'),
      noticeRequiredDays: opt(formData, 'noticeRequiredDays'),
      noticeTreatment: opt(formData, 'noticeTreatment') ?? undefined,
    });
    revalidatePath('/cases');
    const dup = result.duplicateWarnings.length
      ? ` Warning: other open case(s) exist for this employee: ${result.duplicateWarnings.join(', ')}.`
      : '';
    feedbackRedirect(`/cases/${result.caseId}`, {
      ok: `Draft case ${result.caseNumber} created. Review the details below, then submit for HR review.${dup}`,
    });
  } catch (e) {
    if (e instanceof ServiceError) {
      feedbackRedirect('/cases/new', { err: errText(e) });
    }
    throw e;
  }
}

export async function updateDraftAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  try {
    await updateDraft(actor, caseId, {
      receivedAt: opt(formData, 'receivedAt') ?? undefined,
      receiptSource: opt(formData, 'receiptSource') ?? undefined,
      proposedLastDay: opt(formData, 'proposedLastDay'),
      confirmedLastDay: opt(formData, 'confirmedLastDay'),
      effectiveSeparationAt: opt(formData, 'effectiveSeparationAt'),
      department: opt(formData, 'department') ?? undefined,
      location: opt(formData, 'location') ?? undefined,
      measurementCohort: opt(formData, 'measurementCohort'),
      reasonCaptureStatus: opt(formData, 'reasonCaptureStatus') ?? undefined,
      reasonNotes: opt(formData, 'reasonNotes') ?? '',
      noticeProvidedDays: opt(formData, 'noticeProvidedDays'),
      noticeRequiredDays: opt(formData, 'noticeRequiredDays'),
      noticeTreatment: opt(formData, 'noticeTreatment') ?? '',
    });
    revalidatePath(`/cases/${caseId}`);
    feedbackRedirect(`/cases/${caseId}`, { ok: 'Draft updated.' });
  } catch (e) {
    if (e instanceof ServiceError) feedbackRedirect(`/cases/${caseId}`, { err: errText(e) });
    throw e;
  }
}

export async function transitionAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  const action = str(formData, 'action') as CaseTransitionAction;
  const reason = opt(formData, 'reason') ?? undefined;
  if (!['submit', 'return', 'approve', 'cancel', 'void'].includes(action)) {
    feedbackRedirect(`/cases/${caseId}`, { err: 'Unknown action.' });
  }
  try {
    await transitionCase(actor, caseId, action, reason);
    revalidatePath(`/cases/${caseId}`);
    revalidatePath('/cases');
    const okText: Record<CaseTransitionAction, string> = {
      submit: 'Case submitted for HR review.',
      return: 'Case returned to draft for correction.',
      approve: 'Case approved. The employee snapshot has been captured.',
      cancel: 'Case cancelled.',
      void: 'Case voided.',
    };
    feedbackRedirect(`/cases/${caseId}`, { ok: okText[action] });
  } catch (e) {
    if (e instanceof ServiceError) feedbackRedirect(`/cases/${caseId}`, { err: errText(e) });
    throw e;
  }
}

export async function changeEffectiveTimeAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  const newTime = opt(formData, 'effectiveSeparationAt');
  const reason = str(formData, 'reason');
  try {
    if (!newTime) throw ServiceError.validation(['A new effective date and time is required.']);
    await changeEffectiveTime(actor, caseId, new Date(newTime), reason);
    revalidatePath(`/cases/${caseId}`);
    feedbackRedirect(`/cases/${caseId}`, {
      ok: 'Effective separation time changed (audited correction).',
    });
  } catch (e) {
    if (e instanceof ServiceError) feedbackRedirect(`/cases/${caseId}`, { err: errText(e) });
    throw e;
  }
}

export async function correctPurposeAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  try {
    await correctRecordPurpose(
      actor,
      caseId,
      str(formData, 'recordPurpose') as 'OPERATIONAL' | 'TRAINING' | 'TEST',
      str(formData, 'reason'),
    );
    revalidatePath(`/cases/${caseId}`);
    feedbackRedirect(`/cases/${caseId}`, { ok: 'Record purpose corrected (audited).' });
  } catch (e) {
    if (e instanceof ServiceError) feedbackRedirect(`/cases/${caseId}`, { err: errText(e) });
    throw e;
  }
}

export async function setRehireAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  const value = opt(formData, 'rehireEligibility');
  try {
    await setRehireEligibility(
      actor,
      caseId,
      (value as 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'CONDITIONAL') ?? null,
    );
    revalidatePath(`/cases/${caseId}`);
    feedbackRedirect(`/cases/${caseId}`, {
      ok: 'Rehire eligibility updated (restricted HR data).',
    });
  } catch (e) {
    if (e instanceof ServiceError) feedbackRedirect(`/cases/${caseId}`, { err: errText(e) });
    throw e;
  }
}

export async function addParticipantAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  try {
    await addParticipant(
      actor,
      caseId,
      str(formData, 'userId'),
      str(formData, 'participantRole') as 'HR_SUPPORT' | 'OVERSIGHT',
      str(formData, 'reason'),
    );
    revalidatePath(`/cases/${caseId}`);
    feedbackRedirect(`/cases/${caseId}`, { ok: 'Participant added.' });
  } catch (e) {
    if (e instanceof ServiceError) feedbackRedirect(`/cases/${caseId}`, { err: errText(e) });
    throw e;
  }
}

export async function removeParticipantAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  try {
    await removeParticipant(actor, caseId, str(formData, 'userId'), str(formData, 'reason'));
    revalidatePath(`/cases/${caseId}`);
    feedbackRedirect(`/cases/${caseId}`, { ok: 'Participant removed.' });
  } catch (e) {
    if (e instanceof ServiceError) feedbackRedirect(`/cases/${caseId}`, { err: errText(e) });
    throw e;
  }
}

export async function addNoteAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  try {
    await addNote(
      actor,
      caseId,
      str(formData, 'body'),
      (str(formData, 'visibility') as 'HR_ONLY' | 'HR_AND_OVERSIGHT') || 'HR_ONLY',
      opt(formData, 'supersedesId') ?? undefined,
    );
    revalidatePath(`/cases/${caseId}`);
    feedbackRedirect(`/cases/${caseId}`, { ok: 'Note recorded.' });
  } catch (e) {
    if (e instanceof ServiceError) feedbackRedirect(`/cases/${caseId}`, { err: errText(e) });
    throw e;
  }
}

export async function uploadAttachmentAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  const file = formData.get('file');
  try {
    if (!(file instanceof File) || file.size === 0)
      throw ServiceError.validation(['Choose a file to upload.']);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { scanStatus } = await uploadAttachment(
      actor,
      caseId,
      { fileName: file.name, declaredMime: file.type, bytes },
      (str(formData, 'purpose') as 'RESIGNATION_LETTER' | 'SUPPORTING_DOCUMENT') ||
        'SUPPORTING_DOCUMENT',
    );
    revalidatePath(`/cases/${caseId}`);
    feedbackRedirect(`/cases/${caseId}`, {
      ok:
        scanStatus === 'CLEAN'
          ? 'File uploaded.'
          : 'File uploaded and quarantined (no scanner in this environment).',
    });
  } catch (e) {
    if (e instanceof ServiceError) feedbackRedirect(`/cases/${caseId}`, { err: errText(e) });
    throw e;
  }
}

export async function recordBaselineAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  try {
    const occurredAt = opt(formData, 'occurredAt');
    const missingReason = opt(formData, 'missingReason');
    await recordBaselineEvent(actor, caseId, {
      eventType: str(formData, 'eventType') as never,
      occurredAt: occurredAt ? new Date(occurredAt) : null,
      missingReason: (missingReason as never) ?? null,
      missingNote: opt(formData, 'missingNote'),
      detail: opt(formData, 'detail'),
      evidenceRef: opt(formData, 'evidenceRef'),
    });
    revalidatePath(`/cases/${caseId}`);
    feedbackRedirect(`/cases/${caseId}`, { ok: 'Baseline fact recorded.' });
  } catch (e) {
    if (e instanceof ServiceError) feedbackRedirect(`/cases/${caseId}`, { err: errText(e) });
    throw e;
  }
}
