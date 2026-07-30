'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ServiceError,
  activateCase,
  changeDepartureTypeAfterActivation,
  holdCase,
  reopenCase,
  resumeCase,
} from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function back(caseId: string, opts: { err?: string; ok?: string }): never {
  const p = new URLSearchParams();
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  redirect(`/cases/${caseId}/workflow?${p.toString()}`);
}

function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.details.length ? e.details.join('|') : e.message;
  return 'Something went wrong.';
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();

async function run(
  formData: FormData,
  fn: (actor: Parameters<typeof activateCase>[0], fd: FormData, caseId: string) => Promise<string>,
): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const caseId = str(formData, 'caseId');
  try {
    const ok = await fn(actor, formData, caseId);
    revalidatePath(`/cases/${caseId}/workflow`);
    back(caseId, { ok });
  } catch (e) {
    if (e instanceof ServiceError) back(caseId, { err: errText(e) });
    throw e;
  }
}

export async function activateWorkflowAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, _fd, caseId) => {
    await activateCase(actor, caseId);
    return 'Case activated - the workflow and its tasks have been created.';
  });
}

export async function holdCaseAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd, caseId) => {
    await holdCase(actor, caseId, str(fd, 'reason'));
    return 'Case placed on hold. Pause-eligible task due dates are suspended; security tasks are NOT paused.';
  });
}

export async function resumeCaseAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd, caseId) => {
    await resumeCase(actor, caseId, str(fd, 'reason'));
    return 'Case resumed. Pause-eligible due dates were shifted by the hold duration.';
  });
}

export async function supersedeWorkflowAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd, caseId) => {
    const newType = str(fd, 'newType') as
      'RESIGNATION_WITH_NOTICE' | 'IMMEDIATE_RESIGNATION' | 'TERMINATION';
    await changeDepartureTypeAfterActivation(actor, caseId, newType, str(fd, 'reason'));
    return 'Departure type corrected: the original workflow is preserved as SUPERSEDED and a replacement workflow was created.';
  });
}

export async function reopenCaseAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd, caseId) => {
    await reopenCase(actor, caseId, str(fd, 'reason'), str(fd, 'plan'));
    return 'Case reopened with an audited reactivation plan. The completed workflow is preserved.';
  });
}
