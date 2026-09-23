'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ServiceError,
  createLetterDraft,
  createManualExceptionDraft,
  finalizeDocument,
  issueDocumentByEmail,
  markManuallyIssued,
  refreshDraftFields,
  setEmployeeAddress,
  supersedeAndRecreate,
  updateDraftBody,
  voidDocument,
} from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function back(caseId: string, opts: { err?: string; ok?: string }): never {
  const p = new URLSearchParams();
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  redirect(`/cases/${caseId}/documents?${p.toString()}`);
}

function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.details.length ? e.details.join('|') : e.message;
  return 'Something went wrong.';
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();

async function run(
  formData: FormData,
  fn: (actor: { userId: string; roles: readonly never[] }, fd: FormData) => Promise<string>,
): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  try {
    const ok = await fn(actor as never, formData);
    revalidatePath(`/cases/${caseId}/documents`);
    back(caseId, { ok });
  } catch (e) {
    if (e instanceof ServiceError) back(caseId, { err: errText(e) });
    throw e;
  }
}

export async function createLetterAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    await createLetterDraft(actor as never, str(fd, 'caseId'));
    return 'Draft document created from the active template.';
  });
}

/** DEC-069: HR saves the edited wording of a draft letter (a new revision). */
export async function updateDraftBodyAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    const outcome = await updateDraftBody(
      actor as never,
      str(fd, 'docId'),
      String(fd.get('body') ?? ''),
    );
    return outcome.changed
      ? `Wording saved as version ${outcome.revision}.`
      : 'No changes to save.';
  });
}

export async function createExceptionAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    await createManualExceptionDraft(actor as never, str(fd, 'caseId'), {
      reason: str(fd, 'reason'),
      attachmentId: str(fd, 'attachmentId'),
    });
    return 'Manual-exception document created.';
  });
}

export async function refreshFieldsAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    await refreshDraftFields(actor as never, str(fd, 'docId'));
    return 'Draft fields refreshed from current case data.';
  });
}

/**
 * DEC-066: validate, attest and render in one step. The HR Manager approved
 * the case; the person executing it finalizes the document.
 */
export async function finalizeDocAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    await finalizeDocument(actor as never, str(fd, 'docId'));
    return 'Document finalized; the final PDF has been rendered.';
  });
}

export async function voidDocAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    await voidDocument(actor as never, str(fd, 'docId'), str(fd, 'reason'));
    return 'Document voided.';
  });
}

export async function markIssuedAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    await markManuallyIssued(actor as never, str(fd, 'docId'), {
      method: str(fd, 'method') as never,
      recipientClass: str(fd, 'recipientClass') as never,
      note: str(fd, 'note') || undefined,
    });
    return 'Manual issue recorded (no email was sent).';
  });
}

/**
 * Record the address the acceptance letter is written to, typed by HR from
 * the resignation letter scan.
 */
export async function setAddressAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    await setEmployeeAddress(actor as never, str(fd, 'caseId'), {
      employeeAddress: str(fd, 'employeeAddress'),
    });
    return str(fd, 'employeeAddress')
      ? 'Address recorded. Refresh the letter draft to pick it up.'
      : 'Address cleared.';
  });
}

/** Send the rendered letter to the employee, copying the selected HR staff. */
export async function issueByEmailAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    const outcome = await issueDocumentByEmail(actor as never, str(fd, 'docId'), {
      ccIds: fd.getAll('ccIds').map((v) => String(v)),
      note: str(fd, 'note') || undefined,
    });
    return outcome.ccCount > 0
      ? `Letter queued for ${outcome.destinationMask}, copying ${outcome.ccCount} HR colleague(s).`
      : `Letter queued for ${outcome.destinationMask}.`;
  });
}

export async function supersedeDocAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    await supersedeAndRecreate(actor as never, str(fd, 'docId'), str(fd, 'reason'));
    return 'Document superseded; a corrected draft was created.';
  });
}
