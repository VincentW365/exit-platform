import type { Metadata } from 'next';
import Link from 'next/link';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { RefreshWatcher } from '@/components/RefreshWatcher';
import { DirectoryFreshnessNote } from '@/components/DirectoryFreshness';
import { Kpi } from '@/components/patterns';
import {
  breakGlassStatus,
  directoryTechnicalCounts,
  getSystemConfigValue,
  listAccessReviews,
  listActiveUsers,
  listSystemConfig,
  reconciliationReport,
  ServiceError,
  directorySyncStatus,
} from '@exit/db';
import { bambooDirectoryStatus } from '@exit/config';
import { can, formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import {
  accessReviewAction,
  disableUserAction,
  purgeDirectoryAction,
  reconciliationAction,
  refreshDirectoryAction,
  setConfigAction,
  syncEmployeesAction,
  testDirectoryConnectionAction,
} from './actions';
import { humanize, roleList } from '@/lib/text';

export const metadata: Metadata = { title: 'System Administration' };
export const dynamic = 'force-dynamic';

/**
 * HR-operational system administration (Directive 4 sections E, F, I;
 * two-role model DEC-063): provider configuration, identity lifecycle and
 * the employee directory, owned by the HR Manager. Technical functions such
 * as database backups and restore verification are not HR operations and
 * are not offered here (DEC-063).
 */
export default async function SystemAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const sp = await searchParams;
  if (!can(actor, 'admin.system'))
    return (
      <>
        <h1>Access Restricted</h1>
        <p className="panel">System administration requires the HR Manager role.</p>
      </>
    );

  let config: Awaited<ReturnType<typeof listSystemConfig>> = [];
  let users: Awaited<ReturnType<typeof listActiveUsers>> = [];
  let reviews: Awaited<ReturnType<typeof listAccessReviews>> = [];
  let breakGlass = { enabled: false, note: '' };
  let recon: Awaited<ReturnType<typeof reconciliationReport>> | null = null;
  let directory: Awaited<ReturnType<typeof directoryTechnicalCounts>> | null = null;
  let sync: Awaited<ReturnType<typeof directorySyncStatus>> | null = null;
  let adapterMode = 'fixture';
  try {
    [config, users, reviews, breakGlass, directory] = await Promise.all([
      listSystemConfig(actor),
      listActiveUsers(),
      listAccessReviews(actor),
      breakGlassStatus(),
      directoryTechnicalCounts(),
    ]);
    adapterMode =
      ((await getSystemConfigValue('bamboohr.mode')) as string) === 'live' ? 'live' : 'fixture';
    recon = await reconciliationReport(actor);
    sync = await directorySyncStatus();
  } catch (e) {
    if (!(e instanceof ServiceError)) throw e;
  }
  const directoryStatus = bambooDirectoryStatus();

  return (
    <>
      <h1>System Administration</h1>
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint" role="note">
        Configuration only - this area never grants HR case content access. Secrets are stored as
        REFERENCES and never displayed. {breakGlass.note}
      </p>

      <section className="panel" aria-labelledby="cfg-h">
        <h2 id="cfg-h" style={{ marginTop: 0 }}>
          System Configuration
        </h2>
        {config.length === 0 ? (
          <p className="meta">
            No configuration entries yet. Settings appear here as they are recorded.
          </p>
        ) : null}
        <ul>
          {config.map((c) => (
            <li key={c.key}>
              <code>{c.key}</code> = <code>{JSON.stringify(c.value)}</code>
              {c.secretRef ? <span className="hint"> (secret ref: {c.secretRef})</span> : null}
              {c.reason ? <span className="hint"> - {c.reason}</span> : null}
            </li>
          ))}
        </ul>
        <details className="action">
          <summary>Set a configuration value</summary>
          <form action={setConfigAction}>
            <label htmlFor="sc-key">Key (E.g. Sync.scheduledEnabled)</label>
            <input id="sc-key" name="key" required maxLength={80} />
            <label htmlFor="sc-value">Value (True/false, Number or Text - Never a Secret)</label>
            <input id="sc-value" name="value" required maxLength={500} />
            <label htmlFor="sc-secret">Secret REFERENCE (Optional; Vault Path or Env Name)</label>
            <input id="sc-secret" name="secretRef" maxLength={200} />
            <label htmlFor="sc-reason">Reason (Required, Audited)</label>
            <input id="sc-reason" name="reason" required maxLength={500} />
            <button type="submit">Save configuration</button>
          </form>
        </details>
      </section>

      <section className="panel" aria-labelledby="id-h">
        <h2 id="id-h" style={{ marginTop: 0 }}>
          Identity Lifecycle
        </h2>
        <form action={accessReviewAction} style={{ display: 'inline-block' }}>
          <button type="submit">Generate access review snapshot</button>
        </form>
        <p className="hint">
          {reviews.length} review(s) recorded
          {reviews[0] ? `; latest ${formatInstant(reviews[0].generatedAt)}` : ''}.
        </p>
        <details className="action">
          <summary>Disable a user (revokes sessions immediately)</summary>
          <form action={disableUserAction}>
            <label htmlFor="du-user">User</label>
            <select id="du-user" name="userId" required>
              {users.map((u) => (
                <option key={u.userId} value={u.userId}>
                  {u.displayName} ({roleList(u.roles)})
                </option>
              ))}
            </select>
            <label htmlFor="du-reason">Reason (Required, Audited)</label>
            <input id="du-reason" name="reason" required maxLength={500} />
            <p className="hint">
              High-impact action: active sessions are rejected at once and open assignments are
              flagged for HR reassignment.
            </p>
            <button type="submit">Disable user now</button>
          </form>
        </details>
      </section>

      <section className="panel" aria-labelledby="sync-h" id="directory-h">
        <h2 id="sync-h" style={{ marginTop: 0 }}>
          Employee Directory
        </h2>
        {/* Integration health (owner directive, 2026-09-15, section 26):
            counts and instants only - never employee values. */}
        {sync ? (
          <>
            <DirectoryFreshnessNote
              freshness={sync.freshness}
              lastSuccessfulAt={sync.lastSuccessfulAt}
              admin
            />
            <RefreshWatcher active={Boolean(sync.activeRun)} />
            <div className="kpi-grid" data-directory-health>
              <Kpi
                label="Connection"
                value={
                  sync.connection === 'HEALTHY'
                    ? 'Healthy'
                    : sync.connection === 'FAILING'
                      ? 'Failing'
                      : 'Unknown'
                }
                tone={
                  sync.connection === 'HEALTHY'
                    ? 'done'
                    : sync.connection === 'FAILING'
                      ? 'critical'
                      : 'pending'
                }
                note={`${sync.mode} adapter${sync.simulatedOutage ? ' · SIMULATED OUTAGE' : ''}${sync.webhookConfigured ? ' · webhook enabled' : ' · webhook key not set'}`}
              />
              <Kpi
                label="Local employees"
                value={sync.employees}
                note={`${sync.totalRecords} records · ${sync.archived} archived`}
              />
              <Kpi
                label="Last event"
                value={sync.lastEventAt ? formatInstant(sync.lastEventAt) : 'None yet'}
                note="BambooHR webhook"
              />
              <Kpi
                label="Last incremental"
                value={sync.lastIncrementalAt ? formatInstant(sync.lastIncrementalAt) : 'None yet'}
                note={`Hourly (every ${sync.settings.hourlyMinutes} min)`}
              />
              <Kpi
                label="Last full"
                value={sync.lastFullAt ? formatInstant(sync.lastFullAt) : 'None yet'}
                note={`Nightly at ${String(sync.settings.nightlyHour).padStart(2, '0')}:${String(sync.settings.nightlyMinute).padStart(2, '0')} Jamaica`}
              />
              <Kpi
                label="Last result"
                value={sync.lastRun ? humanize(sync.lastRun.status) : 'None yet'}
                tone={
                  !sync.lastRun
                    ? 'pending'
                    : sync.lastRun.status === 'SUCCESS'
                      ? 'done'
                      : sync.lastRun.status === 'PARTIAL'
                        ? 'attention'
                        : 'critical'
                }
                note={
                  sync.lastRun
                    ? `${humanize(sync.lastRun.kind)}: ${sync.lastRun.added} added, ${sync.lastRun.updated} updated, ${sync.lastRun.archived} archived, ${sync.lastRun.failed} failed${sync.lastRun.errorCode ? ` · ${sync.lastRun.errorCode}` : ''}`
                    : 'No run recorded'
                }
              />
            </div>
            <div className="actions-row">
              <form action={refreshDirectoryAction} style={{ display: 'inline-block' }}>
                <button type="submit" disabled={Boolean(sync.activeRun)}>
                  Refresh Directory Now
                </button>
              </form>
              <Link className="button secondary" href="/admin/directory-sync">
                Synchronization log
              </Link>
            </div>
          </>
        ) : null}
        <p>
          Credential status:{' '}
          <span
            className={`badge ${directoryStatus === 'configured' ? 'badge--success' : directoryStatus === 'invalid configuration' ? 'badge--danger' : 'badge--neutral'}`}
          >
            {humanize(directoryStatus)}
          </span>{' '}
          - active adapter: <span className="badge badge--info">{adapterMode}</span>
          {directory ? (
            <span className="hint">
              {' '}
              {directory.total} cached record(s), {directory.liveRecords} live BambooHR record(s),{' '}
              {directory.syncRuns} sync run(s).
            </span>
          ) : null}
        </p>
        <p className="hint">
          The credential value is never displayed, logged or committed; only the status above is
          reported. Switch adapters with configuration key <code>bamboohr.mode</code> (fixture |
          live). The live adapter is strictly READ-ONLY - no write operation exists. Scheduled sync
          stays disabled unless <code>bamboohr.scheduledSync</code> is explicitly set.
        </p>
        <form action={syncEmployeesAction} style={{ display: 'inline-block' }}>
          <button type="submit">Synchronize the directory now</button>
        </form>{' '}
        <form action={testDirectoryConnectionAction} style={{ display: 'inline-block' }}>
          <button type="submit" className="secondary">
            Test connection (read-only)
          </button>
        </form>{' '}
        <form action={reconciliationAction} style={{ display: 'inline-block' }}>
          <button type="submit">Run reconciliation report</button>
        </form>{' '}
        <ConfirmDialog
          trigger="Purge live directory cache"
          title="Purge the live directory cache?"
          consequence={[
            'Every employee record read from BambooHR is dropped from this database.',
            'Employee search and manager routing stop working until the next sync completes.',
            'BambooHR itself is untouched - this platform never writes to it.',
            'Cases keep their own snapshots, so open cases stay readable.',
          ]}
        >
          <form action={purgeDirectoryAction}>
            <button type="submit" className="danger">
              Purge the cache
            </button>
          </form>
        </ConfirmDialog>
        {directory && directory.recentRuns.length > 0 ? (
          <>
            <h3>Synchronization History</h3>
            <ul>
              {directory.recentRuns.map((s, i) => (
                <li key={i}>
                  {humanize(s.mode)} - {formatInstant(s.startedAt)}
                  {s.finishedAt ? ` to ${formatInstant(s.finishedAt)}` : ''} - {s.createdCount}{' '}
                  created, {s.updatedCount} updated.
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {recon ? (
          <>
            <h3>Latest Reconciliation ({humanize(recon.adapterMode)} Source)</h3>
            {recon.findings.length === 0 ? (
              <p className="meta">
                No mismatches - every runtime privilege matches what the grants define.
              </p>
            ) : (
              <ul>
                {recon.findings.map((f, i) => (
                  <li key={i}>
                    <span className="badge badge--warning">{humanize(f.kind)}</span> {f.sourceId} -{' '}
                    {f.detail}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
        <p className="hint">
          Sync updates SOURCE records only; immutable case snapshots and approved HR decisions are
          never touched. Missing source employees are reported for reconciliation, never deleted.
          Purging anonymizes cached live records without touching cases or snapshots.
        </p>
      </section>
    </>
  );
}
