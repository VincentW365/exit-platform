'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ServiceError,
  cancelInvitation,
  createInvitation,
  generateInvitationToken,
  markNotEligible,
  recordDeclined,
  recordInvalidContact,
  recordManualSent,
  recordReminderSent,
  recordVerbalDebrief,
} from '@exit/db';
import type { AnswerInput } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function back(caseId: string, opts: { err?: string; ok?: string; link?: string }): never {
  const p = new URLSearchParams();
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  if (opts.link) p.set('link', opts.link);
  redirect(`/cases/${caseId}/survey?${p.toString()}`);
}

function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.details.length ? e.details.join('|') : e.message;
  return 'Something went wrong.';
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();

export async function createInvitationAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  try {
    await createInvitation(actor, caseId, str(formData, 'overrideReason') || undefined);
    revalidatePath(`/cases/${caseId}/survey`);
    back(caseId, { ok: 'Invitation created.' });
  } catch (e) {
    if (e instanceof ServiceError) back(caseId, { err: errText(e) });
    throw e;
  }
}

export async function generateTokenAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  try {
    const { rawToken } = await generateInvitationToken(actor, str(formData, 'invitationId'));
    revalidatePath(`/cases/${caseId}/survey`);
    // The raw token is shown ONCE for HR to copy; it is never stored or logged.
    back(caseId, {
      ok: 'Secure link generated. Copy it now - it is shown only once.',
      link: `/survey/${rawToken}`,
    });
  } catch (e) {
    if (e instanceof ServiceError) back(caseId, { err: errText(e) });
    throw e;
  }
}

async function simple(
  formData: FormData,
  fn: (actor: never, fd: FormData) => Promise<string>,
): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  try {
    const ok = await fn(actor as never, formData);
    revalidatePath(`/cases/${caseId}/survey`);
    back(caseId, { ok });
  } catch (e) {
    if (e instanceof ServiceError) back(caseId, { err: errText(e) });
    throw e;
  }
}

export async function markSentAction(formData: FormData): Promise<void> {
  await simple(formData, async (actor, fd) => {
    await recordManualSent(actor, str(fd, 'invitationId'));
    return 'Recorded as manually sent; reminder and expiry dates are scheduled.';
  });
}

export async function reminderAction(formData: FormData): Promise<void> {
  await simple(formData, async (actor, fd) => {
    await recordReminderSent(
      actor,
      str(fd, 'invitationId'),
      Number(str(fd, 'which')) === 2 ? 2 : 1,
    );
    return 'Reminder recorded as manually sent.';
  });
}

export async function cancelInvitationAction(formData: FormData): Promise<void> {
  await simple(formData, async (actor, fd) => {
    await cancelInvitation(actor, str(fd, 'invitationId'), str(fd, 'note'));
    return 'Invitation cancelled and link invalidated.';
  });
}

export async function invalidContactAction(formData: FormData): Promise<void> {
  await simple(formData, async (actor, fd) => {
    await recordInvalidContact(actor, str(fd, 'invitationId'), str(fd, 'note'));
    return 'Invalid contact information recorded.';
  });
}

export async function notEligibleAction(formData: FormData): Promise<void> {
  await simple(formData, async (actor, fd) => {
    await markNotEligible(actor, str(fd, 'invitationId'), str(fd, 'note'));
    return 'Marked not eligible.';
  });
}

export async function declinedAction(formData: FormData): Promise<void> {
  await simple(formData, async (actor, fd) => {
    await recordDeclined(actor, str(fd, 'invitationId'), str(fd, 'note'));
    return 'Recorded as declined.';
  });
}

export async function verbalDebriefAction(formData: FormData): Promise<void> {
  await simple(formData, async (actor, fd) => {
    const answers: AnswerInput[] = [];
    for (const [key, value] of fd.entries()) {
      const m = /^q:(.+):(rating|choice|text)$/.exec(key);
      if (!m || typeof value !== 'string' || !value.trim()) continue;
      const questionId = m[1]!;
      const existing = answers.find((a) => a.questionId === questionId) ?? {
        questionId,
        choices: [] as string[],
        rating: null as number | null,
        text: null as string | null,
      };
      if (m[2] === 'rating') existing.rating = Number(value);
      else if (m[2] === 'choice') (existing.choices as string[]).push(value);
      else existing.text = value;
      if (!answers.includes(existing)) answers.push(existing);
    }
    await recordVerbalDebrief(actor, str(fd, 'invitationId'), answers);
    return 'Verbal debrief recorded (marked as recorded by HR).';
  });
}
