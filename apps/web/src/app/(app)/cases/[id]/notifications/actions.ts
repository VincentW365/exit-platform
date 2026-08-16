'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ServiceError,
  captureNotificationForDev,
  prepareNotification,
  recordManualEvidence,
  setCaseRecipient,
  transitionNotification,
} from '@exit/db';
import { EVIDENCE_CHANNELS, type EvidenceChannel } from '@exit/domain';
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

/** Directive 6.3 S: release a waiting email action (transition "approve"). */
export async function approveEmailAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    await transitionNotification(actor, str(fd, 'recordId'), 'approve');
    return 'Released. Sending and confirmation are tracked automatically.';
  });
}

/** Directive 6.3 O: enter a missing recipient for this case (optionally saved). */
export async function setCaseRecipientAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    const saveForFuture = fd.get('saveForFuture') === 'on';
    await setCaseRecipient(actor, str(fd, 'recordId'), {
      recipientName: str(fd, 'recipientName'),
      organization: str(fd, 'organization'),
      email: str(fd, 'email'),
      saveForFuture,
    });
    return saveForFuture
      ? 'Recipient recorded for this case and submitted to the approved recipient directory (approval and verification still apply).'
      : 'Recipient recorded for this case.';
  });
}

/** Directive 6.3 T: HR-recorded acknowledgement / completion evidence. */
export async function recordEvidenceAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd) => {
    const kind =
      str(fd, 'kind') === 'COMPLETED' ? ('COMPLETED' as const) : ('ACKNOWLEDGED' as const);
    const channelRaw = str(fd, 'channel');
    const channel: EvidenceChannel = (EVIDENCE_CHANNELS as readonly string[]).includes(channelRaw)
      ? (channelRaw as EvidenceChannel)
      : 'OTHER';
    await recordManualEvidence(actor, str(fd, 'recordId'), {
      kind,
      channel,
      note: str(fd, 'note'),
    });
    return kind === 'COMPLETED'
      ? 'Completion evidence recorded.'
      : 'Acknowledgement evidence recorded.';
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
      submit: 'Submitted for review.',
      approve: 'Released. Sending and confirmation are tracked automatically.',
      return: 'Returned for correction.',
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
