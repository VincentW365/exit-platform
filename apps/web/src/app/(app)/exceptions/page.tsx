import type { Metadata } from 'next';
import Link from 'next/link';
import { ServiceError, listExceptionFeed } from '@exit/db';
import { formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';

export const metadata: Metadata = { title: 'Exception feed' };
export const dynamic = 'force-dynamic';

const SEV_BADGE: Record<string, string> = {
  INFO: 'badge--neutral',
  WARNING: 'badge--warning',
  HIGH: 'badge--warning',
  CRITICAL: 'badge--danger',
};

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

  return (
    <>
      <h1>Exception feed</h1>
      <p className="hint">
        Escalation defaults: overdue tasks surface immediately; ordinary administrative tasks
        escalate to the HR Manager and department owner after two business days and become HIGH
        after three; exact-time access revocation is CRITICAL at its due instant. Restricted cases
        appear minimized to unauthorized viewers.
      </p>
      <form method="get" action="/exceptions" className="panel" aria-label="Exception filters">
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'end' }}>
          <div>
            <label htmlFor="f-status">Status</label>
            <select id="f-status" name="status" defaultValue={sp.status ?? ''}>
              <option value="">All</option>
              <option value="OPEN">Open</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          </div>
          <div>
            <label htmlFor="f-sev">Severity</label>
            <select id="f-sev" name="severity" defaultValue={sp.severity ?? ''}>
              <option value="">All</option>
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="WARNING">Warning</option>
              <option value="INFO">Info</option>
            </select>
          </div>
          <button type="submit">Apply</button>
        </div>
      </form>

      {rows.length === 0 ? (
        <p className="panel">No exceptions match this filter.</p>
      ) : (
        <div className="panel" style={{ overflowX: 'auto' }} tabIndex={0}>
          <table>
            <caption className="visually-hidden">Exceptions</caption>
            <thead>
              <tr>
                <th scope="col">Severity</th>
                <th scope="col">Type</th>
                <th scope="col">Case</th>
                <th scope="col">Detail</th>
                <th scope="col">Owner</th>
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
                  <td>{r.exceptionType}</td>
                  <td>
                    {r.caseId ? (
                      <Link href={`/cases/${r.caseId}/clearance`}>{r.caseNumber}</Link>
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
                  </td>
                  <td>{r.ownerDepartment ?? '-'}</td>
                  <td>
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
