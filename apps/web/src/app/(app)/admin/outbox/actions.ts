'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ServiceError,
  cancelOutbox,
  processOutbox,
  resolveDeadLetter,
  retryOutbox,
  setTestMode,
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

/**
 * One pass moves a bounded batch, so an administrator pressing this once on a
 * deep queue would otherwise leave most of it untouched and have to press
 * again. Drain until nothing more is due, bounded so a persistently failing
 * queue can never spin.
 */
const MAX_PASSES = 10;

/** Turn rehearsal mode on or off (HR samples directive section 8). */
export async function setTestModeAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const enabled = str(formData, 'enabled') === 'on';
  try {
    const cfg = await setTestMode(actor, {
      enabled,
      redirectTo: str(formData, 'redirectTo'),
      note: str(formData, 'note') || undefined,
    });
    revalidatePath('/admin/outbox');
    back({
      ok: cfg.enabled
        ? 'Rehearsal mode is ON. Every outgoing message is diverted and marked as a test.'
        : 'Rehearsal mode is off. Messages go to their real recipients again.',
    });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function runOutboxNowAction(): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  if (!can(actor, 'outbox.view')) back({ err: 'Not authorized.' });
  const total = { submitted: 0, failed: 0, deadLettered: 0 };
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const result = await processOutbox(new Date());
    total.submitted += result.submitted;
    total.failed += result.failed;
    total.deadLettered += result.deadLettered;
    if (result.submitted + result.failed + result.deadLettered === 0) break;
  }
  revalidatePath('/admin/outbox');
  back({
    ok: `Outbox pass: ${total.submitted} submitted, ${total.failed} retryable failure(s), ${total.deadLettered} dead-lettered.`,
  });
}
