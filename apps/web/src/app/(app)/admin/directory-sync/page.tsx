import Link from 'next/link';
import type { Metadata } from 'next';
import { ServiceError, directorySyncStatus, listDirectorySyncRuns } from '@exit/db';
import {
  DIRECTORY_SYNC_KINDS,
  DIRECTORY_SYNC_KIND_LABELS,
  DIRECTORY_SYNC_STATUSES,
  DIRECTORY_SYNC_STATUS_LABELS,
  can,
  formatInstant,
} from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { DirectoryFreshnessNote } from '@/components/DirectoryFreshness';
import { EmptyState } from '@/components/EmptyState';
import { ServerIcon } from '@/components/icons';
import { Kpi } from '@/components/patterns';
import { RefreshWatcher } from '@/components/RefreshWatcher';

export const metadata: Metadata = { title: 'Directory Synchronization' };
export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<string, string> = {
  QUEUED: 'badge--info',
  RUNNING: 'badge--info',
  SUCCESS: 'badge--success',
  PARTIAL: 'badge--warning',
  FAILED: 'badge--danger',
};

function parseDate(v: string | undefined, endOfDay = false): Date | undefined {
  if (!v) return undefined;
  const d = new Date(`${v}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const seconds = (a: Date | null, b: Date | null): string =>
  a && b ? `${Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000))}s` : '-';

/**
 * Synchronization audit log (owner directive, 2026-09-15, sections 26-27):
 * every run - webhook, hourly, nightly, start-up, manual - with what it
 * checked, changed, archived and failed. Counts and field NAMES only; no
 * employee values are stored on a run.
 */
export default async function DirectorySyncPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const sp = await searchParams;
  if (!can(actor, 'directory.viewSync'))
    return (
      <>
        <h1 className="page-title">Access Restricted</h1>
        <p className="panel">The synchronization log requires the HR Manager role.</p>
      </>
    );
  let runs: Awaited<ReturnType<typeof listDirectorySyncRuns>> = [];
  let status: Awaited<ReturnType<typeof directorySyncStatus>> | null = null;
  try {
    [runs, status] = await Promise.all([
      listDirectorySyncRuns(actor, {
        from: parseDate(sp.from),
        to: parseDate(sp.to, true),
        kind: sp.kind || undefined,
        status: sp.status || undefined,
        employee: sp.employee || undefined,
        errorsOnly: sp.errors === 'yes',
        limit: 200,
      }),
      directorySyncStatus(),
    ]);
  } catch (e) {
    if (!(e instanceof ServiceError)) throw e;
  }

  return (
    <>
      <p className="crumbs">
        <Link href="/admin">Administration</Link>
      </p>
      <h1 className="page-title">Directory Synchronization</h1>
      <p className="page-lede">
        How the employee directory stays in step with BambooHR: webhooks for changes as they happen,
        an hourly reconciliation, a full reconciliation every night, and manual refreshes. BambooHR
        is the system of record; this platform never writes employee data back.
      </p>

      {status ? (
        <>
          <DirectoryFreshnessNote
            freshness={status.freshness}
            lastSuccessfulAt={status.lastSuccessfulAt}
            admin={can(actor, 'admin.system')}
          />
          <RefreshWatcher active={Boolean(status.activeRun)} />
          <div className="kpi-grid">
            <Kpi
              label="Connection"
              value={
                status.connection === 'HEALTHY'
                  ? 'Healthy'
                  : status.connection === 'FAILING'
                    ? 'Failing'
                    : 'Unknown'
              }
              tone={
                status.connection === 'HEALTHY'
                  ? 'done'
                  : status.connection === 'FAILING'
                    ? 'critical'
                    : 'pending'
              }
              note={`${status.mode} adapter · ${status.scheduledSyncEnabled ? 'scheduled reconciliation on' : 'scheduled reconciliation off'}${status.simulatedOutage ? ' · SIMULATED OUTAGE' : ''}`}
              icon={<ServerIcon />}
            />
            <Kpi
              label="Local employees"
              value={status.employees}
              note={`${status.totalRecords} records · ${status.archived} archived`}
            />
            <Kpi
              label="Last event (webhook)"
              value={status.lastEventAt ? formatInstant(status.lastEventAt) : 'None yet'}
              note={
                status.webhookConfigured ? 'Webhook endpoint enabled' : 'Webhook key not configured'
              }
            />
            <Kpi
              label="Last incremental"
              value={
                status.lastIncrementalAt ? formatInstant(status.lastIncrementalAt) : 'None yet'
              }
              note={`Every ${status.settings.hourlyMinutes} min`}
            />
            <Kpi
              label="Last full"
              value={status.lastFullAt ? formatInstant(status.lastFullAt) : 'None yet'}
              note={`Nightly at ${String(status.settings.nightlyHour).padStart(2, '0')}:${String(status.settings.nightlyMinute).padStart(2, '0')} Jamaica`}
            />
          </div>
        </>
      ) : null}

      <form method="get" className="panel" aria-label="Filter synchronization runs">
        <div className="filter-toolbar">
          <div className="field field--sm">
            <label htmlFor="f-from">From</label>
            <input id="f-from" type="date" name="from" defaultValue={sp.from ?? ''} />
          </div>
          <div className="field field--sm">
            <label htmlFor="f-to">To</label>
            <input id="f-to" type="date" name="to" defaultValue={sp.to ?? ''} />
          </div>
          <div className="field field--md">
            <label htmlFor="f-kind">Kind</label>
            <select id="f-kind" name="kind" defaultValue={sp.kind ?? ''}>
              <option value="">Any</option>
              {DIRECTORY_SYNC_KINDS.map((k) => (
                <option key={k} value={k}>
                  {DIRECTORY_SYNC_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="field field--md">
            <label htmlFor="f-status">Result</label>
            <select id="f-status" name="status" defaultValue={sp.status ?? ''}>
              <option value="">Any</option>
              {DIRECTORY_SYNC_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {DIRECTORY_SYNC_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="field field--md">
            <label htmlFor="f-emp">Employee (name, id or #)</label>
            <input id="f-emp" type="search" name="employee" defaultValue={sp.employee ?? ''} />
          </div>
          <div className="field field--sm">
            <label htmlFor="f-err">Errors only</label>
            <select id="f-err" name="errors" defaultValue={sp.errors ?? ''}>
              <option value="">No</option>
              <option value="yes">Yes</option>
            </select>
          </div>
          <button type="submit">Filter</button>
          <Link className="button secondary" href="/admin/directory-sync">
            Clear
          </Link>
        </div>
      </form>

      {runs.length === 0 ? (
        <EmptyState
          icon={<ServerIcon />}
          title="No synchronization runs"
          body="Runs appear here as webhooks arrive, reconciliations execute and the HR Manager refreshes the directory."
          action={
            can(actor, 'admin.system')
              ? { href: '/admin/system#directory-h', label: 'Refresh the directory now' }
              : undefined
          }
        />
      ) : (
        <div className="table-wrap" tabIndex={0}>
          <table className="data">
            <caption className="sr-only">Directory synchronization runs</caption>
            <thead>
              <tr>
                <th scope="col">Requested</th>
                <th scope="col">Kind</th>
                <th scope="col">Result</th>
                <th scope="col">Employee</th>
                <th scope="col">Checked</th>
                <th scope="col">Added</th>
                <th scope="col">Updated</th>
                <th scope="col">Archived</th>
                <th scope="col">Failed</th>
                <th scope="col">Duration</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} data-sync-run={r.kind}>
                  <td>{formatInstant(r.requestedAt)}</td>
                  <td>
                    {DIRECTORY_SYNC_KIND_LABELS[
                      r.kind as keyof typeof DIRECTORY_SYNC_KIND_LABELS
                    ] ?? r.kind}
                  </td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[r.status] ?? 'badge--neutral'}`}>
                      {DIRECTORY_SYNC_STATUS_LABELS[
                        r.status as keyof typeof DIRECTORY_SYNC_STATUS_LABELS
                      ] ?? r.status}
                    </span>
                  </td>
                  <td>
                    {r.employee ? (
                      <Link href={`/directory/${r.employee.id}`}>{r.employee.displayName}</Link>
                    ) : r.employeeSourceId ? (
                      <span className="hint">id {r.employeeSourceId}</span>
                    ) : (
                      <span className="hint">Whole directory</span>
                    )}
                  </td>
                  <td className="tabular-nums">{r.checked}</td>
                  <td className="tabular-nums">{r.added}</td>
                  <td className="tabular-nums">{r.updated}</td>
                  <td className="tabular-nums">{r.archived}</td>
                  <td className="tabular-nums">{r.failed}</td>
                  <td className="tabular-nums">{seconds(r.startedAt, r.finishedAt)}</td>
                  <td>
                    {r.errorCode ? (
                      <span className="hint">
                        <strong>{r.errorCode}</strong>
                        {r.errorDetail ? ` - ${r.errorDetail}` : ''}
                      </span>
                    ) : r.changedFields.length ? (
                      <span className="hint">Fields: {r.changedFields.join(', ')}</span>
                    ) : (
                      ''
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
