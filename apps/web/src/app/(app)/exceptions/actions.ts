'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ServiceError, resolveException } from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === 'string' ? v.trim() : '';
}

/** Directive 6.2 (Y): exceptions are resolvable directly from the feed. */
export async function resolveFeedExceptionAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const query = str(formData, 'query');
  try {
    await resolveException(
      actor,
      str(formData, 'exceptionId'),
      str(formData, 'resolution'),
      formData.get('securityException') === 'on',
    );
    revalidatePath('/exceptions');
    redirect(
      `/exceptions?${query ? `${query}&` : ''}ok=${encodeURIComponent('Exception resolved (audited).')}`,
    );
  } catch (e) {
    if (e instanceof ServiceError) {
      const msg = e.details.length ? e.details.join(' ') : e.message;
      redirect(`/exceptions?${query ? `${query}&` : ''}err=${encodeURIComponent(msg)}`);
    }
    throw e;
  }
}
