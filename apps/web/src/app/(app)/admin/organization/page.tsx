import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ServiceError,
  getOrgOverview,
  keyOfficeholders,
  listDirectoryAccounts,
  listDirectoryPeopleForMapping,
} from '@exit/db';
import { ROLES, can, formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import { enableDirectoryAccountAction, mapDirectoryPersonAction } from './actions';
import { countOf, humanize, roleLabel, roleList } from '@/lib/text';

export const metadata: Metadata = { title: 'Organization and Assignment Mapping' };
export const dynamic = 'force-dynamic';

const SEVERITY_BADGE: Record<string, string> = {
  ACTION_REQUIRED: 'badge--danger',
  WARNING: 'badge--warning',
  INFO: 'badge--info',
};

const HEALTH_BADGE: Record<string, string> = {
  HEALTHY: 'badge--success',
  WARNING: 'badge--warning',
  ACTION_REQUIRED: 'badge--danger',
};

export default async function OrganizationAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  if (!can(actor, 'admin.organization') && !can(actor, 'org.view')) redirect('/unauthorized');
  const sp = await searchParams;

  const canMap = can(actor, 'admin.roles');
  let data: Awaited<ReturnType<typeof getOrgOverview>>;
  let officeholders: Awaited<ReturnType<typeof keyOfficeholders>>;
  let mappedAccounts: Awaited<ReturnType<typeof listDirectoryAccounts>> = [];
  let mappablePeople: Awaited<ReturnType<typeof listDirectoryPeopleForMapping>> = [];
  try {
    data = await getOrgOverview(actor);
    officeholders = await keyOfficeholders(actor);
    mappedAccounts = await listDirectoryAccounts(actor);
    if (canMap) mappablePeople = await listDirectoryPeopleForMapping(actor);
  } catch (e) {
    if (e instanceof ServiceError)
      return (
        <>
          <h1>Access Restricted</h1>
          <p className="panel">Organization mapping requires an authorized role.</p>
        </>
      );
    throw e;
  }
  const r = data.report;

  return (
    <>
      <h1>
        Organization and Assignment Mapping{' '}
        <span className={`badge ${HEALTH_BADGE[r.health]}`}>{humanize(r.health)}</span>
      </h1>
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint" role="note">
        Validation of the synchronized directory before hierarchy-driven routing is trusted
        (Directive 6.1 C). Aggregate view - employee detail stays on the case surfaces. Sync and
        reconciliation run from <Link href="/directory">Directory</Link> and{' '}
        <Link href="/admin/system">System administration</Link>; role assignments are managed in{' '}
        <Link href="/admin">Administration</Link>.
      </p>

      <section className="panel" aria-labelledby="stats-h">
        <h2 id="stats-h">Directory Statistics</h2>
        <div className="stat-grid">
          {(
            [
              ['Employees', r.stats.employees],
              ['Active', r.stats.activeEmployees],
              ['Inactive', r.stats.inactiveEmployees],
              ['Departments', r.stats.departments],
              ['Divisions', r.stats.divisions],
              ['Positions', r.stats.positions],
              ['Locations', r.stats.locations],
              ['Manager links', r.stats.managerRelationships],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="stat">
              <span className="stat__value tabular-nums">{value}</span>
              <span className="badge badge--neutral">{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel" aria-labelledby="checks-h">
        <h2 id="checks-h">Hierarchy Validation ({countOf(r.findings.length, 'finding')})</h2>
        {r.findings.length === 0 ? (
          <p className="ok-summary" role="status">
            Every organization check passed - hierarchy-driven routing is trustworthy.
          </p>
        ) : (
          <div className="table-wrap" tabIndex={0}>
            <table className="data">
              <caption className="visually-hidden">Organization validation findings</caption>
              <thead>
                <tr>
                  <th scope="col">Severity</th>
                  <th scope="col">Check</th>
                  <th scope="col">Subject</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {r.findings.map((f) => (
                  <tr key={`${f.checkId}-${f.subject}`}>
                    <td>
                      <span className={`badge ${SEVERITY_BADGE[f.severity]}`}>
                        {humanize(f.severity)}
                      </span>
                    </td>
                    <td>
                      <code>{f.checkId}</code>
                    </td>
                    <td>{f.subject}</td>
                    <td>{f.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="office-h">
        <h2 id="office-h">Key Officeholders</h2>
        {officeholders.length === 0 ? (
          <p className="hint">
            No officeholders resolved yet. After a directory synchronization this table names who
            actually holds each key function (HR Manager, Finance Manager, IT lead) based on
            department and position - nothing is hard-coded.
          </p>
        ) : (
          <div className="table-wrap" tabIndex={0}>
            <table className="data">
              <caption className="visually-hidden">Key officeholders</caption>
              <thead>
                <tr>
                  <th scope="col">Function</th>
                  <th scope="col">Person</th>
                  <th scope="col">Position</th>
                  <th scope="col">Department</th>
                  <th scope="col">Location</th>
                  <th scope="col">Direct reports</th>
                </tr>
              </thead>
              <tbody>
                {officeholders.map((o) => (
                  <tr key={`${o.office}-${o.person.sourceId}`}>
                    <td>
                      <strong>{o.office}</strong>
                    </td>
                    <td>{o.person.displayName}</td>
                    <td>{o.person.jobTitle ?? '-'}</td>
                    <td>{o.person.department ?? '-'}</td>
                    <td>{o.person.location ?? '-'}</td>
                    <td className="tabular-nums">{o.directReports}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="map-h">
        <h2 id="map-h">Directory Role Mapping</h2>
        <p className="hint">
          Map real colleagues from the synchronized directory to their application responsibilities
          (DEC-043). Accounts exist only in this local environment; sign-in lists them under
          &quot;Directory-mapped staff&quot;. Every creation, grant and enable/disable is audited.
        </p>
        {mappedAccounts.length === 0 ? (
          <p className="hint">No directory-mapped accounts yet.</p>
        ) : (
          <div className="table-wrap" tabIndex={0}>
            <table className="data">
              <caption className="visually-hidden">Directory-mapped accounts</caption>
              <thead>
                <tr>
                  <th scope="col">Person</th>
                  <th scope="col">Department</th>
                  <th scope="col">Application roles</th>
                  <th scope="col">Status</th>
                  {canMap ? <th scope="col">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {mappedAccounts.map((u) => (
                  <tr key={u.userId}>
                    <td>{u.displayName}</td>
                    <td>{u.department ?? '-'}</td>
                    <td>{roleList(u.roles, 'None')}</td>
                    <td>{u.isActive ? 'Active' : 'Disabled'}</td>
                    {canMap ? (
                      <td>
                        {u.isActive ? (
                          <span className="hint">
                            Disable / roles: <Link href="/admin/system">System</Link> /{' '}
                            <Link href="/admin">Users</Link>
                          </span>
                        ) : (
                          <details className="action">
                            <summary>Re-enable</summary>
                            <form action={enableDirectoryAccountAction} className="stack">
                              <input type="hidden" name="userId" value={u.userId} />
                              <div className="field">
                                <label htmlFor={`en-reason-${u.userId}`}>Reason (Audited)</label>
                                <input id={`en-reason-${u.userId}`} name="reason" required />
                              </div>
                              <button type="submit">Re-enable account (audited)</button>
                            </form>
                          </details>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canMap ? (
          <details className="action">
            <summary>Map a directory person to an application account</summary>
            <form action={mapDirectoryPersonAction} className="stack">
              <div className="field">
                <label htmlFor="map-person">Directory Person</label>
                <select id="map-person" name="person" required defaultValue="">
                  <option value="" disabled>
                    Choose from the synchronized directory...
                  </option>
                  {mappablePeople.map((p) => (
                    <option
                      key={`${p.sourceSystem}|${p.sourceId}`}
                      value={`${p.sourceSystem}|${p.sourceId}`}
                    >
                      {p.displayName}
                      {p.jobTitle ? ` - ${p.jobTitle}` : ''}
                      {p.department ? ` (${p.department})` : ''}
                    </option>
                  ))}
                </select>
                <p className="hint">
                  Only active people with a work email appear; run a synchronization first if the
                  list looks stale.
                </p>
              </div>
              <fieldset>
                <legend>Application Roles</legend>
                {ROLES.map((r) => (
                  <label key={r} style={{ display: 'block', fontWeight: 400 }}>
                    <input type="checkbox" name="roles" value={r} /> {roleLabel(r)}
                  </label>
                ))}
              </fieldset>
              <div className="field">
                <label htmlFor="map-reason">Reason (Audited)</label>
                <input id="map-reason" name="reason" required maxLength={300} />
              </div>
              <button type="submit">Create account and grant roles (audited)</button>
            </form>
          </details>
        ) : (
          <p className="hint">
            Account creation and role grants require the System Administrator (role separation).
          </p>
        )}
      </section>

      {/* IT/Finance application accounts are retired (they act by controlled
          email), so their counts are no longer a coverage measure - the
          retired-role figures remain on the access review for history. */}
      <section className="panel" aria-labelledby="cov-h">
        <h2 id="cov-h">Application Coverage</h2>
        <dl className="kv">
          <dt>HR Users</dt>
          <dd className="tabular-nums">{data.coverage.hrResponders}</dd>
          <dt>Directory Departments</dt>
          <dd>{data.coverage.departments.join(', ') || '-'}</dd>
        </dl>
      </section>

      <section className="panel" aria-labelledby="mgr-h">
        <h2 id="mgr-h">Managers and Direct Reports</h2>
        {data.managers.length === 0 ? (
          <div className="empty">
            <p>
              <strong>No manager relationships are recorded yet.</strong>
            </p>
            <p className="hint">
              Run a directory synchronization from the <Link href="/admin/system">System</Link> page
              to build the organization graph.
            </p>
          </div>
        ) : (
          <div className="table-wrap" tabIndex={0}>
            <table className="data">
              <caption className="visually-hidden">Managers with direct reports</caption>
              <thead>
                <tr>
                  <th scope="col">Manager</th>
                  <th scope="col">Position</th>
                  <th scope="col">Department</th>
                  <th scope="col">Status</th>
                  <th scope="col">Direct reports</th>
                </tr>
              </thead>
              <tbody>
                {data.managers.map((m) => (
                  <tr key={m.manager.sourceId}>
                    <td>{m.manager.displayName}</td>
                    <td>{m.manager.jobTitle ?? '-'}</td>
                    <td>{m.manager.department ?? '-'}</td>
                    <td>{m.manager.active ? 'Active' : 'Inactive'}</td>
                    <td className="tabular-nums">{m.directReports}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="warn-h">
        <h2 id="warn-h">Post-activation Hierarchy Changes</h2>
        {data.hierarchyWarnings.length === 0 ? (
          <p className="hint">
            No activated case has drifted from the directory hierarchy. When a sync detects a
            manager change on an active case, it is flagged here for HR review - existing
            assignments are never changed silently.
          </p>
        ) : (
          <ul>
            {data.hierarchyWarnings.map((w) => (
              <li key={w.caseId}>
                <span className="badge badge--warning">Review</span>{' '}
                <Link href={`/cases/${w.caseId}/assignment`}>{w.caseNumber}</Link> -{' '}
                {w.employeeDisplayName}: confirmed manager {w.managerName ?? '-'} vs directory{' '}
                {w.directoryManagerName ?? '-'} (flagged {formatInstant(w.flaggedAt)})
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
