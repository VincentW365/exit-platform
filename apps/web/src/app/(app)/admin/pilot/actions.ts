'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ServiceError,
  applyActivation,
  approveActivation,
  proposeActivation,
  suspendActivation,
} from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function back(opts: { err?: string; ok?: string }): never {
  const p = new URLSearchParams();
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  redirect(`/admin/pilot?${p.toString()}`);
}

function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.details.length ? e.details.join('|') : e.message;
  return 'Something went wrong.';
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();

export async function proposeActivationAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    const list = (k: string) =>
      str(formData, k)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    await proposeActivation(actor, {
      targetState: str(formData, 'targetState'),
      cohort: str(formData, 'cohort') || 'PILOT',
      scope: {
        departments: list('departments'),
        locations: list('locations'),
        departureTypes: list('departureTypes'),
        maxActiveCases: str(formData, 'maxActiveCases')
          ? Number(str(formData, 'maxActiveCases'))
          : null,
      },
      enabledIntegrations: list('enabledIntegrations'),
      conditions: str(formData, 'conditions') || undefined,
      rollbackPlan: str(formData, 'rollbackPlan'),
    });
    revalidatePath('/admin/pilot');
    back({ ok: 'Activation proposal recorded; approvals required before it applies.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function approveActivationAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    const role = str(formData, 'role');
    if (role !== 'hr' && role !== 'admin')
      throw ServiceError.validation(['Unknown approval role.']);
    await approveActivation(actor, str(formData, 'id'), role);
    revalidatePath('/admin/pilot');
    back({ ok: 'Approval recorded.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function applyActivationAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    const result = await applyActivation(actor, str(formData, 'id'));
    revalidatePath('/admin/pilot');
    back({ ok: `Activation applied: environment state is now ${result.state}.` });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function suspendActivationAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await suspendActivation(actor, str(formData, 'reason'));
    revalidatePath('/admin/pilot');
    back({ ok: 'SUSPENDED: new automated integration work is stopped; evidence preserved.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}
