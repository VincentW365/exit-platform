'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ServiceError,
  activateTemplate,
  createDraftTemplate,
  retireTemplate,
  updateDraftTemplate,
} from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function back(opts: { err?: string; ok?: string }): never {
  const p = new URLSearchParams();
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  redirect(`/admin/templates?${p.toString()}`);
}

function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.details.length ? e.details.join('|') : e.message;
  return 'Something went wrong.';
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();

async function run(
  fn: (actor: never, fd: FormData) => Promise<string>,
  fd: FormData,
): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    const ok = await fn(actor as never, fd);
    revalidatePath('/admin/templates');
    back({ ok });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function createTemplateAction(formData: FormData): Promise<void> {
  await run(async (actor, fd) => {
    await createDraftTemplate(actor, {
      documentType: str(fd, 'documentType') as never,
      name: str(fd, 'name'),
      contentBody: String(fd.get('contentBody') ?? ''),
      changeReason: str(fd, 'changeReason') || undefined,
    });
    return 'Draft template version created.';
  }, formData);
}

export async function updateTemplateAction(formData: FormData): Promise<void> {
  await run(async (actor, fd) => {
    await updateDraftTemplate(actor, str(fd, 'templateId'), {
      name: str(fd, 'name') || undefined,
      contentBody: String(fd.get('contentBody') ?? ''),
      changeReason: str(fd, 'changeReason') || undefined,
    });
    return 'Draft template updated.';
  }, formData);
}

export async function activateTemplateAction(formData: FormData): Promise<void> {
  await run(async (actor, fd) => {
    await activateTemplate(actor, str(fd, 'templateId'));
    return 'Template activated; any prior active version is superseded.';
  }, formData);
}

export async function retireTemplateAction(formData: FormData): Promise<void> {
  await run(async (actor, fd) => {
    await retireTemplate(actor, str(fd, 'templateId'), str(fd, 'reason'));
    return 'Template retired.';
  }, formData);
}
