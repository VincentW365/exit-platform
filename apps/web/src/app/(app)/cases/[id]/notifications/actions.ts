'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ServiceError,
  captureNotificationForDev,
  prepareNotification,
  transitionNotification,
} from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function back(caseId: string, opts: { err?: string; ok?: string }): never {
  const p = new URLSearchParams();
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  redirect(`/cases/${caseId}/notifications?${p.toString()}`);
}

function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.details.length ? e.details.join('|') : e.message;
  return 'Something went wrong.';
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();

async function run(
  formData: FormData,
  fn: (
    actor: Parameters<typeof prepareNotification>[0],
    fd: FormData,
    caseId: string,
  ) => Promise<string>,
): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  try {
    const ok = await fn(actor, formData, caseId);
    revalidatePath(`/cases/${caseId}/notifications`);
    back(caseId, { ok });
  } catch (e) {
    if (e instanceof ServiceError) back(caseId, { err: errText(e) });
    throw e;
  }
}

export async function prepareNotificationAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd, caseId) => {
    await prepareNotification(actor, caseId, {
      notificationType: str(fd, 'notificationType'),
      applicabilityNote: str(fd, 'applicabilityNote') || undefined,
      manualNote: str(fd, 'manualNote') || undefined,
    });
    return 'Notification draft prepared from the approved template.';
  });
}

export async function notificationTransitionAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    const action = str(fd, 'action') as
      'submit' | 'approve' | 'return' | 'markReady' | 'recordManualSend' | 'cancel';
    await transitionNotification(actor, str(fd, 'recordId'), action, {
      reason: str(fd, 'reason') || undefined,
      method: str(fd, 'method') || undefined,
      destinationRef: str(fd, 'destinationRef') || undefined,
      sentNote: str(fd, 'sentNote') || undefined,
    });
    const messages: Record<string, string> = {
      submit: 'Submitted for approval.',
      approve: 'Notification approved and bound to its exact content checksum.',
      return: 'Returned to draft.',
      markReady: 'Marked ready for MANUAL sending. The system sends nothing.',
      recordManualSend: 'Manual send recorded (method + destination reference only).',
      cancel: 'Notification cancelled.',
    };
    return messages[action] ?? 'Done.';
  });
}

export async function captureDevAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    await captureNotificationForDev(actor, str(fd, 'recordId'));
    return 'Captured by the DEVELOPMENT adapter (TRAINING/TEST only). This is NOT a delivery.';
  });
}
