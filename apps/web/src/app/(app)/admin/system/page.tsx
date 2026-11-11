import type { Metadata } from 'next';
import Link from 'next/link';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { RefreshWatcher } from '@/components/RefreshWatcher';
import { DirectoryFreshnessNote } from '@/components/DirectoryFreshness';
import { Chip, Kpi, SectionHead, type Tone } from '@/components/patterns';
import { DirectoryIcon, ServerIcon, ShieldIcon } from '@/components/icons';
import {
  bambooCredentialStatus,
  breakGlassStatus,
  directoryTechnicalCounts,
  listAccessReviews,
  listActiveUsers,
  listRecentApplicationErrors,
  listSystemConfig,
  siteSupportStatus,
  type DatabaseSchemaStatus,
  type DataKeyStatus,
  type SchemaState,
  type UploadLimitStatus,
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
  repairSeededAddressesAction,
  saveBambooConnectionAction,
  setConfigAction,
  syncEmployeesAction,
  testDirectoryConnectionAction,
  updateDepartmentBannerAction,
  uploadDepartmentBannerAction,
} from './actions';
import { EmailBannerAdmin } from './EmailBannerAdmin';
import { countOf, humanize, roleList } from '@/lib/text';

export const metadata: Metadata = { title: 'System Administration' };
export const dynamic = 'force-dynamic';

/**
 * HR-operational system administration (Directive 4 sections E, F, I;
 * two-role model DEC-063): the BambooHR connection, the employee directory,
 * the email banner and user access, owned by the HR Manager. Technical
 * functions such as database backups and restore verification are not HR
 * operations and are not offered here (DEC-063).
 *
 * Presentation (owner directive, 2026-10-27): the same three levels as the
 * Exit Center - identity and the one action that matters, then each area as
 * a panel with a plain heading, figures, and its buttons in one row - with
 * the technical key/value form folded away at the end for support staff.
 */
// DEC-073: the database schema and the worker, in the words of someone who
// cannot reach the host and needs to know what to ask for.
const SCHEMA_TONE: Record<SchemaState, Tone> = {
  current: 'done',
  ahead: 'attention',
  behind: 'critical',
  unknown: 'critical',
};
const SCHEMA_LABEL: Record<SchemaState, string> = {
  current: 'Current',
  ahead: 'Newer than this version',
  behind: 'Behind',
  unknown: 'Unknown',
};
function schemaText(s: DatabaseSchemaStatus): string {
  switch (s.state) {
    case 'current':
      return `Matches this version (${s.expected}).`;
    case 'ahead':
      return `The database is newer than this version: it has ${s.applied}, this version expects ${s.expected}. Redeploy the latest version.`;
    case 'behind':
      return `The database has ${s.applied}; this version expects ${s.expected}. Pages that touch the missing tables fail with a reference. Ask the host to run the database migrations (prisma migrate deploy).`;
    default:
      return s.reachable
        ? 'No migration is recorded. Ask the host to run the database migrations (prisma migrate deploy).'
        : 'The database could not be reached.';
  }
}

const DATA_KEY_TONE: Record<DataKeyStatus['state'], Tone> = {
  current: 'done',
  none: 'neutral',
  changed: 'critical',
};
const DATA_KEY_LABEL: Record<DataKeyStatus['state'], string> = {
  current: 'Current',
  none: 'Nothing saved yet',
  changed: 'Changed',
};
function dataKeyText(d: DataKeyStatus): string {
  if (d.state === 'changed') {
    const what = [
      d.unreadableAddresses
        ? `${d.unreadableAddresses} of ${countOf(d.savedAddresses, 'saved address', 'saved addresses')}`
        : '',
      d.bambooCredential === 'unreadable' ? 'the saved BambooHR key' : '',
    ]
      .filter(Boolean)
      .join(' and ');
    const repairable = d.repairableAddresses
      ? ` ${d.repairableAddresses} of these are seeded test addresses: press Repair to read them again with this key.`
      : '';
    return `${what} cannot be read with this site's key (fingerprint ${d.fingerprint}). SESSION_SECRET or DATA_KEY changed since they were saved, or the database was seeded under a different one. Restore the original value on the host, or enter them again: addresses under Recipients, the key under BambooHR connection above.${repairable}`;
  }
  if (d.state === 'none')
    return `Fingerprint ${d.fingerprint}. Whoever seeds or enters addresses must use the same SESSION_SECRET or DATA_KEY as this site.`;
  return `All ${countOf(d.savedAddresses, 'saved address', 'saved addresses')} can be read. Fingerprint ${d.fingerprint}.`;
}

/**
 * DEC-075: the file sizes the configuration promises must also get through
 * the build. The request-body limit is fixed when the web app is built; when
 * the build accepts less than MAX_UPLOAD_MB asks for, every larger upload
 * becomes "Something Went Wrong" with a reference before this platform's
 * code runs.
 */
const UPLOAD_TONE: Record<UploadLimitStatus['state'], Tone> = {
  ok: 'done',
  'build-too-small': 'critical',
  unknown: 'attention',
};
const UPLOAD_LABEL: Record<UploadLimitStatus['state'], string> = {
  ok: 'Current',
  'build-too-small': 'Build too small',
  unknown: 'Unknown',
};
function uploadText(u: UploadLimitStatus): string {
  switch (u.state) {
    case 'ok':
      return `Files up to ${u.configuredMb} MB are accepted (email banners up to 2 MB). This build accepts requests up to ${u.builtBodyLimitMb} MB.`;
    case 'build-too-small':
      return `MAX_UPLOAD_MB is ${u.configuredMb}, but this build accepts requests up to ${u.builtBodyLimitMb} MB${u.effectiveMb > 0 ? ` (it was made for MAX_UPLOAD_MB=${u.effectiveMb})` : ' (it was built without the limit)'}: a file near or above ${u.builtBodyLimitMb} MB fails with a reference before it is checked. Ask the host to build the web app again with MAX_UPLOAD_MB=${u.configuredMb}${u.effectiveMb > 0 ? `, or set MAX_UPLOAD_MB=${u.effectiveMb} on the host` : ''}.`;
    default:
      return `Files up to ${u.configuredMb} MB are accepted. This build did not record the request limit it was made with.`;
  }
}

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
  let errors: Awaited<ReturnType<typeof listRecentApplicationErrors>> = [];
  try {
    [config, users, reviews, breakGlass, directory] = await Promise.all([
      listSystemConfig(actor),
      listActiveUsers(),
      listAccessReviews(actor),
      breakGlassStatus(),
      directoryTechnicalCounts(),
    ]);
    sync = await directorySyncStatus();
  } catch (e) {
    if (!(e instanceof ServiceError)) throw e;
  }
  // The live reconciliation is a BambooHR read; it runs only when asked for
  // (Run reconciliation report), never on a page view - every view used to
  // read the whole directory, and a failure there silently blanked the rest.
  if (sp.recon === '1') {
    try {
      recon = await reconciliationReport(actor);
    } catch (e) {
      if (!(e instanceof ServiceError)) throw e;
    }
  }
  // Loaded on its own: the support list must show even when a directory
  // service above has just failed - that failure is what it is there for.
  try {
    errors = await listRecentApplicationErrors(actor);
  } catch (e) {
    if (!(e instanceof ServiceError)) throw e;
  }
  // Inlined by next.config.ts when the app was built (DEC-075).
  const builtBodyLimitMb = Number(process.env['NEXT_UPLOAD_BODY_LIMIT_MB']) || null;
  const support = await siteSupportStatus({ builtBodyLimitMb });
  const needsAttention =
    support.schema.state === 'behind' ||
    support.schema.state === 'unknown' ||
    !support.worker.alive ||
    support.dataKey.state === 'changed' ||
    support.uploads.state === 'build-too-small';
  const credential = await bambooCredentialStatus();
  const directoryStatus = credential.status;
  const connected = directoryStatus === 'configured';
  const adapterMode = sync?.mode ?? 'fixture';

  return (
    <div className="exit-center">
      <div className="page-head">
        <div className="page-head__text">
          <h1 className="page-title">System Administration</h1>
          <p className="page-lede">
            The BambooHR connection, the employee directory, the email banner and user access.
          </p>
        </div>
        <div className="page-head__actions">
          <Link className="button secondary" href="/admin/directory-sync">
            Synchronization log
          </Link>
          <Link className="button secondary" href="/admin">
            Administration
          </Link>
        </div>
      </div>
      <Feedback err={sp.err} ok={sp.ok} />

      {/* DEC-072: connect BambooHR from here, in plain words - no hosting
          platform access needed. The key is write-only: never shown again. */}
      <section className="panel" aria-labelledby="bamboo-h" id="bamboohr">
        <SectionHead
          id="bamboo-h"
          icon={<DirectoryIcon />}
          tone={connected ? 'done' : 'attention'}
          title="BambooHR connection"
          description="Read-only. Nothing is ever changed in BambooHR."
          aside={
            <Chip
              tone={
                connected
                  ? 'done'
                  : directoryStatus === 'invalid configuration'
                    ? 'critical'
                    : 'attention'
              }
            >
              {connected
                ? 'Connected'
                : directoryStatus === 'invalid configuration'
                  ? 'Needs attention'
                  : 'Not connected'}
            </Chip>
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
                never shown again; to change it, enter a new one below.
              </p>
            ) : (
              <p className="hint">
                Enter these two details once. The person who looks after BambooHR, or the HR
                onboarding app, can give them to you.
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
                {credential.source === 'app' ? (
                  <button
                    type="submit"
                    formAction={removeBambooConnectionAction}
                    className="secondary"
                  >
                    Remove saved key
                  </button>
                ) : null}
              </div>
            </form>
          </>
        )}
      </section>

      <section className="panel" aria-labelledby="sync-h" id="directory-h">
        <SectionHead
          id="sync-h"
          icon={<ServerIcon />}
          tone={
            !sync
              ? 'neutral'
              : sync.connection === 'HEALTHY'
                ? 'done'
                : sync.connection === 'FAILING'
                  ? 'critical'
                  : 'pending'
          }
          title="Employee Directory"
          description="The local copy of the employee list, refreshed from BambooHR."
          aside={
            sync ? (
              <Chip tone={adapterMode === 'live' ? 'done' : 'neutral'}>
                {adapterMode === 'live' ? 'Live from BambooHR' : 'Synthetic directory'}
              </Chip>
            ) : null
          }
        />
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
            <div className="kpi-grid kpi-grid--tiles directory-health" data-directory-health>
              <Kpi
                compact
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
                note={`${sync.simulatedOutage ? 'Simulated outage · ' : ''}${sync.webhookConfigured ? 'Change notifications on' : 'No change notifications'}`}
              />
              <Kpi
                compact
                label="Local employees"
                value={sync.employees}
                note={`${sync.totalRecords} records · ${sync.archived} archived`}
              />
              <Kpi
                compact
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
                    ? `${humanize(sync.lastRun.kind)}: ${sync.lastRun.added} added, ${sync.lastRun.updated} updated, ${sync.lastRun.archived} archived${sync.lastRun.failed ? `, ${sync.lastRun.failed} failed` : ''}${sync.lastRun.errorCode ? ` · ${sync.lastRun.errorCode}` : ''}`
                    : 'No run recorded'
                }
              />
              <Kpi
                compact
                label="Last hourly refresh"
                value={
                  <span className="kpi__text">
                    {sync.lastIncrementalAt ? formatInstant(sync.lastIncrementalAt) : 'None yet'}
                  </span>
                }
                note={`Every ${sync.settings.hourlyMinutes} min while connected`}
              />
              <Kpi
                compact
                label="Last full refresh"
                value={
                  <span className="kpi__text">
                    {sync.lastFullAt ? formatInstant(sync.lastFullAt) : 'None yet'}
                  </span>
                }
                note={`Nightly at ${String(sync.settings.nightlyHour).padStart(2, '0')}:${String(sync.settings.nightlyMinute).padStart(2, '0')} Jamaica`}
              />
              <Kpi
                compact
                label="Last change notice"
                value={
                  <span className="kpi__text">
                    {sync.lastEventAt ? formatInstant(sync.lastEventAt) : 'None yet'}
                  </span>
                }
                note="Sent by BambooHR when a record changes"
              />
            </div>
            <div className="actions-row">
              <form action={refreshDirectoryAction} style={{ display: 'inline-block' }}>
                <button type="submit" disabled={Boolean(sync.activeRun)}>
                  Refresh Directory Now
                </button>
              </form>
              <form action={testDirectoryConnectionAction} style={{ display: 'inline-block' }}>
                <button type="submit" className="secondary">
                  Test connection (read-only)
                </button>
              </form>
              <form action={reconciliationAction} style={{ display: 'inline-block' }}>
                <button type="submit" className="secondary">
                  Run reconciliation report
                </button>
              </form>
              <form action={syncEmployeesAction} style={{ display: 'inline-block' }}>
                <button type="submit" className="secondary">
                  Synchronize the directory now
                </button>
              </form>
              <ConfirmDialog
                trigger="Purge live directory cache"
                triggerClassName="danger compact"
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
            </div>
          </>
        ) : null}
        <p className="meta">
          Credential status: {humanize(directoryStatus)}
          {directory
            ? ` · ${countOf(directory.liveRecords, 'live record')} · ${countOf(directory.syncRuns, 'sync run')}`
            : ''}
          {!connected ? (
            <>
              {' '}
              · <a href="#bamboohr">Connect BambooHR above</a> to load employees.
            </>
          ) : null}
        </p>
        {directory && directory.recentRuns.length > 0 ? (
          <details className="action">
            <summary>Synchronization history</summary>
            <ul className="attention-list">
              {directory.recentRuns.map((s, i) => (
                <li key={i}>
                  <Chip tone={s.mode === 'live' ? 'done' : 'neutral'}>{humanize(s.mode)}</Chip>
                  <span className="attention-list__title">
                    {s.createdCount} created, {s.updatedCount} updated
                  </span>
                  <span className="attention-list__meta">
                    {formatInstant(s.startedAt)}
                    {s.finishedAt ? ` to ${formatInstant(s.finishedAt)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        {recon ? (
          <>
            <h3>Latest reconciliation ({humanize(recon.adapterMode)} source)</h3>
            {recon.findings.length === 0 ? (
              <p className="meta">No mismatches found.</p>
            ) : (
              <ul className="attention-list">
                {recon.findings.map((f, i) => (
                  <li key={i}>
                    <Chip tone="attention">{humanize(f.kind)}</Chip>
                    <span className="attention-list__title">
                      {f.sourceId} · {f.detail}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
        <p className="section-foot">
          Refreshing updates the local employee list only. Cases keep their own snapshots, and
          nothing is ever written to BambooHR.
        </p>
      </section>

      <EmailBannerAdmin
        config={await getDepartmentBannerConfig()}
        actions={{
          upload: uploadDepartmentBannerAction,
          update: updateDepartmentBannerAction,
          clear: clearDepartmentBannerAction,
        }}
      />

      <section className="panel" aria-labelledby="id-h">
        <SectionHead
          id="id-h"
          icon={<ShieldIcon />}
          tone="info"
          title="User access"
          description="Who can sign in, and a record of who could at a point in time."
          aside={
            reviews[0] ? (
              <Chip tone="neutral">Last review {formatInstant(reviews[0].generatedAt)}</Chip>
            ) : null
          }
        />
        <div className="actions-row">
          <form action={accessReviewAction} style={{ display: 'inline-block' }}>
            <button type="submit" className="secondary">
              Generate access review snapshot
            </button>
          </form>
        </div>
        <p className="meta">
          {countOf(reviews.length, 'review')} recorded. Roles are granted and revoked under{' '}
          <Link href="/admin">Administration</Link>.
        </p>
        <details className="action">
          <summary>Disable a user</summary>
          <form action={disableUserAction} className="stack">
            <div className="field">
              <label htmlFor="du-user">User</label>
              <select id="du-user" name="userId" required>
                {users.map((u) => (
                  <option key={u.userId} value={u.userId}>
                    {u.displayName} ({roleList(u.roles)})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="du-reason">Reason (recorded)</label>
              <input id="du-reason" name="reason" required maxLength={500} />
            </div>
            <p className="hint">
              Their sessions end at once and any open assignments are flagged for reassignment.
            </p>
            <button type="submit" className="danger">
              Disable user now
            </button>
          </form>
        </details>
      </section>

      {/* DEC-073: what sits behind "Something Went Wrong ... reference N", for a
          site whose owner cannot read the host's logs. */}
      <details className="panel action" aria-labelledby="err-h" open={needsAttention || undefined}>
        <summary id="err-h">
          Recent errors and site health (for support)
          {errors.length ? ` · ${countOf(errors.length, 'error')}` : ''}
        </summary>
        <ul className="attention-list" aria-label="Site health for support">
          <li>
            <Chip tone={SCHEMA_TONE[support.schema.state]}>
              {SCHEMA_LABEL[support.schema.state]}
            </Chip>
            <span className="attention-list__title">Database schema</span>
            <span
              className="attention-list__meta"
              role={support.schema.state === 'current' ? undefined : 'alert'}
            >
              {schemaText(support.schema)}
            </span>
          </li>
          <li>
            <Chip tone={support.worker.alive ? 'done' : 'critical'}>
              {support.worker.alive ? 'Running' : 'Not running'}
            </Chip>
            <span className="attention-list__title">Background worker</span>
            <span
              className="attention-list__meta"
              role={support.worker.alive ? undefined : 'alert'}
            >
              {support.worker.alive
                ? `Last heartbeat ${support.worker.ageSeconds} seconds ago. It sends email, refreshes the directory and runs the schedules.`
                : `${support.worker.lastHeartbeatAt ? `Last heartbeat ${formatInstant(support.worker.lastHeartbeatAt)}.` : 'No heartbeat has ever been recorded.'} Without it, email is not sent and the directory is not refreshed on schedule. Ask the host to start the worker service.`}
            </span>
          </li>
          <li>
            <Chip tone={DATA_KEY_TONE[support.dataKey.state]}>
              {DATA_KEY_LABEL[support.dataKey.state]}
            </Chip>
            <span className="attention-list__title">Data key</span>
            <span
              className="attention-list__meta"
              role={support.dataKey.state === 'changed' ? 'alert' : undefined}
            >
              {dataKeyText(support.dataKey)}
            </span>
            {support.dataKey.repairableAddresses > 0 ? (
              <form action={repairSeededAddressesAction}>
                <button type="submit" className="secondary compact">
                  Repair{' '}
                  {countOf(
                    support.dataKey.repairableAddresses,
                    'seeded test address',
                    'seeded test addresses',
                  )}
                </button>
              </form>
            ) : null}
          </li>
          <li>
            <Chip tone={UPLOAD_TONE[support.uploads.state]}>
              {UPLOAD_LABEL[support.uploads.state]}
            </Chip>
            <span className="attention-list__title">Upload limit</span>
            <span
              className="attention-list__meta"
              role={support.uploads.state === 'build-too-small' ? 'alert' : undefined}
            >
              {uploadText(support.uploads)}
            </span>
          </li>
        </ul>
        <p className="hint" role="note">
          When a page says &ldquo;Something Went Wrong&rdquo; with a reference, the same reference
          is listed here with what happened. Quote both when asking for help. Nothing personal is
          recorded: the error&apos;s name, a shortened message and the page pattern, never who was
          signed in or what they typed.
        </p>
        {errors.length === 0 ? (
          <p className="meta">No errors recorded.</p>
        ) : (
          <ul className="attention-list">
            {errors.map((e) => (
              <li key={e.id}>
                <Chip tone="critical">{e.reference ? `Ref ${e.reference}` : 'No reference'}</Chip>
                <span className="attention-list__title">
                  {e.errorName}: {e.message || 'No message.'}
                </span>
                <span className="attention-list__meta">
                  {formatInstant(e.occurredAt)} · {e.method} {e.route}
                </span>
              </li>
            ))}
          </ul>
        )}
      </details>

      <details className="panel action" aria-labelledby="cfg-h">
        <summary id="cfg-h">Advanced settings (for technical support)</summary>
        <p className="hint" role="note">
          Low-level settings used by technical support. Not needed for everyday use. Never type a
          password or key here. {breakGlass.note}
        </p>
        {config.length === 0 ? (
          <p className="meta">No settings recorded yet.</p>
        ) : (
          <ul className="attention-list">
            {config.map((c) => (
              <li key={c.key}>
                <span className="attention-list__title">
                  <code>{c.key}</code> = <code>{JSON.stringify(c.value)}</code>
                  {c.secretRef ? (
                    <span className="attention-list__meta"> · secret ref: {c.secretRef}</span>
                  ) : null}
                </span>
                {c.reason ? <span className="attention-list__meta">{c.reason}</span> : null}
              </li>
            ))}
          </ul>
        )}
        <form action={setConfigAction} className="stack">
          <div className="field">
            <label htmlFor="sc-key">Setting name (for example bamboohr.scheduledSync)</label>
            <input id="sc-key" name="key" required maxLength={80} />
          </div>
          <div className="field">
            <label htmlFor="sc-value">Value (true, false, a number or text)</label>
            <input id="sc-value" name="value" required maxLength={500} />
          </div>
          <div className="field">
            <label htmlFor="sc-secret">Secret reference (optional, technical support only)</label>
            <input id="sc-secret" name="secretRef" maxLength={200} />
          </div>
          <div className="field">
            <label htmlFor="sc-reason">Why are you changing it? (recorded)</label>
            <input id="sc-reason" name="reason" required maxLength={500} />
          </div>
          <div className="actions-row">
            <button type="submit" className="secondary">
              Save setting
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}
