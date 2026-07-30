'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ServiceError,
  addConfigItem,
  approveCalendar,
  grantRole,
  previewCalendarImpact,
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

/** Stage 4 (Directive 4 K.1): approve the active business calendar. */
export async function approveCalendarAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await approveCalendar(actor, str(formData, 'calendarId'));
    revalidatePath('/admin');
    done({ ok: 'Active calendar version approved (audited).' });
  } catch (e) {
    if (e instanceof ServiceError) done({ err: errText(e) });
    throw e;
  }
}

/** Stage 4 (K.5): preview SLA impact of a candidate holiday list. */
export async function previewCalendarAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    const holidays = str(formData, 'holidays')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [date, ...label] = line.split(',');
        return { date: (date ?? '').trim(), label: label.join(',').trim() || 'Holiday' };
      });
    const impact = await previewCalendarImpact(actor, holidays);
    const p = new URLSearchParams();
    p.set(
      'preview',
      `Preview: ${impact.evaluatedTasks} open task(s) evaluated; ${impact.changes.length} would change under the candidate calendar. ${impact.note}`.slice(
        0,
        900,
      ),
    );
    redirect(`/admin?${p.toString()}`);
  } catch (e) {
    if (e instanceof ServiceError) done({ err: errText(e) });
    throw e;
  }
}

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
