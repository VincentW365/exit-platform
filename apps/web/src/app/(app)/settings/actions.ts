'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ServiceError, clearPersonalBanner, setPersonalBanner } from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function back(opts: { err?: string; ok?: string }): never {
  const p = new URLSearchParams();
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  redirect(`/settings?${p.toString()}`);
}

function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.details.length ? e.details.join('|') : e.message;
  return 'Something went wrong.';
}

/** A user uploads their OWN personal signature banner (a JPG; audited). */
export async function uploadPersonalBannerAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const file = formData.get('bannerFile');
  try {
    if (!(file instanceof File) || file.size === 0)
      throw ServiceError.validation(['Choose a .jpg file to upload.']);
    const banner = await setPersonalBanner(actor, {
      fileName: file.name,
      declaredMime: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    revalidatePath('/settings');
    back({ ok: `Personal email banner saved (${banner.width} × ${banner.height} px).` });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function clearPersonalBannerAction(): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await clearPersonalBanner(actor);
    revalidatePath('/settings');
    back({ ok: 'Personal email banner removed.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}
