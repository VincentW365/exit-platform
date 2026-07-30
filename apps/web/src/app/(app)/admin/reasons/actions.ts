'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ServiceError,
  approveReasonCategory,
  retireReasonCategory,
  upsertReasonCategory,
} from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function back(opts: { err?: string; ok?: string }): never {
  const p = new URLSearchParams();
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  redirect(`/admin/reasons?${p.toString()}`);
}

function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.details.length ? e.details.join('|') : e.message;
  return 'Something went wrong.';
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();

export async function upsertReasonAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await upsertReasonCategory(actor, {
      code: str(formData, 'code'),
      label: str(formData, 'label'),
      description: str(formData, 'description') || undefined,
      voluntary:
        str(formData, 'voluntary') === 'true'
          ? true
          : str(formData, 'voluntary') === 'false'
            ? false
            : null,
      departureTypes: formData.getAll('departureTypes').map(String),
      reportingGroup: str(formData, 'reportingGroup') || undefined,
      sortOrder: str(formData, 'sortOrder') || 0,
      sensitive: formData.get('sensitive') === 'on',
      changeReason: str(formData, 'changeReason'),
    });
    revalidatePath('/admin/reasons');
    back({ ok: 'Reason category saved as a new unapproved version.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function approveReasonAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await approveReasonCategory(actor, str(formData, 'id'));
    revalidatePath('/admin/reasons');
    back({ ok: 'Category version approved and activated.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function retireReasonAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await retireReasonCategory(actor, str(formData, 'id'), str(formData, 'reason'));
    revalidatePath('/admin/reasons');
    back({ ok: 'Category retired; historical cases keep their recorded category.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}
