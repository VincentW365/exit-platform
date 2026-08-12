'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ServiceError, createUserFromDirectory, enableUser } from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function back(params: Record<string, string>): never {
  redirect(`/admin/organization?${new URLSearchParams(params).toString()}`);
}

function errText(e: ServiceError): string {
  return e.details.length ? e.details.join(' ') : e.message;
}

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === 'string' ? v.trim() : '';
}

/** Directive 6.2 (E): map a directory person to an application account. */
export async function mapDirectoryPersonAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    const person = str(formData, 'person'); // "sourceSystem|sourceId"
    const sep = person.indexOf('|');
    if (sep < 1) throw ServiceError.validation(['Select a directory person.']);
    const roles = formData.getAll('roles').filter((r): r is string => typeof r === 'string');
    const created = await createUserFromDirectory(actor, {
      sourceSystem: person.slice(0, sep),
      sourceId: person.slice(sep + 1),
      roles,
      reason: str(formData, 'reason'),
    });
    revalidatePath('/admin/organization');
    back({ ok: `Account created and roles granted for ${created.displayName} (audited).` });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function enableDirectoryAccountAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await enableUser(actor, str(formData, 'userId'), str(formData, 'reason'));
    revalidatePath('/admin/organization');
    back({ ok: 'Account re-enabled (audited).' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}
