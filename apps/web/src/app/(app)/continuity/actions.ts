'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ServiceError,
  closeOutage,
  declareOutage,
  reconcileFallbackEntry,
  recordFallbackEntry,
} from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function back(opts: { err?: string; ok?: string }): never {
  const p = new URLSearchParams();
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  redirect(`/continuity?${p.toString()}`);
}

function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.details.length ? e.details.join('|') : e.message;
  return 'Something went wrong.';
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();

export async function declareOutageAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await declareOutage(actor, str(formData, 'title'), str(formData, 'note') || undefined);
    revalidatePath('/continuity');
    back({ ok: 'Outage declared; manual fallback processes are now in effect.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function recordEntryAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    const entry = await recordFallbackEntry(actor, {
      outageId: str(formData, 'outageId'),
      kind: str(formData, 'kind'),
      summary: str(formData, 'summary'),
    });
    revalidatePath('/continuity');
    back({ ok: `Manual record captured with controlled reference ${entry.refNumber}.` });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function reconcileEntryAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await reconcileFallbackEntry(
      actor,
      str(formData, 'entryId'),
      str(formData, 'caseId') || null,
      str(formData, 'note'),
    );
    revalidatePath('/continuity');
    back({ ok: 'Entry reconciled; duplicates are prevented by the one-time reconciliation.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function closeOutageAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await closeOutage(actor, str(formData, 'outageId'), str(formData, 'note'));
    revalidatePath('/continuity');
    back({ ok: 'Outage closed after full reconciliation.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}
