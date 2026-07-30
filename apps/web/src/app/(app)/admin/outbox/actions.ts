'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ServiceError,
  cancelOutbox,
  processOutbox,
  resolveDeadLetter,
  retryOutbox,
} from '@exit/db';
import { can } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function back(opts: { err?: string; ok?: string }): never {
  const p = new URLSearchParams();
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  redirect(`/admin/outbox?${p.toString()}`);
}

function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.details.length ? e.details.join('|') : e.message;
  return 'Something went wrong.';
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();

export async function retryOutboxAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await retryOutbox(actor, str(formData, 'id'), str(formData, 'reason'));
    revalidatePath('/admin/outbox');
    back({ ok: 'Record queued for retry (audited).' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function cancelOutboxAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await cancelOutbox(actor, str(formData, 'id'), str(formData, 'reason'));
    revalidatePath('/admin/outbox');
    back({ ok: 'Record cancelled before submission.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function resolveDeadLetterAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await resolveDeadLetter(actor, str(formData, 'id'), str(formData, 'resolution'));
    revalidatePath('/admin/outbox');
    back({ ok: 'Dead-letter record resolved with audit evidence.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function runOutboxNowAction(): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  if (!can(actor, 'outbox.view')) back({ err: 'Not authorized.' });
  const result = await processOutbox(new Date());
  revalidatePath('/admin/outbox');
  back({
    ok: `Outbox pass: ${result.submitted} submitted, ${result.failed} retryable failure(s), ${result.deadLettered} dead-lettered.`,
  });
}
