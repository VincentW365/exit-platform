'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import {
  ServiceError,
  disableUser,
  generateAccessReview,
  purgeLiveDirectory,
  reconciliationReport,
  requestManualDirectoryRefresh,
  runQueuedDirectorySyncs,
  setSystemConfig,
  syncEmployees,
  testDirectoryConnection,
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

/**
 * "Refresh Directory Now" (owner directive, 2026-09-15, section 17): queues
 * a manual full synchronization and runs it after this response is sent, so
 * the screen comes back at once and shows the run's progress. A refresh
 * requested while one is already queued or running joins that run instead
 * of duplicating it.
 */
export async function refreshDirectoryAction(): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    const { runId, reused } = await requestManualDirectoryRefresh(actor);
    if (!reused) {
      after(async () => {
        try {
          await runQueuedDirectorySyncs({ holder: `web-manual:${process.pid}:${runId}` });
        } catch {
          // The outcome is on the run row; the page shows it.
        }
      });
    }
    revalidatePath('/admin/system');
    back({
      ok: reused
        ? 'A directory synchronization is already queued or running; this page follows its progress.'
        : 'Directory refresh started. This page updates itself as the synchronization proceeds.',
    });
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
      ok: `Employee sync (${result.mode} adapter): ${result.retrieved} retrieved, ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged, ${result.failed} failed, ${result.diffs.length} difference record(s).`,
    });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

/**
 * Directive 5.1 L: read-only connection verification. The result is
 * aggregate-only (counts) and nothing is persisted or logged beyond the
 * audited technical action.
 */
export async function testDirectoryConnectionAction(): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    const result = await testDirectoryConnection(actor);
    revalidatePath('/admin/system');
    if (result.status === 'ok' && result.aggregates) {
      const a = result.aggregates;
      back({
        ok:
          `BambooHR connection OK (read-only): ${a.employees} employee(s), ${a.departments} department(s), ` +
          `${a.positions} position(s), ${a.locations} location(s), ${a.withManager} with manager data, ` +
          `${a.missingDepartment + a.missingPosition} record(s) with missing mapping. Nothing was stored.`,
      });
    }
    back({ err: `BambooHR connection test: ${result.status} - ${result.detail}` });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

/** Directive 5.1 G.5: anonymize the synchronized live directory cache. */
export async function purgeDirectoryAction(): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    const result = await purgeLiveDirectory(actor);
    revalidatePath('/admin/system');
    back({
      ok: `Live directory cache purged: ${result.anonymized} record(s) anonymized (${result.referencedKept} referenced by cases kept as deactivated identifiers). Cases and immutable snapshots untouched.`,
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
