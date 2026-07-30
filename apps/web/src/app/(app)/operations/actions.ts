'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ServiceError, recordTraining } from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

export async function recordTrainingAction(formData: FormData): Promise<void> {
  const { actor, user } = await requireAuth();
  await touchSession();
  const moduleName = String(formData.get('module') ?? '').trim();
  try {
    await recordTraining(actor, moduleName, user.roles[0] ?? 'HR_OFFICER');
    revalidatePath('/operations');
    redirect(
      `/operations?ok=${encodeURIComponent(`Training recorded: ${moduleName} (not formal certification).`)}`,
    );
  } catch (e) {
    if (e instanceof ServiceError)
      redirect(`/operations?err=${encodeURIComponent(e.details.join('|') || e.message)}`);
    throw e;
  }
}
