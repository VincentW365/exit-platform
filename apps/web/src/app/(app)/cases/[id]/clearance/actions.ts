'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ServiceError,
  approveFinalClearance,
  requestClearance,
  resolveException,
  returnFromClearance,
} from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function back(caseId: string, opts: { err?: string; ok?: string }): never {
  const p = new URLSearchParams();
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  redirect(`/cases/${caseId}/clearance?${p.toString()}`);
}

function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.details.length ? e.details.join('|') : e.message;
  return 'Something went wrong.';
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();

export async function requestClearanceAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  try {
    await requestClearance(actor, caseId);
    revalidatePath(`/cases/${caseId}/clearance`);
    back(caseId, { ok: 'Case moved to clearance review - every gate condition passed.' });
  } catch (e) {
    if (e instanceof ServiceError) back(caseId, { err: errText(e) });
    throw e;
  }
}

export async function approveClearanceAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  try {
    await approveFinalClearance(actor, caseId);
    revalidatePath(`/cases/${caseId}/clearance`);
    back(caseId, {
      ok: 'Final clearance approved: the case and workflow are COMPLETED and the immutable clearance record is stored.',
    });
  } catch (e) {
    if (e instanceof ServiceError) back(caseId, { err: errText(e) });
    throw e;
  }
}

export async function returnClearanceAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  try {
    await returnFromClearance(actor, caseId, str(formData, 'reason'));
    revalidatePath(`/cases/${caseId}/clearance`);
    back(caseId, { ok: 'Case returned to ACTIVE for further work.' });
  } catch (e) {
    if (e instanceof ServiceError) back(caseId, { err: errText(e) });
    throw e;
  }
}

export async function resolveExceptionAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  try {
    await resolveException(
      actor,
      str(formData, 'exceptionId'),
      str(formData, 'resolution'),
      formData.get('securityException') === 'on',
    );
    revalidatePath(`/cases/${caseId}/clearance`);
    back(caseId, { ok: 'Exception resolved.' });
  } catch (e) {
    if (e instanceof ServiceError) back(caseId, { err: errText(e) });
    throw e;
  }
}
