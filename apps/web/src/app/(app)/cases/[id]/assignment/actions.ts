'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ServiceError,
  assignOfficer,
  confirmAssignmentPlan,
  overrideManager,
  refreshManagerFromDirectory,
} from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function back(caseId: string, opts: { err?: string; ok?: string }): never {
  const p = new URLSearchParams();
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  // The assignment panels live on the Workflow tab (owner, 2026-08-25).
  redirect(`/cases/${caseId}/workflow?${p.toString()}`);
}

function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.details.length ? e.details.join('|') : e.message;
  return 'Something went wrong. The event was logged with a reference id.';
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();

export async function assignOfficerAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  try {
    await assignOfficer(actor, caseId, str(formData, 'officerUserId'), str(formData, 'reason'));
    revalidatePath(`/cases/${caseId}/assignment`);
    back(caseId, { ok: 'HR Officer assigned (audited).' });
  } catch (e) {
    if (e instanceof ServiceError) back(caseId, { err: errText(e) });
    throw e;
  }
}

export async function refreshManagerAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  try {
    await refreshManagerFromDirectory(actor, caseId);
    revalidatePath(`/cases/${caseId}/assignment`);
    back(caseId, { ok: 'Manager re-derived from the current directory state (audited).' });
  } catch (e) {
    if (e instanceof ServiceError) back(caseId, { err: errText(e) });
    throw e;
  }
}

export async function overrideManagerAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  try {
    await overrideManager(actor, caseId, str(formData, 'managerSourceId'), str(formData, 'reason'));
    revalidatePath(`/cases/${caseId}/assignment`);
    back(caseId, { ok: 'Alternate manager recorded with before/after audit evidence.' });
  } catch (e) {
    if (e instanceof ServiceError) back(caseId, { err: errText(e) });
    throw e;
  }
}

export async function confirmPlanAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  const confirmations = formData.getAll('confirmations').map((v) => String(v));
  try {
    await confirmAssignmentPlan(actor, caseId, confirmations);
    revalidatePath(`/cases/${caseId}/assignment`);
    back(caseId, { ok: 'Assignment plan confirmed; the case is ready for activation.' });
  } catch (e) {
    if (e instanceof ServiceError) back(caseId, { err: errText(e) });
    throw e;
  }
}
