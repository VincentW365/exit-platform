'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ServiceError,
  blockTask,
  completeAccessTask,
  completeTask,
  correctCompletedTask,
  reassignTask,
  startTask,
  unblockTask,
  updateAccessSystems,
  waiveTask,
} from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function back(taskId: string, opts: { err?: string; ok?: string }): never {
  const p = new URLSearchParams();
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  redirect(`/tasks/${taskId}?${p.toString()}`);
}

function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.details.length ? e.details.join('|') : e.message;
  return 'Something went wrong.';
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();

async function run(
  formData: FormData,
  fn: (actor: Parameters<typeof startTask>[0], fd: FormData, taskId: string) => Promise<string>,
): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const taskId = str(formData, 'taskId');
  try {
    const ok = await fn(actor, formData, taskId);
    revalidatePath(`/tasks/${taskId}`);
    back(taskId, { ok });
  } catch (e) {
    if (e instanceof ServiceError) back(taskId, { err: errText(e) });
    throw e;
  }
}

export async function startTaskAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, _fd, taskId) => {
    await startTask(actor, taskId);
    return 'Task started.';
  });
}

export async function completeTaskAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd, taskId) => {
    await completeTask(actor, taskId, str(fd, 'note') || undefined);
    return 'Task completed with evidence.';
  });
}

export async function blockTaskAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd, taskId) => {
    await blockTask(actor, taskId, str(fd, 'reason'), str(fd, 'blockerOwner') || undefined);
    return 'Task marked blocked; the blocker is visible in the exception feed.';
  });
}

export async function unblockTaskAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, _fd, taskId) => {
    await unblockTask(actor, taskId);
    return 'Blocker cleared; the task is back in progress.';
  });
}

export async function waiveTaskAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd, taskId) => {
    await waiveTask(actor, taskId, str(fd, 'reason'));
    return 'Task waived with a recorded reason.';
  });
}

export async function reassignTaskAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd, taskId) => {
    await reassignTask(actor, taskId, str(fd, 'assigneeId'), str(fd, 'reason'));
    return 'Task reassigned.';
  });
}

export async function correctTaskAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd, taskId) => {
    await correctCompletedTask(actor, taskId, {
      field: 'completionNote',
      correctedValue: str(fd, 'correctedValue'),
      reason: str(fd, 'reason'),
      clearanceEffect: str(fd, 'clearanceEffect') || undefined,
    });
    return 'Correction recorded (original value preserved in the correction history).';
  });
}

export async function updateAccessSystemsAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd, taskId) => {
    const systems = str(fd, 'systems')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    await updateAccessSystems(actor, taskId, systems);
    return 'Access systems list updated.';
  });
}

export async function completeAccessTaskAction(formData: FormData): Promise<void> {
  await run(formData, async (actor, fd, taskId) => {
    const split = (v: string) =>
      v
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
    const result = await completeAccessTask(actor, taskId, {
      systemsCompleted: split(str(fd, 'systemsCompleted')),
      systemsUnresolved: split(str(fd, 'systemsUnresolved')),
      note: str(fd, 'note'),
      earlyCompletionReason: str(fd, 'earlyCompletionReason') || undefined,
      incidentRef: str(fd, 'incidentRef') || undefined,
    });
    return result.result === 'PARTIAL'
      ? 'Partial completion recorded: unresolved systems keep the task blocked with a CRITICAL exception.'
      : `Access revocation recorded: ${result.result}${
          (result.lateMinutes ?? 0) > 0 ? ` (${result.lateMinutes} minutes after the due time)` : ''
        }.`;
  });
}
