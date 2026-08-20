'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ServiceError, setRoute } from '@exit/db';
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

/** Change where one notification type is addressed. */
export async function setRouteAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const notificationType = str(formData, 'notificationType');
  try {
    await setRoute(actor, {
      notificationType,
      to: str(formData, 'to'),
      cc: formData.getAll('cc').map((v) => String(v)),
      bcc: formData.getAll('bcc').map((v) => String(v)),
      note: str(formData, 'note') || undefined,
    });
    revalidatePath('/admin/email-routing');
    back({ ok: 'Routing updated. New notifications of this type use it immediately.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}
