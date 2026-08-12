import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ServiceError, getOrgOverview, keyOfficeholders } from '@exit/db';
import { can, formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';

export const metadata: Metadata = { title: 'Organization and assignment mapping' };
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

  let data: Awaited<ReturnType<typeof getOrgOverview>>;
  let officeholders: Awaited<ReturnType<typeof keyOfficeholders>>;
  try {
    data = await getOrgOverview(actor);
    officeholders = await keyOfficeholders(actor);
  } catch (e) {
    if (e instanceof ServiceError)
      return (
        <>
          <h1>Access restricted</h1>
          <p className="panel">Organization mapping requires an authorized role.</p>
        </>
      );
    throw e;
  }
  const r = data.report;

  return (
    <>
      <h1>
        Organization and assignment mapping{' '}
        <span className={`badge ${HEALTH_BADGE[r.health]}`}>{r.health.replaceAll('_', ' ')}</span>
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
        <h2 id="stats-h">Directory statistics</h2>
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
        <h2 id="checks-h">Hierarchy validation ({r.findings.length} finding(s))</h2>
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
                        {f.severity.replaceAll('_', ' ')}
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
        <h2 id="office-h">Key officeholders (from the directory)</h2>
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

      <section className="panel" aria-labelledby="cov-h">
        <h2 id="cov-h">Application responder coverage</h2>
        <dl className="kv">
          <dt>IT responders</dt>
          <dd className="tabular-nums">{data.coverage.itResponders}</dd>
          <dt>Finance responders</dt>
          <dd className="tabular-nums">{data.coverage.financeResponders}</dd>
          <dt>HR users</dt>
          <dd className="tabular-nums">{data.coverage.hrResponders}</dd>
          <dt>Directory departments</dt>
          <dd>{data.coverage.departments.join(', ') || '-'}</dd>
        </dl>
      </section>

      <section className="panel" aria-labelledby="mgr-h">
        <h2 id="mgr-h">Managers and direct reports</h2>
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
        <h2 id="warn-h">Post-activation hierarchy changes</h2>
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
                <span className="badge badge--warning">REVIEW</span>{' '}
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
