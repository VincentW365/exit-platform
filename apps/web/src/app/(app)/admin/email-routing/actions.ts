'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ServiceError, setDepartmentMailbox, setTestMode } from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function back(opts: { err?: string; ok?: string }): never {
  const p = new URLSearchParams();
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  redirect(`/admin/email-routing?${p.toString()}`);
}

function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.details.length ? e.details.join('|') : e.message;
  return 'Something went wrong.';
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();

/** Point a department at a mailbox. */
export async function setMailboxAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await setDepartmentMailbox(actor, {
      destination: str(formData, 'destination'),
      email: str(formData, 'email'),
      reason: str(formData, 'reason') || undefined,
    });
    revalidatePath('/admin/email-routing');
    back({ ok: 'Mailbox saved. Notifications addressed to that department go there from now on.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

/** Send everything to one address, or stop doing so. */
export async function setTestAddressAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const enabled = str(formData, 'enabled') === 'on';
  try {
    const cfg = await setTestMode(actor, {
      enabled,
      redirectTo: str(formData, 'redirectTo'),
      note: 'Set from Email Routing.',
    });
    revalidatePath('/admin/email-routing');
    revalidatePath('/admin/outbox');
    back({
      ok: cfg.enabled
        ? `Every message now goes to ${cfg.redirectTo}, marked as a test and naming its real recipients.`
        : 'Messages go to their configured mailboxes again.',
    });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}
