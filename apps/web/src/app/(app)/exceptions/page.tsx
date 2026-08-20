import type { Metadata } from 'next';
import Link from 'next/link';
import { ServiceError, exceptionOwnerDepartments, listExceptionFeed } from '@exit/db';
import { formatInstant, hasRole } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import { humanize } from '@/lib/text';
import { resolveFeedExceptionAction } from './actions';
import { EmptyState } from '@/components/EmptyState';
import { CheckCircleIcon } from '@/components/icons';

export const metadata: Metadata = { title: 'Exceptions' };
export const dynamic = 'force-dynamic';

const SEV_BADGE: Record<string, string> = {
  INFO: 'badge--neutral',
  WARNING: 'badge--warning',
  HIGH: 'badge--warning',
  CRITICAL: 'badge--danger',
};

const DEPT_LABEL: Record<string, string> = {
  HR: 'HR',
  IT: 'IT',
  FINANCE: 'Finance',
  LINE_MANAGER: 'Manager',
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
  // Directive 6.3 exception types were missing from this filter entirely.
  'RECIPIENT_MISSING',
  'BENEFITS_APPLICABILITY_UNKNOWN',
  'ACKNOWLEDGEMENT_OVERDUE',
  'AUTO_SEND_BLOCKED',
] as const;

/** Directive 6.2 (Y): each exception links to the surface that fixes it. */
function targetTab(exceptionType: string): string {
  if (exceptionType.startsWith('ASSET_')) return '/assets';
  // The handover surface was retired; a historical exception opens its case.
  if (exceptionType === 'HANDOVER_OVERDUE') return '';
  if (exceptionType.startsWith('NOTIFICATION_')) return '/notifications';
  // Directive 6.3 email-action exceptions are fixed on the Email actions tab;
  // benefits uncertainty is confirmed on the case overview.
  if (
    exceptionType === 'RECIPIENT_MISSING' ||
    exceptionType === 'ACKNOWLEDGEMENT_OVERDUE' ||
    exceptionType === 'AUTO_SEND_BLOCKED'
  )
    return '/notifications';
  if (exceptionType === 'BENEFITS_APPLICABILITY_UNKNOWN') return '';
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
  let ownerDepartments: string[] = [];
  try {
    ownerDepartments = await exceptionOwnerDepartments(actor);
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
          <h1>Exceptions</h1>
          <p className="panel">Your role does not include the exception list.</p>
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
      <h1>Exceptions</h1>
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint">
        What went wrong, who owns it, and where to fix it. Overdue work appears here immediately and
        escalates to the HR Manager and the owning department; access revocation timed to an exact
        moment is treated as critical from that moment. Restricted cases stay minimized for anyone
        not assigned to them.
      </p>
      <form method="get" action="/exceptions" className="panel" aria-label="Exception filters">
        <div className="filter-toolbar">
          <div className="field field--sm">
            <label htmlFor="f-status">Status</label>
            <select id="f-status" name="status" defaultValue={sp.status ?? ''}>
              <option value="">All</option>
              <option value="OPEN">Open</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          </div>
          <div className="field field--sm">
            <label htmlFor="f-sev">Severity</label>
            <select id="f-sev" name="severity" defaultValue={sp.severity ?? ''}>
              <option value="">All</option>
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="WARNING">Warning</option>
              <option value="INFO">Info</option>
            </select>
          </div>
          <div className="field field--lg">
            <label htmlFor="f-type">Type</label>
            <select id="f-type" name="type" defaultValue={sp.type ?? ''}>
              <option value="">All</option>
              {EXCEPTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {humanize(t)}
                </option>
              ))}
            </select>
          </div>
          {/* Offered only when exceptions genuinely span owners (owner
              request, 2026-08-18): IT/Finance owners exist on legacy
              instances only. */}
          {ownerDepartments.length > 1 || sp.dept ? (
            <div className="field field--sm">
              <label htmlFor="f-dept">Owning Department</label>
              <select id="f-dept" name="dept" defaultValue={sp.dept ?? ''}>
                <option value="">All</option>
                {ownerDepartments.map((d) => (
                  <option key={d} value={d}>
                    {DEPT_LABEL[d] ?? d}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <button type="submit" className="secondary">
            Apply Filters
          </button>
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<CheckCircleIcon />}
            tone="done"
            title="No exceptions to resolve"
            body="Nothing matches this filter. Exceptions appear here the moment the platform detects work that needs a decision."
          />
        </div>
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
                      {humanize(r.severity)}
                    </span>
                  </td>
                  <td>{humanize(r.exceptionType)}</td>
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
                            <label htmlFor={`fx-res-${r.id}`}>Resolution (Required, Audited)</label>
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
                              Security Exception (HR Manager)
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
                      {humanize(r.status)}
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
