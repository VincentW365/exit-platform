'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ServiceError, claimTask, returnTaskToQueue } from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function back(query: string, opts: { err?: string; ok?: string }): never {
  const p = new URLSearchParams(query);
  p.delete('err');
  p.delete('ok');
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  redirect(`/queue?${p.toString()}`);
}

function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.details.length ? e.details.join('|') : e.message;
  return 'Something went wrong. The event was logged with a reference id.';
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();

export async function claimTaskAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const query = str(formData, 'query');
  try {
    await claimTask(actor, str(formData, 'taskId'));
    revalidatePath('/queue');
    back(query, { ok: 'Task claimed - it is now assigned to you (audited).' });
  } catch (e) {
    if (e instanceof ServiceError) back(query, { err: errText(e) });
    throw e;
  }
}

export async function returnTaskAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const query = str(formData, 'query');
  try {
    await returnTaskToQueue(actor, str(formData, 'taskId'), str(formData, 'reason'));
    revalidatePath('/queue');
    back(query, { ok: 'Task returned to the department queue (audited).' });
  } catch (e) {
    if (e instanceof ServiceError) back(query, { err: errText(e) });
    throw e;
  }
}
