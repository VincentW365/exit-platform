'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ServiceError, addAssetRecoveryItem, setAssetDisposition } from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function back(caseId: string, opts: { err?: string; ok?: string }): never {
  const p = new URLSearchParams();
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  redirect(`/cases/${caseId}/assets?${p.toString()}`);
}

function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.details.length ? e.details.join('|') : e.message;
  return 'Something went wrong.';
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();

export async function addAssetAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  try {
    await addAssetRecoveryItem(actor, caseId, {
      assetType: str(formData, 'assetType'),
      label: str(formData, 'label'),
      identifier: str(formData, 'identifier') || undefined,
      serialNumber: str(formData, 'serialNumber') || undefined,
      responsibleDepartment: str(formData, 'responsibleDepartment') || 'HR',
      requiredForClearance: formData.get('requiredForClearance') === 'on',
    });
    revalidatePath(`/cases/${caseId}/assets`);
    back(caseId, { ok: 'Asset recovery item added.' });
  } catch (e) {
    if (e instanceof ServiceError) back(caseId, { err: errText(e) });
    throw e;
  }
}

export async function assetDispositionAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  try {
    await setAssetDisposition(actor, str(formData, 'itemId'), {
      status: str(formData, 'status'),
      condition: str(formData, 'condition') || undefined,
      remarks: str(formData, 'remarks') || undefined,
      reason: str(formData, 'reason') || undefined,
    });
    revalidatePath(`/cases/${caseId}/assets`);
    back(caseId, {
      ok: 'Asset status recorded. Asset dispositions never affect pay - unresolved items surface a review exception only.',
    });
  } catch (e) {
    if (e instanceof ServiceError) back(caseId, { err: errText(e) });
    throw e;
  }
}
