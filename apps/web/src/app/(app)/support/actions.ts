'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ServiceError, createTicket, updateTicket } from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function back(opts: { err?: string; ok?: string }): never {
  const p = new URLSearchParams();
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  redirect(`/support?${p.toString()}`);
}

function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.details.length ? e.details.join('|') : e.message;
  return 'Something went wrong.';
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();

export async function createTicketAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await createTicket(actor, {
      category: str(formData, 'category'),
      severity: str(formData, 'severity') || 'WARNING',
      title: str(formData, 'title'),
      description: str(formData, 'description'),
      affectedComponent: str(formData, 'affectedComponent') || undefined,
    });
    revalidatePath('/support');
    back({ ok: 'Support record created.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function updateTicketAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await updateTicket(actor, str(formData, 'id'), {
      status: (str(formData, 'status') || undefined) as never,
      resolution: str(formData, 'resolution') || undefined,
    });
    revalidatePath('/support');
    back({ ok: 'Support record updated.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}
