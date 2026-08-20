'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ServiceError,
  addAssetRecoveryItem,
  recordReturnItemsChecklist,
  setAssetDisposition,
} from '@exit/db';
import { RETURN_ITEM_CATALOGUE } from '@exit/domain';
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

/**
 * HR records the Exit Checklist for Return Items themselves - the signed paper
 * form came back, or something submitted through the secure link needs
 * correcting.
 */
export async function recordChecklistAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  // The row count is fixed by the catalogue, so a padded form cannot grow it.
  const items = RETURN_ITEM_CATALOGUE.map((_, index) => ({
    itemKey: String(formData.get(`item.${index}.key`) ?? '').trim(),
    status: String(formData.get(`item.${index}.status`) ?? '').trim(),
    remarks: String(formData.get(`item.${index}.remarks`) ?? '')
      .trim()
      .slice(0, 500),
  })).filter((i) => i.itemKey && i.status);
  try {
    const outcome = await recordReturnItemsChecklist(actor, caseId, {
      items: items.map((i) => ({ ...i, remarks: i.remarks || undefined })),
      receivedByName: str(formData, 'receivedByName'),
      receivedAt: str(formData, 'receivedAt') || undefined,
      submittedByName: str(formData, 'submittedByName'),
      employeeAcknowledgedBy: str(formData, 'employeeAcknowledgedBy') || undefined,
    });
    revalidatePath(`/cases/${caseId}/assets`);
    back(caseId, {
      ok:
        outcome.unresolvedCount > 0
          ? `Checklist saved with ${outcome.unresolvedCount} item(s) still outstanding.`
          : 'Checklist saved.',
    });
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
