import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { can, formatDateOnly, formatInstant, withinCaseCaptureSla } from '@exit/domain';
import { baselineDashboard, getActiveCalendar } from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { BaselineBanner, StatusBadge } from '@/components/ui';
import { humanize } from '@/lib/text';
import { EmptyState } from '@/components/EmptyState';
import { ChartIcon } from '@/components/icons';

export const metadata: Metadata = { title: 'Baseline' };
export const dynamic = 'force-dynamic';

export default async function BaselinePage() {
  const { actor } = await requireAuth();
  if (!can(actor, 'baseline.viewDashboard')) redirect('/unauthorized');

  const [rows, calendar] = await Promise.all([baselineDashboard(actor), getActiveCalendar()]);

  return (
    <>
      <h1>Baseline Data Completeness</h1>
      <BaselineBanner />
      <p>
        BASELINE-cohort operational cases and their manually recorded facts
        (BaselineDataCapturePlan). Training and test records are excluded by construction.{' '}
        <a className="button secondary" href="/api/baseline-export">
          Export CSV (audited)
        </a>
      </p>

      {rows.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<ChartIcon />}
            title="No baseline cases yet"
            body="Baseline records are the manually measured cases used for before-and-after comparison."
          />
        </div>
      ) : (
        <div className="table-wrap" tabIndex={0}>
          <table className="data">
            <caption>
              {rows.length} baseline case{rows.length === 1 ? '' : 's'}; capture SLA evaluated
              against the configured business calendar (synthetic holidays until DEC-027 is
              approved)
            </caption>
            <thead>
              <tr>
                <th scope="col">Case</th>
                <th scope="col">Type</th>
                <th scope="col">Status</th>
                <th scope="col">Received</th>
                <th scope="col">Captured within 1 business day</th>
                <th scope="col">Facts recorded</th>
                <th scope="col">Missing facts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/cases/${r.id}`}>{r.caseNumber}</Link>
                  </td>
                  <td>{humanize(r.departureType)}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td>{formatDateOnly(r.receivedAt)}</td>
                  <td>
                    {withinCaseCaptureSla(r.receivedAt, r.createdAt, calendar) ? (
                      <span className="badge badge--success">
                        Yes - {formatInstant(r.createdAt)}
                      </span>
                    ) : (
                      <span className="badge badge--danger">
                        No - logged {formatInstant(r.createdAt)}
                      </span>
                    )}
                  </td>
                  <td>
                    {r.recordedCount} / {r.totalFactTypes}
                  </td>
                  <td>
                    {r.missing.length === 0 ? (
                      <span className="badge badge--success">complete</span>
                    ) : (
                      <span className="hint">
                        {r.missing
                          .slice(0, 4)
                          .map((m) => humanize(m))
                          .join(', ')}
                        {r.missing.length > 4 ? ` and ${r.missing.length - 4} more` : ''}
                      </span>
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
