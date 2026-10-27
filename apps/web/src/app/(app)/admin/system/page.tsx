import type { Metadata } from 'next';
import Link from 'next/link';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { RefreshWatcher } from '@/components/RefreshWatcher';
import { DirectoryFreshnessNote } from '@/components/DirectoryFreshness';
import { Kpi, SectionHead } from '@/components/patterns';
import { DirectoryIcon } from '@/components/icons';
import {
  bambooCredentialStatus,
  breakGlassStatus,
  directoryTechnicalCounts,
  getSystemConfigValue,
  listAccessReviews,
  listActiveUsers,
  listSystemConfig,
  reconciliationReport,
  ServiceError,
  directorySyncStatus,
  getDepartmentBannerConfig,
} from '@exit/db';
import { can, formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import {
  accessReviewAction,
  clearDepartmentBannerAction,
  disableUserAction,
  purgeDirectoryAction,
  reconciliationAction,
  refreshDirectoryAction,
  removeBambooConnectionAction,
  saveBambooConnectionAction,
  setConfigAction,
  syncEmployeesAction,
  testDirectoryConnectionAction,
  updateDepartmentBannerAction,
  uploadDepartmentBannerAction,
} from './actions';
import { EmailBannerAdmin } from './EmailBannerAdmin';
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
  const credential = await bambooCredentialStatus();
  const directoryStatus = credential.status;
  const connected = directoryStatus === 'configured';

  return (
    <>
      <h1>System Administration</h1>
      <Feedback err={sp.err} ok={sp.ok} />

      {/* DEC-072: connect BambooHR from here, in plain words - no hosting
          platform access needed. The key is write-only: never shown again. */}
      <section className="panel" aria-labelledby="bamboo-h" id="bamboohr">
        <SectionHead
          id="bamboo-h"
          icon={<DirectoryIcon />}
          tone={connected ? 'done' : 'attention'}
          title="BambooHR connection"
          description="Connects the employee directory to BambooHR. Read-only: nothing is ever changed in BambooHR."
          aside={
            <span
              className={`badge ${connected ? 'badge--success' : directoryStatus === 'invalid configuration' ? 'badge--danger' : 'badge--warning'}`}
            >
              {connected
                ? 'Connected'
                : directoryStatus === 'invalid configuration'
                  ? 'Needs attention'
                  : 'Not connected'}
            </span>
          }
        />
        {credential.source === 'host' ? (
          <p className="hint">
            Connected through the hosting platform&apos;s settings. Nothing to enter here.
          </p>
        ) : (
          <>
            {credential.source === 'app' && credential.savedAt ? (
              <p className="meta">
                Key saved {formatInstant(new Date(credential.savedAt))}. It is stored encrypted and
                is never shown again; to change it, enter a new one below.
              </p>
            ) : (
              <p className="hint">
                Enter the two details below once. The person who looks after BambooHR (or the HR
                onboarding app) can give them to you.
              </p>
            )}
            <form action={saveBambooConnectionAction} className="stack">
              <div className="field">
                <label htmlFor="bh-subdomain">Company name in BambooHR</label>
                <p className="hint" id="bh-subdomain-hint">
                  From your BambooHR web address: for <code>acme.bamboohr.com</code>, type{' '}
                  <code>acme</code>.
                </p>
                <input
                  id="bh-subdomain"
                  name="subdomain"
                  required
                  maxLength={200}
                  autoComplete="off"
                  aria-describedby="bh-subdomain-hint"
                />
              </div>
              <div className="field">
                <label htmlFor="bh-key">API key</label>
                <p className="hint" id="bh-key-hint">
                  The long code BambooHR gives for API access. Paste it whole.
                </p>
                <input
                  id="bh-key"
                  name="apiKey"
                  type="password"
                  required
                  maxLength={500}
                  autoComplete="off"
                  aria-describedby="bh-key-hint"
                />
              </div>
              <div className="actions-row">
                <button type="submit">
                  {credential.source === 'app' ? 'Replace and reconnect' : 'Connect BambooHR'}
                </button>
              </div>
            </form>
            {credential.source === 'app' ? (
              <form action={removeBambooConnectionAction} style={{ marginTop: 'var(--space-3)' }}>
                <button type="submit" className="secondary compact">
                  Remove saved key
                </button>
              </form>
            ) : null}
          </>
        )}
      </section>

      <details className="panel action" aria-labelledby="cfg-h">
        <summary id="cfg-h">Advanced settings (for technical support)</summary>
        <p className="hint" role="note">
          Low-level settings used by technical support. Not needed for everyday use. Never type a
          password or key here. {breakGlass.note}
        </p>
        {config.length === 0 ? (
          <p className="meta">No settings recorded yet.</p>
        ) : (
          <ul>
            {config.map((c) => (
              <li key={c.key}>
                <code>{c.key}</code> = <code>{JSON.stringify(c.value)}</code>
                {c.secretRef ? <span className="hint"> (secret ref: {c.secretRef})</span> : null}
                {c.reason ? <span className="hint"> - {c.reason}</span> : null}
              </li>
            ))}
          </ul>
        )}
        <form action={setConfigAction}>
          <label htmlFor="sc-key">Setting name (for example bamboohr.scheduledSync)</label>
          <input id="sc-key" name="key" required maxLength={80} />
          <label htmlFor="sc-value">Value (true, false, a number or text)</label>
          <input id="sc-value" name="value" required maxLength={500} />
          <label htmlFor="sc-secret">Secret reference (optional, technical support only)</label>
          <input id="sc-secret" name="secretRef" maxLength={200} />
          <label htmlFor="sc-reason">Why are you changing it? (recorded)</label>
          <input id="sc-reason" name="reason" required maxLength={500} />
          <button type="submit" className="secondary">
            Save setting
          </button>
        </form>
      </details>

      <EmailBannerAdmin
        config={await getDepartmentBannerConfig()}
        actions={{
          upload: uploadDepartmentBannerAction,
          update: updateDepartmentBannerAction,
          clear: clearDepartmentBannerAction,
        }}
      />

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
        {!connected ? (
          <p className="hint">
            Employees load from BambooHR once it is connected -{' '}
            <a href="#bamboohr">enter the BambooHR connection details above</a>.
          </p>
        ) : null}
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
