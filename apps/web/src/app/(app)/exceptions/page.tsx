import type { Metadata } from 'next';
import Link from 'next/link';
import { ServiceError, listExceptionFeed } from '@exit/db';
import { formatInstant, hasRole } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import { resolveFeedExceptionAction } from './actions';

export const metadata: Metadata = { title: 'Exception feed' };
export const dynamic = 'force-dynamic';

const SEV_BADGE: Record<string, string> = {
  INFO: 'badge--neutral',
  WARNING: 'badge--warning',
  HIGH: 'badge--warning',
  CRITICAL: 'badge--danger',
};

const EXCEPTION_TYPES = [
  'TASK_OVERDUE',
  'CRITICAL_ACCESS_OVERDUE',
  'TASK_BLOCKED',
  'RENDER_FAILED',
  'DOCUMENT_UNAPPROVED',
  'NOTIFICATION_OVERDUE',
  'NOTIFICATION_FAILED',
  'ASSET_OVERDUE',
  'ASSET_UNRESOLVED',
  'HANDOVER_OVERDUE',
  'MISSING_APPROVAL',
  'INVALID_CASE_DATE',
  'WORKFLOW_ACTIVATION_FAILURE',
  'DUE_DATE_RETROSPECTIVE_CHANGE',
  'CLEARANCE_BLOCKED',
] as const;

/** Directive 6.2 (Y): each exception links to the surface that fixes it. */
function targetTab(exceptionType: string): string {
  if (exceptionType.startsWith('ASSET_')) return '/assets';
  if (exceptionType === 'HANDOVER_OVERDUE') return '/handover';
  if (exceptionType.startsWith('NOTIFICATION_')) return '/notifications';
  if (exceptionType === 'RENDER_FAILED' || exceptionType === 'DOCUMENT_UNAPPROVED')
    return '/documents';
  if (exceptionType === 'CLEARANCE_BLOCKED' || exceptionType === 'INVALID_CASE_DATE')
    return '/clearance';
  return '/workflow';
}

export default async function ExceptionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const sp = await searchParams;

  let rows: Awaited<ReturnType<typeof listExceptionFeed>>;
  try {
    rows = await listExceptionFeed(actor, {
      status: sp.status === 'RESOLVED' ? 'RESOLVED' : sp.status === 'OPEN' ? 'OPEN' : undefined,
      severity:
        sp.severity === 'CRITICAL' ||
        sp.severity === 'HIGH' ||
        sp.severity === 'WARNING' ||
        sp.severity === 'INFO'
          ? sp.severity
          : undefined,
      exceptionType: (EXCEPTION_TYPES as readonly string[]).includes(sp.type ?? '')
        ? sp.type
        : undefined,
      ownerDepartment:
        sp.dept === 'HR' || sp.dept === 'IT' || sp.dept === 'FINANCE' || sp.dept === 'LINE_MANAGER'
          ? sp.dept
          : undefined,
    });
  } catch (e) {
    if (e instanceof ServiceError && e.code === 'FORBIDDEN')
      return (
        <>
          <h1>Exception feed</h1>
          <p className="panel">Your role does not include the exception feed.</p>
        </>
      );
    throw e;
  }

  const canResolve = hasRole(actor, 'HR_MANAGER', 'HR_OFFICER');
  const filterQuery = (() => {
    const p = new URLSearchParams();
    for (const k of ['status', 'severity', 'type', 'dept'] as const) {
      if (sp[k]) p.set(k, sp[k]!);
    }
    return p.toString();
  })();

  return (
    <>
      <h1>Exception feed</h1>
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint">
        Every exception answers: what happened, who owns it, and where to fix it. Overdue tasks
        surface immediately; ordinary tasks escalate to the HR Manager and department owner per the
        configurable thresholds; exact-time access revocation is CRITICAL at its due instant.
        Restricted cases appear minimized to unauthorized viewers.
      </p>
      <form method="get" action="/exceptions" className="panel" aria-label="Exception filters">
        <div className="filter-toolbar">
          <div className="field" style={{ maxWidth: '9rem' }}>
            <label htmlFor="f-status">Status</label>
            <select id="f-status" name="status" defaultValue={sp.status ?? ''}>
              <option value="">All</option>
              <option value="OPEN">Open</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          </div>
          <div className="field" style={{ maxWidth: '9rem' }}>
            <label htmlFor="f-sev">Severity</label>
            <select id="f-sev" name="severity" defaultValue={sp.severity ?? ''}>
              <option value="">All</option>
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="WARNING">Warning</option>
              <option value="INFO">Info</option>
            </select>
          </div>
          <div className="field" style={{ maxWidth: '16rem' }}>
            <label htmlFor="f-type">Type</label>
            <select id="f-type" name="type" defaultValue={sp.type ?? ''}>
              <option value="">All</option>
              {EXCEPTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ maxWidth: '11rem' }}>
            <label htmlFor="f-dept">Owning department</label>
            <select id="f-dept" name="dept" defaultValue={sp.dept ?? ''}>
              <option value="">All</option>
              <option value="HR">HR</option>
              <option value="IT">IT</option>
              <option value="FINANCE">Finance</option>
              <option value="LINE_MANAGER">Manager</option>
            </select>
          </div>
          <button type="submit">Apply</button>
        </div>
      </form>

      {rows.length === 0 ? (
        <p className="panel">No exceptions match this filter.</p>
      ) : (
        <div className="panel" style={{ overflowX: 'auto' }} tabIndex={0}>
          <table className="table-sticky">
            <caption className="visually-hidden">Exceptions</caption>
            <thead>
              <tr>
                <th scope="col">Severity</th>
                <th scope="col">Type</th>
                <th scope="col">Case</th>
                <th scope="col">Detail</th>
                <th scope="col">Owner</th>
                <th scope="col">Due</th>
                <th scope="col">Age</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className={`badge ${SEV_BADGE[r.severity] ?? 'badge--neutral'}`}>
                      {r.severity}
                    </span>
                  </td>
                  <td>{r.exceptionType.replaceAll('_', ' ')}</td>
                  <td>
                    {r.caseId ? (
                      <Link href={`/cases/${r.caseId}${targetTab(r.exceptionType)}`}>
                        {r.caseNumber}
                      </Link>
                    ) : (
                      r.caseNumber
                    )}
                    {r.employeeDisplayName ? (
                      <>
                        <br />
                        <span className="hint">{r.employeeDisplayName}</span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    {r.title}
                    {r.detail ? (
                      <>
                        <br />
                        <span className="hint">{r.detail}</span>
                      </>
                    ) : null}
                    {r.resolution ? (
                      <>
                        <br />
                        <span className="hint">
                          Resolved{r.securityExceptionApproved ? ' (security exception)' : ''}:{' '}
                          {r.resolution}
                        </span>
                      </>
                    ) : null}
                    {canResolve && r.status === 'OPEN' && r.caseId ? (
                      <details className="action" style={{ marginTop: '0.3rem' }}>
                        <summary>Resolve</summary>
                        <form action={resolveFeedExceptionAction} className="stack">
                          <input type="hidden" name="exceptionId" value={r.id} />
                          <input type="hidden" name="query" value={filterQuery} />
                          <div className="field">
                            <label htmlFor={`fx-res-${r.id}`}>Resolution (required, audited)</label>
                            <textarea
                              id={`fx-res-${r.id}`}
                              name="resolution"
                              required
                              rows={2}
                              maxLength={1000}
                            />
                          </div>
                          {r.severity === 'CRITICAL' ? (
                            <label style={{ fontWeight: 400 }}>
                              <input type="checkbox" name="securityException" /> Approve as a
                              security exception (HR Manager)
                            </label>
                          ) : null}
                          <button type="submit" className="compact">
                            Resolve exception
                          </button>
                        </form>
                      </details>
                    ) : null}
                  </td>
                  <td>
                    {r.ownerName ?? <span className="hint">{r.ownerDepartment ?? '-'}</span>}
                    {r.ownerName && r.ownerDepartment ? (
                      <>
                        <br />
                        <span className="hint">{r.ownerDepartment}</span>
                      </>
                    ) : null}
                  </td>
                  <td className="tabular-nums">{r.dueAt ? formatInstant(r.dueAt) : '-'}</td>
                  <td className="tabular-nums">
                    {r.ageMinutes >= 1440
                      ? `${Math.floor(r.ageMinutes / 1440)}d`
                      : r.ageMinutes >= 60
                        ? `${Math.floor(r.ageMinutes / 60)}h`
                        : `${r.ageMinutes}m`}
                    <br />
                    <span className="hint">{formatInstant(r.createdAt)}</span>
                  </td>
                  <td>
                    <span
                      className={`badge ${r.status === 'OPEN' ? 'badge--warning' : 'badge--success'}`}
                    >
                      {r.status}
                    </span>
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
