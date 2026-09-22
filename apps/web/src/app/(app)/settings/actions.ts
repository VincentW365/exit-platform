'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ServiceError, setEmailBanner } from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function back(opts: { err?: string; ok?: string }): never {
  const p = new URLSearchParams();
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  redirect(`/settings?${p.toString()}`);
}

/** A user saves or clears their own email banner (audited). */
export async function saveEmailBannerAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const text = String(formData.get('emailBanner') ?? '');
  try {
    const { banner } = await setEmailBanner(actor, text);
    revalidatePath('/settings');
    back({ ok: banner ? 'Email banner saved.' : 'Email banner removed.' });
  } catch (e) {
    if (e instanceof ServiceError)
      back({ err: e.details.length ? e.details.join('|') : e.message });
    throw e;
  }
}
