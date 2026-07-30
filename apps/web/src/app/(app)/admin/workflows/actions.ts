'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ServiceError,
  activateWorkflowDefinition,
  createWorkflowDraft,
  retireWorkflowDefinition,
  updateWorkflowDraft,
} from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function back(opts: { err?: string; ok?: string; id?: string }): never {
  const p = new URLSearchParams();
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  const base = opts.id ? `/admin/workflows/${opts.id}` : '/admin/workflows';
  redirect(`${base}?${p.toString()}`);
}

function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.details.length ? e.details.join('|') : e.message;
  return 'Something went wrong.';
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();

function parseTasks(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw ServiceError.validation(['The task list must be valid JSON (an array of task objects).']);
  }
}

export async function createDraftAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const sourceId = str(formData, 'sourceId') || undefined;
  try {
    const def = await createWorkflowDraft(
      actor,
      str(formData, 'workflowType') as
        'RESIGNATION_WITH_NOTICE' | 'IMMEDIATE_RESIGNATION' | 'TERMINATION',
      {
        name: str(formData, 'name'),
        description: str(formData, 'description'),
        activationConditions: str(formData, 'activationConditions'),
        changeReason: str(formData, 'changeReason'),
        tasks: parseTasks(String(formData.get('tasks') ?? '[]')),
      },
    );
    revalidatePath('/admin/workflows');
    back({ ok: `Draft version ${def.version} created.`, id: def.id });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e), id: sourceId });
    throw e;
  }
}

export async function updateDraftAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const id = str(formData, 'definitionId');
  try {
    await updateWorkflowDraft(actor, id, {
      name: str(formData, 'name'),
      description: str(formData, 'description'),
      activationConditions: str(formData, 'activationConditions'),
      changeReason: str(formData, 'changeReason'),
      tasks: parseTasks(String(formData.get('tasks') ?? '[]')),
    });
    revalidatePath(`/admin/workflows/${id}`);
    back({ ok: 'Draft updated.', id });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e), id });
    throw e;
  }
}

export async function activateDefinitionAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const id = str(formData, 'definitionId');
  try {
    await activateWorkflowDefinition(actor, id);
    revalidatePath('/admin/workflows');
    back({
      ok: 'Version activated; any prior active version is superseded. Existing cases keep their pinned versions.',
      id,
    });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e), id });
    throw e;
  }
}

export async function retireDefinitionAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const id = str(formData, 'definitionId');
  try {
    await retireWorkflowDefinition(actor, id, str(formData, 'reason'));
    revalidatePath('/admin/workflows');
    back({ ok: 'Version retired.', id });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e), id });
    throw e;
  }
}
