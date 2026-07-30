'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  ServiceError,
  createBackup,
  disableUser,
  generateAccessReview,
  reconciliationReport,
  restoreAndVerify,
  setSystemConfig,
  syncEmployees,
} from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { touchSession } from '@/lib/session';

function back(opts: { err?: string; ok?: string }): never {
  const p = new URLSearchParams();
  if (opts.err) p.set('err', opts.err.slice(0, 900));
  if (opts.ok) p.set('ok', opts.ok);
  redirect(`/admin/system?${p.toString()}`);
}

function errText(e: unknown): string {
  if (e instanceof ServiceError) return e.details.length ? e.details.join('|') : e.message;
  return 'Something went wrong.';
}

const str = (fd: FormData, k: string): string => String(fd.get(k) ?? '').trim();

export async function setConfigAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    const raw = str(formData, 'value');
    const value =
      raw === 'true' ? true : raw === 'false' ? false : /^\d+$/.test(raw) ? Number(raw) : raw;
    await setSystemConfig(
      actor,
      str(formData, 'key'),
      value,
      str(formData, 'reason'),
      str(formData, 'secretRef') || undefined,
    );
    revalidatePath('/admin/system');
    back({ ok: 'Configuration saved (values only; secrets stay as references).' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function disableUserAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    const result = await disableUser(actor, str(formData, 'userId'), str(formData, 'reason'));
    revalidatePath('/admin/system');
    back({
      ok: `User disabled; sessions revoked immediately; ${result.orphanedTasks} orphaned task(s) flagged for reassignment.`,
    });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function accessReviewAction(): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await generateAccessReview(actor);
    revalidatePath('/admin/system');
    back({ ok: 'Access review snapshot generated (append-only evidence).' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function syncEmployeesAction(): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    const result = await syncEmployees(actor);
    revalidatePath('/admin/system');
    back({
      ok: `Employee sync (fixture adapter): ${result.created} created, ${result.updated} updated, ${result.diffs.length} field difference(s) recorded.`,
    });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function reconciliationAction(): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    const report = await reconciliationReport(actor);
    revalidatePath('/admin/system');
    back({
      ok: `Reconciliation: ${report.findings.length} finding(s) (${report.adapterMode} adapter). See the panel below.`,
    });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function createBackupAction(): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    const result = await createBackup(actor);
    revalidatePath('/admin/system');
    back({
      ok: `Backup created (${result.sizeBytes} bytes, checksum ${result.checksum.slice(0, 12)}...).`,
    });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function restoreVerifyAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    const result = await restoreAndVerify(actor, str(formData, 'backupId'));
    revalidatePath('/admin/system');
    back({
      ok: result.ok
        ? `Restore test PASSED into the isolated database: ${result.note}`
        : `Restore test FAILED: ${result.note}`,
    });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}
