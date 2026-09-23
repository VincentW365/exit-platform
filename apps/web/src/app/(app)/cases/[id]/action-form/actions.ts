'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ServiceError,
  applyHrSignature,
  completeActionForm,
  createActionForm,
  createSignatureRequest,
  extendSignatureRequest,
  hrReviewForm,
  returnActionForm,
  revokeSignatureRequest,
  sendSignatureRequestEmail,
  startNewFormVersion,
  submitActionForm,
  updateActionFormFinance,
  supersedeHrSignature,
  updateActionFormHr,
  voidActionForm,
} from '@exit/db';
import { FINANCE_CHECKLIST_ITEMS, HR_CHECKLIST_ITEMS, type ChecklistState } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

/**
 * DEC-069: the signature actions also serve the Exit Checklist for Return
 * Items on the Assets tab, so a form may say where to return to. Only a
 * case tab of this case is ever accepted.
 */
function returnPath(caseId: string, requested: string): string {
  const allowed = new RegExp(`^/cases/${caseId}/(action-form|assets)$`);
  return allowed.test(requested) ? requested : `/cases/${caseId}/action-form`;
}

function back(caseId: string, opts: { err?: string; ok?: string; to?: string }): never {
  const p = new URLSearchParams();
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  redirect(`${returnPath(caseId, opts.to ?? '')}?${p.toString()}`);
}

const documentKindOf = (fd: FormData): 'ACTION_FORM' | 'ASSET_RECEIPT' =>
  String(fd.get('documentKind') ?? '') === 'ASSET_RECEIPT' ? 'ASSET_RECEIPT' : 'ACTION_FORM';

function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.details.length ? e.details.join('|') : e.message;
  return 'Something went wrong.';
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();

function checklistFromForm(
  fd: FormData,
  prefix: string,
  items: readonly { key: string }[],
): ChecklistState {
  const out: ChecklistState = {};
  for (const item of items) {
    const v = str(fd, `${prefix}.${item.key}`);
    out[item.key] = v === 'DONE' || v === 'NOT_APPLICABLE' ? v : 'PENDING';
  }
  return out;
}

async function run(
  formData: FormData,
  fn: (actor: never, fd: FormData) => Promise<string>,
): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  const to = str(formData, 'returnTo');
  try {
    const ok = await fn(actor as never, formData);
    revalidatePath(returnPath(caseId, to));
    back(caseId, { ok, to });
  } catch (e) {
    if (e instanceof ServiceError) back(caseId, { err: errText(e), to });
    throw e;
  }
}

export async function createFormAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    await createActionForm(actor, str(fd, 'caseId'));
    return 'Action form draft created.';
  });
}

export async function saveHrSectionAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    const ackDateRaw = str(fd, 'ackDate');
    await updateActionFormHr(actor, str(fd, 'formId'), {
      hrChecklist: checklistFromForm(fd, 'hr', HR_CHECKLIST_ITEMS),
      ackStatus: (str(fd, 'ackStatus') || 'PENDING') as never,
      ackDate: ackDateRaw ? new Date(ackDateRaw) : null,
      ackMethod: str(fd, 'ackMethod') || null,
      ackReason: str(fd, 'ackReason') || null,
      hrRemarks: str(fd, 'hrRemarks') || null,
    });
    return 'HR section saved.';
  });
}

export async function saveFinanceSectionAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    await updateActionFormFinance(actor, str(fd, 'formId'), {
      financeChecklist: checklistFromForm(fd, 'fin', FINANCE_CHECKLIST_ITEMS),
      financeNotes: str(fd, 'financeNotes') || null,
    });
    return 'Finance evidence saved.';
  });
}

export async function submitFormAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    await submitActionForm(actor, str(fd, 'formId'));
    return 'Form finished and ready for review.';
  });
}

export async function hrReviewAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    await hrReviewForm(actor, str(fd, 'formId'));
    return 'Management review recorded.';
  });
}

export async function completeFormAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    await completeActionForm(actor, str(fd, 'formId'));
    return 'Action form completed; the final form PDF has been generated.';
  });
}

export async function returnFormAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    await returnActionForm(actor, str(fd, 'formId'), str(fd, 'reason'));
    return 'Form returned for correction.';
  });
}

/** DEC-069 section 5: a signed or completed form changes only as a new version. */
export async function startNewFormVersionAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    const next = await startNewFormVersion(actor, str(fd, 'formId'), str(fd, 'reason'));
    return `Version ${next.version} started. The previous version is kept with its signatures.`;
  });
}

export async function voidFormAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    await voidActionForm(actor, str(fd, 'formId'), str(fd, 'reason'));
    return 'Form voided.';
  });
}

// --- DEC-068: electronic initials and signatures ---------------------------

export async function createSignatureRequestAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    await createSignatureRequest(actor, str(fd, 'formId'), {
      signerRole: 'EMPLOYEE',
      signerName: str(fd, 'signerName') || undefined,
      signerEmail: str(fd, 'signerEmail') || null,
      documentKind: documentKindOf(fd),
    });
    return 'Signature request ready. Copy the link or send it by email.';
  });
}

export async function sendSignatureRequestAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    const outcome = await sendSignatureRequestEmail(actor, str(fd, 'requestId'), {
      email: str(fd, 'signerEmail') || null,
    });
    return outcome.resend
      ? `Signature request sent again to ${outcome.destinationMask}.`
      : `Signature request sent to ${outcome.destinationMask}.`;
  });
}

export async function extendSignatureRequestAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    const days = Number(str(fd, 'addDays') || '7');
    const outcome = await extendSignatureRequest(actor, str(fd, 'requestId'), {
      addDays: Number.isFinite(days) ? days : 7,
      reason: str(fd, 'reason') || undefined,
    });
    return outcome.cappedByMaximum
      ? 'Link extended to the maximum allowed date.'
      : 'Link extended.';
  });
}

export async function revokeSignatureRequestAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    await revokeSignatureRequest(actor, str(fd, 'requestId'), str(fd, 'reason'));
    return 'Signing link revoked. It no longer works.';
  });
}

export async function applyHrSignatureAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    await applyHrSignature(actor, str(fd, 'formId'), {
      dataUrl: String(fd.get('dataUrl') ?? ''),
      provenance: str(fd, 'provenance') === 'TYPED' ? 'TYPED' : 'DRAWN',
      documentKind: documentKindOf(fd),
    });
    return 'Your signature has been added.';
  });
}

export async function clearHrSignatureAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    await supersedeHrSignature(
      actor,
      str(fd, 'formId'),
      str(fd, 'reason') || undefined,
      documentKindOf(fd),
    );
    return 'The previous signature has been replaced. You can sign again.';
  });
}
