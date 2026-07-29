import Link from 'next/link';
import type { Metadata } from 'next';
import { can, formatInstant } from '@exit/domain';
import { hrDashboard } from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { BaselineBanner, ClassificationBadge, StatusBadge } from '@/components/ui';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const { user, actor } = await requireAuth();

  if (!can(actor, 'baseline.viewDashboard')) {
    return (
      <>
        <h1>Welcome, {user.displayName}</h1>
        <section className="panel">
          {can(actor, 'audit.viewGlobal') ? (
            <p>
              Your oversight tools: <Link href="/cases">case register (read-only)</Link> and the{' '}
              <Link href="/audit">audit feed</Link>.
            </p>
          ) : can(actor, 'admin.roles') ? (
            <p>
              System administration does not include HR case access (least privilege). Go to{' '}
              <Link href="/admin">Administration</Link>.
            </p>
          ) : (
            <p>
              Departmental work queues arrive with the Stage 3 workflow engine. There is nothing for
              your role to action in the baseline-capture release.
            </p>
          )}
        </section>
      </>
    );
  }

  const dash = await hrDashboard(actor);
  const statusOrder = ['DRAFT', 'PENDING_HR_REVIEW', 'APPROVED'] as const;

  return (
    <>
      <h1>HR dashboard</h1>
      <BaselineBanner />

      <section className="panel" aria-labelledby="counts-h">
        <h2 id="counts-h" style={{ marginTop: 0 }}>
          Operational cases you can see
        </h2>
        <div className="actions-row">
          {statusOrder.map((s) => (
            <p key={s} style={{ margin: 0 }}>
              <StatusBadge status={s} />{' '}
              <strong style={{ fontSize: '1.3rem' }}>{dash.countsByStatus[s] ?? 0}</strong>
            </p>
          ))}
          <p style={{ margin: 0 }}>
            <span className="badge badge--warning">Baseline open</span>{' '}
            <strong style={{ fontSize: '1.3rem' }}>{dash.baselineOpenCount}</strong>
          </p>
          <p style={{ margin: 0 }}>
            <span className="badge badge--neutral">Training/test records</span>{' '}
            <strong style={{ fontSize: '1.3rem' }}>{dash.nonOperationalCount}</strong>
          </p>
        </div>
        <p className="hint">
          Counts include only cases your access permits; restricted cases you are not assigned to
          are excluded everywhere, including totals.
        </p>
      </section>

      <section className="panel" aria-labelledby="upcoming-h">
        <h2 id="upcoming-h" style={{ marginTop: 0 }}>
          Upcoming departures (next 30 days)
        </h2>
        {dash.upcomingDepartures.length === 0 ? (
          <p>No approved departures with an effective time in the next 30 days.</p>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <caption className="sr-only">Upcoming departures</caption>
              <thead>
                <tr>
                  <th scope="col">Case</th>
                  <th scope="col">Employee</th>
                  <th scope="col">Type</th>
                  <th scope="col">Status</th>
                  <th scope="col">Effective separation (America/Jamaica)</th>
                  <th scope="col">Days</th>
                </tr>
              </thead>
              <tbody>
                {dash.upcomingDepartures.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/cases/${c.id}`}>{c.caseNumber}</Link>{' '}
                      <ClassificationBadge classification={c.classification} />
                    </td>
                    <td>{c.employeeDisplayName}</td>
                    <td>{c.departureType.replaceAll('_', ' ').toLowerCase()}</td>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                    <td>
                      {c.effectiveSeparationAt ? formatInstant(c.effectiveSeparationAt) : '-'}
                    </td>
                    <td>{c.daysUntil ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p>
        <Link className="button" href="/cases/new">
          Create offboarding case
        </Link>{' '}
        <Link className="button secondary" href="/baseline">
          Baseline data completeness
        </Link>
      </p>
    </>
  );
}
