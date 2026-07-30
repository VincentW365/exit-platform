import type { Metadata } from 'next';
import {
  breakGlassStatus,
  listAccessReviews,
  listActiveUsers,
  listBackups,
  listSystemConfig,
  reconciliationReport,
  ServiceError,
} from '@exit/db';
import { can, formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import {
  accessReviewAction,
  createBackupAction,
  disableUserAction,
  reconciliationAction,
  restoreVerifyAction,
  setConfigAction,
  syncEmployeesAction,
} from './actions';

export const metadata: Metadata = { title: 'System administration' };
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
    return <p className="panel">System administration requires the SYSTEM_ADMIN role.</p>;

  let config: Awaited<ReturnType<typeof listSystemConfig>> = [];
  let users: Awaited<ReturnType<typeof listActiveUsers>> = [];
  let reviews: Awaited<ReturnType<typeof listAccessReviews>> = [];
  let backups: Awaited<ReturnType<typeof listBackups>> = [];
  let breakGlass = { enabled: false, note: '' };
  let recon: Awaited<ReturnType<typeof reconciliationReport>> | null = null;
  try {
    [config, users, reviews, backups, breakGlass] = await Promise.all([
      listSystemConfig(actor),
      listActiveUsers(),
      listAccessReviews(actor),
      listBackups(actor),
      breakGlassStatus(),
    ]);
    recon = await reconciliationReport(actor);
  } catch (e) {
    if (!(e instanceof ServiceError)) throw e;
  }

  return (
    <>
      <h1>System administration (technical)</h1>
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint" role="note">
        Technical configuration only - this area never grants HR case content access. Secrets are
        stored as REFERENCES and never displayed. {breakGlass.note}
      </p>

      <section className="panel" aria-labelledby="cfg-h">
        <h2 id="cfg-h" style={{ marginTop: 0 }}>
          System configuration
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
            <label htmlFor="sc-key">Key (e.g. pilot.privacyApprovalRequired)</label>
            <input id="sc-key" name="key" required maxLength={80} />
            <label htmlFor="sc-value">Value (true/false, number or text - never a secret)</label>
            <input id="sc-value" name="value" required maxLength={500} />
            <label htmlFor="sc-secret">Secret REFERENCE (optional; vault path or env name)</label>
            <input id="sc-secret" name="secretRef" maxLength={200} />
            <label htmlFor="sc-reason">Reason (required, audited)</label>
            <input id="sc-reason" name="reason" required maxLength={500} />
            <button type="submit">Save configuration</button>
          </form>
        </details>
      </section>

      <section className="panel" aria-labelledby="id-h">
        <h2 id="id-h" style={{ marginTop: 0 }}>
          Identity lifecycle
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
                  {u.displayName} ({u.roles.join(', ') || 'no role'})
                </option>
              ))}
            </select>
            <label htmlFor="du-reason">Reason (required, audited)</label>
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
          Employee source (BambooHR fixture adapter)
        </h2>
        <form action={syncEmployeesAction} style={{ display: 'inline-block' }}>
          <button type="submit">Run fixture sync</button>
        </form>{' '}
        <form action={reconciliationAction} style={{ display: 'inline-block' }}>
          <button type="submit">Run reconciliation report</button>
        </form>
        {recon ? (
          <>
            <h3>Latest reconciliation ({recon.adapterMode} adapter)</h3>
            {recon.findings.length === 0 ? (
              <p>No mismatches.</p>
            ) : (
              <ul>
                {recon.findings.map((f, i) => (
                  <li key={i}>
                    <span className="badge badge--warning">{f.kind}</span> {f.sourceId} - {f.detail}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
        <p className="hint">
          Sync updates SOURCE records only; immutable case snapshots and approved HR decisions are
          never touched. Live BambooHR stays disabled without credentials and written authorization.
        </p>
      </section>

      <section className="panel" aria-labelledby="bk-h">
        <h2 id="bk-h" style={{ marginTop: 0 }}>
          Backup and restore
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
