import Link from 'next/link';
import type { Metadata } from 'next';
import { can, formatInstant, hasRole } from '@exit/domain';
import { assignedFormQueue, hrDashboard, stage2Dashboard } from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { BaselineBanner, ClassificationBadge, StatusBadge } from '@/components/ui';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const { user, actor } = await requireAuth();

  if (!can(actor, 'baseline.viewDashboard')) {
    const assigned = hasRole(actor, 'FINANCE_RESPONDER', 'LINE_MANAGER')
      ? await assignedFormQueue(actor)
      : [];
    return (
      <>
        <h1>Welcome, {user.displayName}</h1>
        {assigned.length > 0 ? (
          <section className="panel" aria-labelledby="assigned-h">
            <h2 id="assigned-h" style={{ marginTop: 0 }}>
              Your assigned action forms
            </h2>
            <div className="table-wrap">
              <table className="data">
                <caption>Cases where you are the assigned Finance or Manager participant</caption>
                <thead>
                  <tr>
                    <th scope="col">Case</th>
                    <th scope="col">Form status</th>
                    <th scope="col">Your role</th>
                    <th scope="col">Next action</th>
                  </tr>
                </thead>
                <tbody>
                  {assigned.map((a) => (
                    <tr key={a.caseId}>
                      <td>{a.caseNumber}</td>
                      <td>{a.formStatus.replaceAll('_', ' ')}</td>
                      <td>{a.yourRole === 'FINANCE' ? 'Finance' : 'Manager'}</td>
                      <td>
                        <Link href={`/cases/${a.caseId}/action-form`}>
                          {a.yourRole === 'FINANCE'
                            ? 'Update Finance checklist'
                            : 'Review and approve'}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
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
  const s2 = await stage2Dashboard(actor);
  const statusOrder = ['DRAFT', 'PENDING_HR_REVIEW', 'APPROVED'] as const;
  const q = s2.queues;
  const m = s2.metrics;
  const exceptions = [
    ...q.docsNeedingAttention
      .filter((d) => d.status !== 'DRAFT')
      .map((d) => ({
        label: `Document ${d.status === 'RETURNED' ? 'returned' : 'validation failed'}`,
        caseNumber: d.case.caseNumber,
        href: `/cases/${d.case.id}/documents`,
        severity: 'warn' as const,
      })),
    ...q.renderFailures.map((d) => ({
      label: 'PDF render failed (worker retries)',
      caseNumber: d.case.caseNumber,
      href: `/cases/${d.case.id}/documents`,
      severity: 'danger' as const,
    })),
    ...q.invitationsDue.map((i) => ({
      label: 'Survey invitation due, not yet sent',
      caseNumber: i.case.caseNumber,
      href: `/cases/${i.case.id}/survey`,
      severity: 'warn' as const,
    })),
    ...q.remindersDue.map((i) => ({
      label: 'Survey reminder due',
      caseNumber: i.case.caseNumber,
      href: `/cases/${i.case.id}/survey`,
      severity: 'warn' as const,
    })),
  ];

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

      <section className="panel" aria-labelledby="work-h">
        <h2 id="work-h" style={{ marginTop: 0 }}>
          Documents, forms and surveys
        </h2>
        <div className="table-wrap">
          <table className="data">
            <caption>Focused work queues (next action, owner, status)</caption>
            <thead>
              <tr>
                <th scope="col">Queue</th>
                <th scope="col">Count</th>
                <th scope="col">Next action</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Document drafts needing attention</td>
                <td>{q.docsNeedingAttention.length}</td>
                <td>
                  {q.docsNeedingAttention[0] ? (
                    <Link href={`/cases/${q.docsNeedingAttention[0].case.id}/documents`}>
                      {q.docsNeedingAttention[0].case.caseNumber}
                    </Link>
                  ) : (
                    '-'
                  )}
                </td>
              </tr>
              <tr>
                <td>Documents pending HR Manager approval</td>
                <td>{q.docsPendingApproval.length}</td>
                <td>
                  {q.docsPendingApproval[0] ? (
                    <Link href={`/cases/${q.docsPendingApproval[0].case.id}/documents`}>
                      {q.docsPendingApproval[0].case.caseNumber}
                    </Link>
                  ) : (
                    '-'
                  )}
                </td>
              </tr>
              <tr>
                <td>Render failures</td>
                <td>{q.renderFailures.length}</td>
                <td>
                  {q.renderFailures[0] ? (
                    <Link href={`/cases/${q.renderFailures[0].case.id}/documents`}>
                      {q.renderFailures[0].case.caseNumber}
                    </Link>
                  ) : (
                    '-'
                  )}
                </td>
              </tr>
              <tr>
                <td>Action forms incomplete (draft/returned)</td>
                <td>{q.formsIncomplete}</td>
                <td>-</td>
              </tr>
              <tr>
                <td>Action forms awaiting manager approval</td>
                <td>{q.formsManagerPending.length}</td>
                <td>
                  {q.formsManagerPending[0] ? (
                    <Link href={`/cases/${q.formsManagerPending[0].case.id}/action-form`}>
                      {q.formsManagerPending[0].case.caseNumber}
                    </Link>
                  ) : (
                    '-'
                  )}
                </td>
              </tr>
              <tr>
                <td>Action forms awaiting HR final approval</td>
                <td>{q.formsHrPending.length}</td>
                <td>
                  {q.formsHrPending[0] ? (
                    <Link href={`/cases/${q.formsHrPending[0].case.id}/action-form`}>
                      {q.formsHrPending[0].case.caseNumber}
                    </Link>
                  ) : (
                    '-'
                  )}
                </td>
              </tr>
              <tr>
                <td>Survey invitations due</td>
                <td>{q.invitationsDue.length}</td>
                <td>
                  {q.invitationsDue[0] ? (
                    <Link href={`/cases/${q.invitationsDue[0].case.id}/survey`}>
                      {q.invitationsDue[0].case.caseNumber}
                    </Link>
                  ) : (
                    '-'
                  )}
                </td>
              </tr>
              <tr>
                <td>Survey reminders due</td>
                <td>{q.remindersDue.length}</td>
                <td>
                  {q.remindersDue[0] ? (
                    <Link href={`/cases/${q.remindersDue[0].case.id}/survey`}>
                      {q.remindersDue[0].case.caseNumber}
                    </Link>
                  ) : (
                    '-'
                  )}
                </td>
              </tr>
              <tr>
                <td>Completed surveys (operational)</td>
                <td>{q.completedSurveys}</td>
                <td>-</td>
              </tr>
            </tbody>
          </table>
        </div>
        <dl className="kv" style={{ marginTop: '0.75rem' }}>
          <dt>Document turnaround</dt>
          <dd>
            {m.documentTurnaround.count} document(s); median{' '}
            {m.documentTurnaround.medianDays ?? '-'} days;{' '}
            {m.documentTurnaround.withinTwoBusinessDaysPct ?? '-'}% within 2 business days
          </dd>
          <dt>Document corrections</dt>
          <dd>
            returned {m.documentCorrections.returned}; outdated by case change{' '}
            {m.documentCorrections.outdatedByCaseChange}; approvals invalidated{' '}
            {m.documentCorrections.approvalsInvalidated}
          </dd>
          <dt>Survey completion</dt>
          <dd>
            {m.surveyCompletion.rate.numerator}/{m.surveyCompletion.rate.denominator} sent
            invitations completed ({m.surveyCompletion.rate.pct ?? '-'}%): online{' '}
            {m.surveyCompletion.completedOnline}, verbal {m.surveyCompletion.completedVerbal};
            declined {m.surveyCompletion.declined}, expired {m.surveyCompletion.expired}, invalid
            contact {m.surveyCompletion.invalidContact}, not eligible{' '}
            {m.surveyCompletion.notEligible}, not sent {m.surveyCompletion.notSent}
          </dd>
        </dl>
        <p className="hint">
          Metrics cover OPERATIONAL records only; TRAINING and TEST records are excluded. PDF
          rendering success does not by itself prove field accuracy - HR review does.
        </p>
      </section>

      {exceptions.length > 0 ? (
        <section className="panel" aria-labelledby="exc-h">
          <h2 id="exc-h" style={{ marginTop: 0 }}>
            Exceptions
          </h2>
          <ul>
            {exceptions.map((e, i) => (
              <li key={i}>
                <span
                  className={`badge ${e.severity === 'danger' ? 'badge--danger' : 'badge--warning'}`}
                >
                  {e.severity === 'danger' ? 'FAILED' : 'ATTENTION'}
                </span>{' '}
                {e.label} - <Link href={e.href}>{e.caseNumber}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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
