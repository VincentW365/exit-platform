'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ServiceError, recordHandoverReview, transitionHandover, updateHandover } from '@exit/db';
import { HANDOVER_SECTIONS } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function back(caseId: string, opts: { err?: string; ok?: string }): never {
  const p = new URLSearchParams();
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  redirect(`/cases/${caseId}/handover?${p.toString()}`);
}

function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.details.length ? e.details.join('|') : e.message;
  return 'Something went wrong.';
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();

export async function updateHandoverAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  try {
    const input: Record<string, string> = {};
    for (const s of HANDOVER_SECTIONS) {
      const v = formData.get(s.key);
      if (typeof v === 'string') input[s.key] = v.trim();
    }
    await updateHandover(actor, caseId, input);
    revalidatePath(`/cases/${caseId}/handover`);
    back(caseId, { ok: 'Handover record saved.' });
  } catch (e) {
    if (e instanceof ServiceError) back(caseId, { err: errText(e) });
    throw e;
  }
}

export async function handoverTransitionAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  try {
    const action = str(formData, 'action') as 'complete' | 'notApplicable' | 'waive' | 'reopen';
    await transitionHandover(actor, caseId, action, str(formData, 'reason') || undefined);
    revalidatePath(`/cases/${caseId}/handover`);
    const messages: Record<string, string> = {
      complete: 'Handover completed with manager attestation.',
      notApplicable: 'Handover marked not applicable with a recorded reason.',
      waive: 'Handover waived by HR Manager with a recorded reason.',
      reopen: 'Handover reopened.',
    };
    back(caseId, { ok: messages[action] ?? 'Done.' });
  } catch (e) {
    if (e instanceof ServiceError) back(caseId, { err: errText(e) });
    throw e;
  }
}

export async function handoverReviewAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  try {
    await recordHandoverReview(actor, caseId, str(formData, 'note'));
    revalidatePath(`/cases/${caseId}/handover`);
    back(caseId, { ok: 'HR review note recorded.' });
  } catch (e) {
    if (e instanceof ServiceError) back(caseId, { err: errText(e) });
    throw e;
  }
}
