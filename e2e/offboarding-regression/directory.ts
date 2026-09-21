/**
 * The BambooHR directory proofs (owner directive, 2026-09-15, section 36),
 * run after the separation scenarios with the same controlled employee:
 * the profile after synchronization, the manager resolved by identifier,
 * a manual refresh, a signed webhook update (and a refused unsigned one), an
 * hourly reconciliation, and a simulated outage in which the cached
 * directory keeps working - followed by recovery.
 *
 * Every read here is what HR or an administrator would see; every
 * synchronization is the product's own engine. The webhook private key is
 * generated per run by the runner, given to the web server through the
 * environment, and never written to the evidence.
 */
import { createHmac } from 'node:crypto';
import type { APIRequestContext, Page } from '@playwright/test';
import type { DbBridge, DirectoryRunRow } from './support/db';
import { DirectoryEvidence } from './support/directoryEvidence';
import type { RunContext } from './support/run';
import * as ui from './support/ui';

const WEBHOOK_KEY_ENV = 'OFFBOARDING_E2E_WEBHOOK_KEY';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForRun(
  bridge: DbBridge,
  kind: string,
  match: (r: DirectoryRunRow) => boolean,
  timeoutMs = 90_000,
): Promise<DirectoryRunRow | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const runs = bridge.directoryRuns({ kind, limit: 10 });
    const hit = runs.find((r) => match(r) && r.status !== 'QUEUED' && r.status !== 'RUNNING');
    if (hit) return hit;
    if (Date.now() > deadline) return runs.find(match) ?? null;
    await sleep(2500);
  }
}

export async function runDirectoryEvidence(
  page: Page,
  request: APIRequestContext,
  run: RunContext,
  bridge: DbBridge,
): Promise<void> {
  const ev = new DirectoryEvidence(run);
  const employee = run.employee;
  let sourceId: string | null = null;
  let profileId: string | null = null;

  // --- initial-sync: the profile as HR sees it after synchronization -----------
  await ev.step('initial-sync', 'status and profile', page, async () => {
    const status = bridge.directoryStatus();
    ev.json('initial-sync', 'sync-status', status);
    ev.fact('Adapter mode', status.mode);
    ev.fact('Employees cached', status.employees);
    ev.fact('Last successful synchronization', status.lastSuccessfulAt);
    ev.expect(
      'initial-sync',
      'The directory has synchronized at least once',
      status.lastSuccessfulAt !== null && status.employees > 0,
      `${status.employees} active employee(s); last success ${status.lastSuccessfulAt ?? 'never'}`,
    );
    ev.expect(
      'initial-sync',
      'Freshness is stated (not "unavailable")',
      status.freshness.state !== 'NEVER',
      `${status.freshness.state}: ${status.freshness.message}`,
    );

    const profile = bridge.directoryProfile(employee);
    ev.expect('initial-sync', `${employee} is in the local directory`, profile !== null);
    if (!profile) return;
    sourceId = profile.record.sourceId;
    profileId = profile.record.id;
    ev.json('initial-sync', 'profile', profile);
    ev.fact('Directory record id', profile.record.id);
    ev.fact('BambooHR id present', Boolean(sourceId));

    await ui.signInAs(page, 'HR Manager');
    await page.goto(`/directory?q=${encodeURIComponent(employee)}`);
    await ev.shot('initial-sync', page, 'directory_search', `Directory search for ${employee}`);
    const card = page.getByRole('link', { name: employee, exact: true }).first();
    ev.expect('initial-sync', 'The employee card is listed', (await card.count()) > 0);
    await page.goto(`/directory/${profile.record.id}`);
    await ev.shot(
      'initial-sync',
      page,
      'profile',
      `${employee}'s profile: employment, reporting, contact, offboarding`,
    );
    const text = await page
      .locator('main')
      .innerText()
      .catch(() => '');
    ev.expect(
      'initial-sync',
      'Profile shows Employment, Reporting Structure and Work Contact',
      /Employment/.test(text) && /Reporting Structure/.test(text) && /Work Contact/.test(text),
    );
    // innerText carries the stylesheet's upper-casing of fact labels.
    ev.expect(
      'initial-sync',
      'Profile shows the last synchronization time',
      /Record last synchronized/i.test(text),
    );
    const jobTitle = profile.record.jobTitle ?? '';
    ev.expect(
      'initial-sync',
      'Job title and department are shown',
      (!jobTitle || text.includes(jobTitle)) &&
        (!profile.record.department || text.includes(profile.record.department)),
    );
    ev.headline(
      'initial-sync',
      `${employee} present, ${status.employees} employees cached, freshness ${status.freshness.state}.`,
    );
  });

  // --- manager-resolution ---------------------------------------------------------
  await ev.step('manager-resolution', 'manager linked by identifier', page, async () => {
    const profile = bridge.directoryProfile(employee);
    if (!profile) {
      ev.skip('manager-resolution', 'Manager resolution', 'no profile');
      return;
    }
    ev.json('manager-resolution', 'manager', {
      managerName: profile.record.managerName,
      managerDirectoryId: profile.record.managerDirectoryId,
      manager: profile.manager,
      reportsTotal: profile.reportsTotal,
    });
    ev.fact('Manager on record', profile.record.managerName);
    ev.fact('Manager resolved to a directory record', profile.manager?.displayName ?? null);
    if (profile.record.managerName) {
      ev.expect(
        'manager-resolution',
        'The manager is linked to their own directory record (by identifier, not by name)',
        profile.manager !== null && profile.record.managerDirectoryId === profile.manager.id,
        profile.manager
          ? `${profile.manager.displayName} (${profile.manager.jobTitle ?? '-'})`
          : 'not linked',
      );
    } else {
      ev.warn(
        'manager-resolution',
        'No manager recorded in BambooHR for this employee',
        'HR assigns an alternate at intake',
      );
    }
    await page.goto(`/directory/${profile.record.id}`);
    await ev.shot(
      'manager-resolution',
      page,
      'profile_reporting',
      'Reporting Structure on the profile',
    );
    if (profile.manager) {
      await page.goto(`/directory/${profile.manager.id}`);
      await ev.shot(
        'manager-resolution',
        page,
        'manager_profile',
        `The manager's profile, listing ${employee} among direct reports`,
      );
      const text = await page
        .locator('main')
        .innerText()
        .catch(() => '');
      ev.expect(
        'manager-resolution',
        `${employee} appears among the manager's direct reports`,
        text.includes(employee),
      );
    }
    ev.headline(
      'manager-resolution',
      profile.manager
        ? `Manager ${profile.manager.displayName} linked by id.`
        : 'No manager on record.',
    );
  });

  // --- manual-refresh ---------------------------------------------------------------
  await ev.step('manual-refresh', 'Refresh Directory Now', page, async () => {
    await ui.switchTo(page, 'System Administrator');
    await page.goto('/admin/system');
    await ev.shot('manual-refresh', page, 'before', 'Employee Directory panel before the refresh');
    const before = bridge.directoryRuns({ kind: 'MANUAL', limit: 1 })[0] ?? null;
    const pressedAt = Date.now();
    const fb = await ui.act(page, page.getByRole('button', { name: 'Refresh Directory Now' }));
    const accepted = bridge.directoryRuns({ kind: 'MANUAL', limit: 1 })[0] ?? null;
    const isNew = accepted !== null && (!before || accepted.id !== before.id);
    ev.expect(
      'manual-refresh',
      'The refresh is accepted at once (non-blocking)',
      /refresh started|already queued or running/i.test(fb.ok ?? '') || isNew,
      `${fb.ok ?? fb.err ?? 'no banner read'}; run queued ${isNew ? `${Math.round((Date.now() - pressedAt) / 1000)}s after the press` : 'not found'}`,
    );
    await ev.shot(
      'manual-refresh',
      page,
      'queued',
      'Immediately after pressing Refresh Directory Now',
    );
    // A live read of the whole listing plus details for changed rows; allow
    // the run several minutes on a slow source.
    const run = await waitForRun(
      bridge,
      'MANUAL',
      (r) => !before || r.id !== before.id,
      5 * 60_000,
    );
    ev.json('manual-refresh', 'run', run);
    ev.expect(
      'manual-refresh',
      'The manual run completed',
      run !== null && (run.status === 'SUCCESS' || run.status === 'PARTIAL'),
      run
        ? `${run.status}: checked ${run.checked}, added ${run.added}, updated ${run.updated}, archived ${run.archived}, failed ${run.failed}`
        : 'no run found',
    );
    await page.goto('/admin/system');
    await ev.shot(
      'manual-refresh',
      page,
      'after',
      'Health panel after the refresh: last result and counts',
    );
    const panel = await page
      .locator('[data-directory-health]')
      .innerText()
      .catch(() => '');
    ev.expect(
      'manual-refresh',
      'The health panel reports connection, local employees and last result',
      /Connection/i.test(panel) && /Local employees/i.test(panel) && /Last result/i.test(panel),
    );
    // A second press while nothing is running starts a new run; a press
    // during a run joins it - the integration tests prove the de-duplication.
    ev.headline(
      'manual-refresh',
      run ? `Manual run ${run.status}: ${run.checked} checked.` : 'No run recorded.',
    );
  });

  // --- webhook-update ------------------------------------------------------------------
  await ev.step('webhook-update', 'signed employee-change webhook', page, async () => {
    const key = process.env[WEBHOOK_KEY_ENV];
    if (!key) {
      ev.skip(
        'webhook-update',
        'Signed webhook',
        `${WEBHOOK_KEY_ENV} not set for this run (use pnpm regression:offboarding)`,
      );
      return;
    }
    if (!sourceId) {
      ev.skip('webhook-update', 'Signed webhook', 'no employee id');
      return;
    }
    const url = `${run.baseUrl}/api/bamboohr/webhook`;
    // An unsigned request is refused and audited by category.
    const unsigned = await request.post(url, {
      data: JSON.stringify({ employees: [{ id: sourceId, changedFields: ['jobTitle'] }] }),
      headers: { 'content-type': 'application/json' },
    });
    ev.json('webhook-update', 'unsigned-response', {
      status: unsigned.status(),
      body: await unsigned.text(),
    });
    ev.expect(
      'webhook-update',
      'An unsigned request is refused (401)',
      unsigned.status() === 401,
      `HTTP ${unsigned.status()}`,
    );
    // A wrong key is refused too.
    const rawBody = JSON.stringify({
      employees: [{ id: sourceId, changedFields: ['jobTitle', 'department'], action: 'Updated' }],
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const badSig = createHmac('sha256', 'not-the-key')
      .update(rawBody + ts)
      .digest('hex');
    const forged = await request.post(url, {
      data: rawBody,
      headers: {
        'content-type': 'application/json',
        'x-bamboohr-timestamp': ts,
        'x-bamboohr-signature': badSig,
      },
    });
    ev.expect(
      'webhook-update',
      'A request signed with the wrong key is refused (401)',
      forged.status() === 401,
      `HTTP ${forged.status()}`,
    );
    // The genuine one is accepted, and the employee is re-read from the source.
    const sig = createHmac('sha256', key)
      .update(rawBody + ts)
      .digest('hex');
    const ok = await request.post(url, {
      data: rawBody,
      headers: {
        'content-type': 'application/json',
        'x-bamboohr-timestamp': ts,
        'x-bamboohr-signature': sig,
      },
    });
    const okBody = await ok.text();
    ev.json('webhook-update', 'signed-request', {
      url: '/api/bamboohr/webhook',
      headers: [
        'x-bamboohr-timestamp',
        'x-bamboohr-signature (HMAC-SHA256 hex of body+timestamp; value withheld)',
      ],
      body: JSON.parse(rawBody),
      response: { status: ok.status(), body: okBody },
    });
    ev.expect(
      'webhook-update',
      'A correctly signed request is accepted (202)',
      ok.status() === 202,
      `HTTP ${ok.status()} ${okBody}`,
    );
    const hit = await waitForRun(bridge, 'WEBHOOK', (r) => r.employeeSourceId === sourceId);
    ev.json('webhook-update', 'run', hit);
    ev.expect(
      'webhook-update',
      'The webhook run re-read the named employee only and finished',
      hit !== null && hit.checked <= 1 && (hit.status === 'SUCCESS' || hit.status === 'PARTIAL'),
      hit
        ? `${hit.status}: checked ${hit.checked}, updated ${hit.updated}, unchanged ${hit.unchanged}`
        : 'no run',
    );
    await page.goto('/admin/directory-sync?kind=WEBHOOK');
    await ev.shot(
      'webhook-update',
      page,
      'sync_log_webhook',
      'Synchronization log filtered to webhook runs',
    );
    ev.headline(
      'webhook-update',
      hit
        ? `Webhook run ${hit.status} for the employee; unsigned and forged requests refused.`
        : 'Webhook run not found.',
    );
  });

  // --- hourly-reconciliation ---------------------------------------------------------
  await ev.step('hourly-reconciliation', 'scheduler decision and hourly run', page, async () => {
    const r = bridge.directoryHourly();
    ev.json('hourly-reconciliation', 'tick', r.tick);
    ev.json('hourly-reconciliation', 'run', r.forced);
    ev.expect(
      'hourly-reconciliation',
      'The worker tick queues no HOURLY reconciliation while the mirror is fresh (a first nightly may be due)',
      !r.tick.queued.includes('HOURLY'),
      `queued: ${r.tick.queued.join(', ') || 'none'}; scheduled sync ${r.scheduledSyncEnabled ? 'enabled' : 'disabled'}`,
    );
    ev.expect(
      'hourly-reconciliation',
      'An hourly reconciliation run completes against the source',
      r.forced.status === 'SUCCESS' || r.forced.status === 'PARTIAL',
      `${r.forced.status}: checked ${r.forced.checked}, added ${r.forced.added}, updated ${r.forced.updated}, archived ${r.forced.archived}, failed ${r.forced.failed}`,
    );
    await page.goto('/admin/directory-sync?kind=HOURLY');
    await ev.shot(
      'hourly-reconciliation',
      page,
      'sync_log_hourly',
      'Synchronization log filtered to hourly runs',
    );
    ev.headline(
      'hourly-reconciliation',
      `Hourly run ${r.forced.status}; tick queued ${r.tick.queued.length === 0 ? 'nothing (fresh)' : r.tick.queued.join(', ')}.`,
    );
  });

  // --- offline-cache ----------------------------------------------------------------------
  await ev.step('offline-cache', 'simulated outage and recovery', page, async () => {
    const employeesBefore = bridge.directoryStatus().employees;
    bridge.directoryOutage(true);
    try {
      const failed = bridge.directoryRefresh();
      ev.json('offline-cache', 'run-during-outage', failed);
      ev.expect(
        'offline-cache',
        'A synchronization during the outage fails safely',
        failed.status === 'FAILED' && failed.errorCode === 'NETWORK_ERROR',
        `${failed.status} ${failed.errorCode ?? ''}`,
      );
      const status = bridge.directoryStatus();
      ev.json('offline-cache', 'status-during-outage', status);
      ev.expect(
        'offline-cache',
        'Cached employee records are untouched',
        status.employees === employeesBefore,
        `${status.employees} before and after`,
      );
      ev.expect(
        'offline-cache',
        'The connection is reported as failing while freshness stays honest',
        status.connection === 'FAILING' && status.freshness.state !== 'NEVER',
        `${status.connection}; freshness ${status.freshness.state}`,
      );
      const search = bridge.directorySearch(employee);
      ev.json('offline-cache', 'search-during-outage', search);
      ev.expect(
        'offline-cache',
        `${employee} is still found in the cached directory`,
        search.rows.some((x) => x.displayName === employee),
        `${search.total} result(s)`,
      );
      await page.goto('/admin/system');
      await ev.shot(
        'offline-cache',
        page,
        'admin_during_outage',
        'Health panel during the simulated outage',
      );
      await ui.switchTo(page, 'HR Manager');
      await page.goto(`/directory?q=${encodeURIComponent(employee)}`);
      await ev.shot(
        'offline-cache',
        page,
        'directory_during_outage',
        'HR directory search during the outage - cached data in use',
      );
      const text = await page
        .locator('main')
        .innerText()
        .catch(() => '');
      ev.expect(
        'offline-cache',
        'The HR directory page works during the outage and never says "unavailable"',
        text.includes(employee) && !/unavailable because BambooHR is down/i.test(text),
      );
      await page.goto(`/cases/new?q=${encodeURIComponent(employee)}`);
      await ev.shot(
        'offline-cache',
        page,
        'intake_search_during_outage',
        'Case intake search during the outage',
      );
      const links = await page
        .getByRole('link', { name: `Select ${employee}`, exact: true })
        .count();
      ev.expect(
        'offline-cache',
        'Case intake finds the employee from the local directory during the outage',
        links > 0,
        `${links} match`,
      );
      if (profileId) {
        await page.goto(`/directory/${profileId}`);
        await ev.shot('offline-cache', page, 'profile_during_outage', 'Profile during the outage');
      }
    } finally {
      bridge.directoryOutage(false);
    }
    const recovered = bridge.directoryRefresh();
    ev.json('offline-cache', 'run-after-recovery', recovered);
    ev.expect(
      'offline-cache',
      'The next synchronization after recovery succeeds',
      recovered.status === 'SUCCESS' || recovered.status === 'PARTIAL',
      `${recovered.status}: checked ${recovered.checked}, failed ${recovered.failed}`,
    );
    const after = bridge.directoryStatus();
    ev.json('offline-cache', 'status-after-recovery', after);
    ev.expect(
      'offline-cache',
      'Connection healthy again',
      after.connection === 'HEALTHY',
      after.connection,
    );
    await ui.switchTo(page, 'System Administrator');
    await page.goto('/admin/system');
    await ev.shot('offline-cache', page, 'admin_after_recovery', 'Health panel after recovery');
    await page.goto('/admin/directory-sync?errors=yes');
    await ev.shot(
      'offline-cache',
      page,
      'sync_log_errors',
      'Synchronization log, errors only: the failed run during the outage',
    );
    ev.headline(
      'offline-cache',
      `Outage run ${recovered.status === 'SUCCESS' ? 'failed safely, cache used, recovered' : 'see checks'}.`,
    );
  });

  const counts = ev.counts();
  ev.finish(
    `${counts.pass} pass, ${counts.fail} fail, ${counts.warn} warning(s). Proofs: profile after sync, manager by identifier, manual refresh, signed webhook, hourly reconciliation, outage with cached directory and recovery.`,
  );
}
