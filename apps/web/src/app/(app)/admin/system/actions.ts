'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import {
  ServiceError,
  clearDepartmentBanner,
  describeDirectoryFailure,
  disableUser,
  generateAccessReview,
  isTransientDirectoryFailure,
  purgeLiveDirectory,
  reconciliationReport,
  removeBambooCredential,
  requestManualDirectoryRefresh,
  runQueuedDirectorySyncs,
  saveBambooCredential,
  setDepartmentBannerImage,
  setSystemConfig,
  syncEmployees,
  testDirectoryConnection,
  updateDepartmentBannerOptions,
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

/** DEC-067: the HR Manager supplies the department email banner (a JPG). */
export async function uploadDepartmentBannerAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  const file = formData.get('bannerFile');
  try {
    if (!(file instanceof File) || file.size === 0)
      throw ServiceError.validation(['Choose a .jpg file to upload.']);
    const cfg = await setDepartmentBannerImage(
      actor,
      {
        fileName: file.name,
        declaredMime: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      },
      { altText: str(formData, 'altText') || undefined, reason: str(formData, 'reason') },
    );
    revalidatePath('/admin/system');
    back({
      ok: `Department email banner saved (${cfg.banner?.width} × ${cfg.banner?.height} px) and enabled.`,
    });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function updateDepartmentBannerAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await updateDepartmentBannerOptions(actor, {
      enabled: str(formData, 'enabled') === 'true',
      altText: str(formData, 'altText'),
      hostedUrl: str(formData, 'hostedUrl'),
      reason: str(formData, 'reason'),
    });
    revalidatePath('/admin/system');
    back({ ok: 'Department email banner settings saved.' });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function clearDepartmentBannerAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await clearDepartmentBanner(actor, str(formData, 'reason'));
    revalidatePath('/admin/system');
    back({ ok: 'Department email banner removed.' });
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

/**
 * DEC-072: save the BambooHR company name and API key from the System page,
 * test the connection at once, and start the first synchronization - so the
 * directory fills without anyone touching the hosting platform. The key is
 * never echoed back, in the page, the redirect or the audit trail.
 */
export async function saveBambooConnectionAction(formData: FormData): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await saveBambooCredential(actor, {
      subdomain: str(formData, 'subdomain'),
      apiKey: String(formData.get('apiKey') ?? ''),
    });
    // A deployment may hold an explicit "fixture" from an earlier setup;
    // connecting means live, kept fresh on a schedule (DEC-071).
    const reason = 'BambooHR connected from the System page (DEC-072).';
    await setSystemConfig(actor, 'bamboohr.mode', 'live', reason);
    await setSystemConfig(actor, 'bamboohr.scheduledSync', true, reason);
    const test = await testDirectoryConnection(actor);
    if (test.status !== 'ok') {
      revalidatePath('/admin/system');
      // Throttling or an outage says nothing about the details just entered;
      // sending someone back to paste the key again only adds requests.
      const what = describeDirectoryFailure(test.detail);
      back({
        err: isTransientDirectoryFailure(test.detail)
          ? `Saved. ${what} Nothing is wrong with what you entered: wait a few minutes, then press Refresh Directory Now.`
          : `Saved, but BambooHR did not accept it: ${what} Check the company name and paste the key again.`,
      });
    }
    const { runId, reused } = await requestManualDirectoryRefresh(actor);
    if (!reused) {
      after(async () => {
        try {
          await runQueuedDirectorySyncs({ holder: `web-connect:${process.pid}:${runId}` });
        } catch {
          // The outcome is on the run row; the page shows it.
        }
      });
    }
    revalidatePath('/admin/system');
    back({
      ok: `BambooHR connected: ${test.aggregates?.employees ?? 0} employees found. Loading them into the directory now - this page updates itself.`,
    });
  } catch (e) {
    if (e instanceof ServiceError) back({ err: errText(e) });
    throw e;
  }
}

export async function removeBambooConnectionAction(): Promise<void> {
  const { actor } = await requireAuth();
  await touchSession();
  try {
    await removeBambooCredential(actor);
    revalidatePath('/admin/system');
    back({ ok: 'The saved BambooHR connection was removed.' });
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
    const what = describeDirectoryFailure(result.detail);
    back({
      err: isTransientDirectoryFailure(result.detail)
        ? `${what} Nothing was stored. Try again in a few minutes.`
        : `BambooHR connection test failed: ${what}`,
    });
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
