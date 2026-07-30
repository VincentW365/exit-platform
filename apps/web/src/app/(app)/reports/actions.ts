'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ServiceError, createSchedule, toggleSchedule } from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function back(opts: { err?: string; ok?: string }): never {
  const p = new URLSearchParams();
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  redirect(`/reports?${p.toString()}`);
}

function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.details.length ? e.details.join('|') : e.message;
  return 'Something went wrong.';
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();

export async function createScheduleAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await createSchedule(actor, {
      reportKey: str(formData, 'reportKey'),
      name: str(formData, 'name'),
      frequency: str(formData, 'frequency'),
      recipientClass: str(formData, 'recipientClass'),
      filters: {},
    });
    revalidatePath('/reports');
    back({ ok: 'Schedule created. Development runs capture to the dev mailbox; no live email.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function toggleScheduleAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await toggleSchedule(actor, str(formData, 'id'), str(formData, 'active') === 'true');
    revalidatePath('/reports');
    back({ ok: 'Schedule updated.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}
