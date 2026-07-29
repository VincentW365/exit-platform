'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ServiceError,
  addConfigItem,
  grantRole,
  publishCalendarVersion,
  revokeRole,
  setFlag,
} from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function done(opts: { err?: string; ok?: string }): never {
  const p = new URLSearchParams();
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  redirect(`/admin?${p.toString()}`);
}

function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.details.length ? e.details.join('|') : e.message;
  return 'Something went wrong.';
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();

export async function grantRoleAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await grantRole(actor, str(formData, 'userId'), str(formData, 'role'), str(formData, 'reason'));
    revalidatePath('/admin');
    done({ ok: 'Role granted (audited).' });
  } catch (e) {
    if (e instanceof ServiceError) done({ err: errText(e) });
    throw e;
  }
}

export async function revokeRoleAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await revokeRole(
      actor,
      str(formData, 'userId'),
      str(formData, 'role'),
      str(formData, 'reason'),
    );
    revalidatePath('/admin');
    done({ ok: 'Role revoked (audited).' });
  } catch (e) {
    if (e instanceof ServiceError) done({ err: errText(e) });
    throw e;
  }
}

export async function setFlagAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await setFlag(
      actor,
      str(formData, 'key'),
      str(formData, 'enabled') === 'true',
      str(formData, 'reason'),
    );
    revalidatePath('/admin');
    done({ ok: 'Feature flag updated (audited).' });
  } catch (e) {
    if (e instanceof ServiceError) done({ err: errText(e) });
    throw e;
  }
}

export async function publishCalendarAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    const lines = str(formData, 'holidays')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [date, ...rest] = l.split(',');
        return { date: (date ?? '').trim(), label: rest.join(',').trim() };
      });
    await publishCalendarVersion(
      actor,
      str(formData, 'name') || 'business-calendar',
      lines,
      str(formData, 'reason'),
    );
    revalidatePath('/admin');
    done({ ok: 'New calendar version published and activated (audited).' });
  } catch (e) {
    if (e instanceof ServiceError) done({ err: errText(e) });
    throw e;
  }
}

export async function addConfigItemAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await addConfigItem(
      actor,
      str(formData, 'kind') as 'DEPARTMENT' | 'LOCATION',
      str(formData, 'value'),
    );
    revalidatePath('/admin');
    done({ ok: 'Value added (audited).' });
  } catch (e) {
    if (e instanceof ServiceError) done({ err: errText(e) });
    throw e;
  }
}
