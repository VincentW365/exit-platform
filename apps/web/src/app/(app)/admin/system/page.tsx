import type { Metadata } from 'next';
import {
  breakGlassStatus,
  directoryTechnicalCounts,
  getSystemConfigValue,
  listAccessReviews,
  listActiveUsers,
  listBackups,
  listSystemConfig,
  reconciliationReport,
  ServiceError,
} from '@exit/db';
import { bambooDirectoryStatus } from '@exit/config';
import { can, formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import {
  accessReviewAction,
  createBackupAction,
  disableUserAction,
  purgeDirectoryAction,
  reconciliationAction,
  restoreVerifyAction,
  setConfigAction,
  syncEmployeesAction,
  testDirectoryConnectionAction,
} from './actions';
import { humanize, roleList } from '@/lib/text';

export const metadata: Metadata = { title: 'System Administration' };
export const dynamic = 'force-dynamic';

/**
 * Technical administration (Directive 4 sections E, F, I, Q): provider
 * configuration, identity lifecycle, employee sync and backups - with NO
 * access to HR case content (I.3 / fixed default 14).
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
        <p className="panel">System administration requires the SYSTEM_ADMIN role.</p>
      </>
    );

  let config: Awaited<ReturnType<typeof listSystemConfig>> = [];
  let users: Awaited<ReturnType<typeof listActiveUsers>> = [];
  let reviews: Awaited<ReturnType<typeof listAccessReviews>> = [];
  let backups: Awaited<ReturnType<typeof listBackups>> = [];
  let breakGlass = { enabled: false, note: '' };
  let recon: Awaited<ReturnType<typeof reconciliationReport>> | null = null;
  let directory: Awaited<ReturnType<typeof directoryTechnicalCounts>> | null = null;
  let adapterMode = 'fixture';
  try {
    [config, users, reviews, backups, breakGlass, directory] = await Promise.all([
      listSystemConfig(actor),
      listActiveUsers(),
      listAccessReviews(actor),
      listBackups(actor),
      breakGlassStatus(),
      directoryTechnicalCounts(),
    ]);
    adapterMode =
      ((await getSystemConfigValue('bamboohr.mode')) as string) === 'live' ? 'live' : 'fixture';
    recon = await reconciliationReport(actor);
  } catch (e) {
    if (!(e instanceof ServiceError)) throw e;
  }
  const directoryStatus = bambooDirectoryStatus();

  return (
    <>
      <h1>System Administration</h1>
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint" role="note">
        Technical configuration only - this area never grants HR case content access. Secrets are
        stored as REFERENCES and never displayed. {breakGlass.note}
      </p>

      <section className="panel" aria-labelledby="cfg-h">
        <h2 id="cfg-h" style={{ marginTop: 0 }}>
          System Configuration
        </h2>
        {config.length === 0 ? <p>No configuration entries.</p> : null}
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

      <section className="panel" aria-labelledby="sync-h">
        <h2 id="sync-h" style={{ marginTop: 0 }}>
          Employee Directory
        </h2>
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
        <form action={purgeDirectoryAction} style={{ display: 'inline-block' }}>
          <button type="submit" className="danger">
            Purge live directory cache
          </button>
        </form>
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
              <p>No mismatches.</p>
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

      <section className="panel" aria-labelledby="bk-h">
        <h2 id="bk-h" style={{ marginTop: 0 }}>
          Backup and Restore
        </h2>
        <form action={createBackupAction} style={{ display: 'inline-block' }}>
          <button type="submit">Create database backup (pg_dump)</button>
        </form>
        {backups.length === 0 ? <p>No backups recorded.</p> : null}
        <ul>
          {backups.map((b) => (
            <li key={b.id}>
              {formatInstant(b.createdAt)} - {String(b.sizeBytes)} bytes - checksum{' '}
              <code>{b.checksum.slice(0, 12)}...</code>{' '}
              {b.verifiedAt ? (
                <span className="badge badge--success">restore verified</span>
              ) : (
                <form action={restoreVerifyAction} style={{ display: 'inline-block' }}>
                  <input type="hidden" name="backupId" value={b.id} />
                  <button type="submit" className="secondary">
                    Restore into isolated DB + verify
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
        <p className="hint">
          Development evidence only: production disaster recovery is documented in the runbook and
          remains unapproved.
        </p>
      </section>
    </>
  );
}
