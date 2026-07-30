'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ServiceError,
  approveRecipient,
  suspendRecipient,
  upsertRecipient,
  verifyRecipient,
} from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function back(opts: { err?: string; ok?: string }): never {
  const p = new URLSearchParams();
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  redirect(`/admin/recipients?${p.toString()}`);
}

function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.details.length ? e.details.join('|') : e.message;
  return 'Something went wrong.';
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();

export async function upsertRecipientAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await upsertRecipient(
      actor,
      {
        recipientClass: str(formData, 'recipientClass'),
        displayName: str(formData, 'displayName'),
        destination: str(formData, 'destination'),
        allowedTypes: formData.getAll('allowedTypes').map(String),
        changeReason: str(formData, 'changeReason'),
      },
      str(formData, 'existingId') || undefined,
    );
    revalidatePath('/admin/recipients');
    back({ ok: 'Recipient saved (pending approval; verification reset).' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function approveRecipientAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await approveRecipient(actor, str(formData, 'id'));
    revalidatePath('/admin/recipients');
    back({ ok: 'Recipient approved.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function verifyRecipientAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await verifyRecipient(actor, str(formData, 'id'));
    revalidatePath('/admin/recipients');
    back({ ok: 'Recipient verified via the development capture probe (no real message sent).' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function suspendRecipientAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await suspendRecipient(actor, str(formData, 'id'), str(formData, 'reason'));
    revalidatePath('/admin/recipients');
    back({ ok: 'Recipient suspended.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}
