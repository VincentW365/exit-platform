'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ServiceError,
  activateNotificationTemplate,
  draftNotificationTemplate,
  retireNotificationTemplate,
  testSendNotificationTemplate,
} from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

const PATH = '/admin/notification-templates';

function back(opts: { err?: string; ok?: string; preview?: string }): never {
  const p = new URLSearchParams();
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  if (opts.preview) p.set('preview', opts.preview);
  redirect(`${PATH}?${p.toString()}`);
}

function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.details.length ? e.details.join('|') : e.message;
  return 'Something went wrong.';
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();

export async function draftNotifTemplateAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await draftNotificationTemplate(actor, {
      notificationType: str(formData, 'notificationType'),
      name: str(formData, 'name'),
      subjectTemplate: str(formData, 'subjectTemplate'),
      bodyTemplate: str(formData, 'bodyTemplate'),
      minimumDataNote: str(formData, 'minimumDataNote'),
      changeReason: str(formData, 'changeReason'),
    });
    revalidatePath(PATH);
    back({ ok: 'Draft version created. Activation requires HR Manager authority.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function testSendNotifTemplateAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const templateId = str(formData, 'templateId');
  try {
    // Renders with synthetic sample values and audits the test; nothing is
    // delivered anywhere except the development capture destination.
    await testSendNotificationTemplate(actor, templateId);
    revalidatePath(PATH);
    back({
      ok: 'Test send recorded against the development capture destination. The rendered output is shown below.',
      preview: templateId,
    });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function activateNotifTemplateAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await activateNotificationTemplate(actor, str(formData, 'templateId'));
    revalidatePath(PATH);
    back({ ok: 'Version activated. The prior active version was superseded.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function retireNotifTemplateAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await retireNotificationTemplate(actor, str(formData, 'templateId'), str(formData, 'reason'));
    revalidatePath(PATH);
    back({ ok: 'Draft retired.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}
