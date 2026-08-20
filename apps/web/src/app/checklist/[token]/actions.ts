'use server';

import { redirect } from 'next/navigation';
import {
  getActionByToken,
  redeemActionToken,
  ServiceError,
  submitReturnItemsChecklist,
} from '@exit/db';
import { RETURN_ITEM_CATALOGUE } from '@exit/domain';

/**
 * Public no-login checklist submission (owner directive, 2026-08-19).
 *
 * Same rate-limiting shape as /ack: per token prefix AND a module-wide
 * counter, roughly 30 attempts per minute. Development-grade, no external
 * dependencies - the token claim itself stays single-use atomic.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const buckets = new Map<string, { count: number; resetAt: number }>();
let globalCount = 0;
let globalResetAt = 0;

function rateLimited(prefix: string): boolean {
  const now = Date.now();
  if (globalResetAt < now) {
    globalResetAt = now + WINDOW_MS;
    globalCount = 0;
  }
  globalCount += 1;
  if (globalCount > MAX_PER_WINDOW) return true;
  const b = buckets.get(prefix);
  if (!b || b.resetAt < now) {
    if (buckets.size > 1000) buckets.clear();
    buckets.set(prefix, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  b.count += 1;
  return b.count > MAX_PER_WINDOW;
}

const str = (fd: FormData, k: string, max: number): string =>
  String(fd.get(k) ?? '')
    .trim()
    .slice(0, max);

export async function submitChecklistAction(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '').slice(0, 128);
  const path = `/checklist/${encodeURIComponent(token)}`;

  if (rateLimited(token.slice(0, 8))) redirect(`${path}?retry=1`);

  // The row count is fixed by the catalogue, so a padded form cannot grow it.
  const items = RETURN_ITEM_CATALOGUE.map((_, index) => ({
    itemKey: str(formData, `item.${index}.key`, 64),
    status: str(formData, `item.${index}.status`, 32),
    remarks: str(formData, `item.${index}.remarks`, 500) || undefined,
  })).filter((i) => i.itemKey && i.status);

  const input = {
    items,
    receivedByName: str(formData, 'receivedByName', 120),
    receivedAt: str(formData, 'receivedAt', 10) || undefined,
    submittedByName: str(formData, 'submittedByName', 120),
    employeeAcknowledgedBy: str(formData, 'employeeAcknowledgedBy', 120) || undefined,
  };

  // Resolve the case from the token itself; the form never carries a case id.
  const action = await getActionByToken(token);
  if (!action || action.purpose !== 'COMPLETE_RETURN_CHECKLIST') redirect(path);

  try {
    await submitReturnItemsChecklist(action.caseId, input, { via: 'TOKEN' });
  } catch (e) {
    if (e instanceof ServiceError) {
      const detail = e.details.length ? e.details.join('|') : e.message;
      redirect(`${path}?err=${encodeURIComponent(detail.slice(0, 900))}`);
    }
    throw e;
  }

  // Submission succeeded, so the link is spent. A failure here must not undo
  // the recorded checklist - the confirmation page renders either way.
  try {
    await redeemActionToken(token);
  } catch {
    // Neutral: the sweep expires the token if this never lands.
  }
  redirect(`${path}?done=1`);
}
