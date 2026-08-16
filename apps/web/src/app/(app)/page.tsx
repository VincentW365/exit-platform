import Link from 'next/link';
import type { Metadata } from 'next';
import { can, formatInstant, formatScheduledFor, hasRole } from '@exit/domain';
import {
  assignedFormQueue,
  attentionFeed,
  attentionSummary,
  hrDashboard,
  stage2Dashboard,
  stage3Dashboard,
  timed,
  upcomingAutomations,
} from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { BaselineBanner, ClassificationBadge, StatusBadge } from '@/components/ui';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

const SEV_BADGE: Record<string, string> = {
  INFO: 'badge--neutral',
  WARNING: 'badge--warning',
  HIGH: 'badge--warning',
  CRITICAL: 'badge--danger',
};

export default async function DashboardPage() {
  const { user, actor } = await requireAuth();

  if (!can(actor, 'baseline.viewDashboard')) {
    // Directive 6.3 (Z): Finance form logins are retired - Finance is reached
    // by controlled email actions, so only assigned managers keep a work list
    // (handover pointers only; the action-form approval link is gone).
    const assigned = hasRole(actor, 'LINE_MANAGER') ? await assignedFormQueue(actor) : [];
    return (
      <>
        <h1>Welcome, {user.displayName}</h1>
        {can(actor, 'queue.view') ? (
          <section className="panel" aria-labelledby="queue-link-h">
            <h2 id="queue-link-h" style={{ marginTop: 0 }}>
              Your department work queue
            </h2>
            <p>
              Offboarding tasks assigned to your department are in{' '}
              <Link href="/queue">My queue</Link>. Tasks show only the minimum information needed to
              complete the work.
            </p>
          </section>
        ) : null}
        {assigned.length > 0 ? (
          <section className="panel" aria-labelledby="assigned-h">
            <h2 id="assigned-h" style={{ marginTop: 0 }}>
              Your assigned offboarding work
            </h2>
            <div className="table-wrap" tabIndex={0}>
              <table className="data">
                <caption>Cases where you are the assigned manager</caption>
                <thead>
                  <tr>
                    <th scope="col">Case</th>
                    <th scope="col">Handover</th>
                  </tr>
                </thead>
                <tbody>
                  {assigned.map((a) => (
                    <tr key={a.caseId}>
                      <td>{a.caseNumber}</td>
                      <td>
                        <Link href={`/cases/${a.caseId}/handover`}>Open handover</Link> (
                        {a.handoverStatus.replaceAll('_', ' ')})
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
        <section className="panel">
          {can(actor, 'admin.roles') ? (
            <p>
              System administration does not include HR case access (least privilege). Go to{' '}
              <Link href="/admin">Administration</Link> or the technical{' '}
              <Link href="/audit">Audit centre</Link>.
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

  // Directive 6.2 (AB): one parallel round trip instead of serial ones;
  // EXIT_TIMING=1 logs each service's duration in development.
  const [dash, s2, s3, attention, feed, automations] = await Promise.all([
    timed('dashboard.hr', () => hrDashboard(actor)),
    timed('dashboard.stage2', () => stage2Dashboard(actor)),
    timed('dashboard.stage3', () => stage3Dashboard(actor)),
    timed('dashboard.attention', () => attentionSummary(actor)),
    timed('dashboard.attentionFeed', () => attentionFeed(actor)),
    timed('dashboard.automations', () => upcomingAutomations(actor)),
  ]);
  const statusOrder = [
    'DRAFT',
    'PENDING_HR_REVIEW',
    'APPROVED',
    'ACTIVE',
    'CLEARANCE_REVIEW',
  ] as const;
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

      {/* Directive 6.3 (Z, correction 8): exception-first - the dashboard
          leads with what needs a human decision, not with metrics. */}
      <section className="panel attention-row" aria-labelledby="attn-h">
        <h2 id="attn-h" style={{ marginTop: 0 }}>
          Requires your attention
        </h2>
        {feed.length === 0 ? (
          <p className="hint">Nothing needs your attention right now.</p>
        ) : (
          <ul>
            {feed.map((f) => (
              <li key={f.id}>
                <span className={`badge ${SEV_BADGE[f.severity] ?? 'badge--neutral'}`}>
                  {f.severity}
                </span>{' '}
                {f.title} - <Link href={f.href}>{f.caseNumber}</Link>
              </li>
            ))}
          </ul>
        )}
        {s3.queues.criticalAccessTasks.length > 0 ? (
          <>
            <h3>Critical access-revocation tasks</h3>
            <ul>
              {s3.queues.criticalAccessTasks.map((t) => (
                <li key={t.id}>
                  <span className="badge badge--danger">CRITICAL</span>{' '}
                  <Link href={`/tasks/${t.id}`}>{t.title}</Link> -{' '}
                  <Link href={`/cases/${t.case.id}/workflow`}>{t.case.caseNumber}</Link> - due{' '}
                  {t.dueAt ? formatInstant(t.dueAt) : '-'} ({t.status}, escalation level{' '}
                  {t.escalationLevel})
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {exceptions.length > 0 ? (
          <>
            <h3>Also needs review</h3>
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
          </>
        ) : null}
        <h3>Open work queues</h3>
        <div className="stat-grid">
          {(
            [
              [
                'Critical / escalated',
                attention.criticalTasks,
                '/queue?view=critical',
                'badge--danger',
              ],
              ['Overdue tasks', attention.overdueTasks, '/queue?view=overdue', 'badge--danger'],
              [
                'Pending approval',
                attention.pendingApproval,
                '/cases?status=PENDING_HR_REVIEW',
                'badge--warning',
              ],
              ['Due today', attention.dueToday, '/queue?view=dueToday', 'badge--warning'],
              ['Missing manager', attention.missingManager, '/admin/organization', 'badge--danger'],
              [
                'Hierarchy changes',
                attention.hierarchyFlags,
                '/admin/organization',
                'badge--warning',
              ],
            ] as const
          ).map(([label, count, href, cls]) => (
            <Link key={label} href={href} className="stat stat--link">
              <span className="stat__value tabular-nums">{count}</span>
              <span className={`badge ${count > 0 ? cls : 'badge--success'}`}>{label}</span>
            </Link>
          ))}
        </div>
        <p className="hint">Operational records only; each item opens the surface that fixes it.</p>
      </section>

      {/* Directive 6.3 (Z): what the platform will do without HR input. */}
      <section className="panel" aria-labelledby="auto-h">
        <h2 id="auto-h" style={{ marginTop: 0 }}>
          In progress automatically
        </h2>
        {automations.length === 0 ? (
          <p className="hint">
            No email actions or survey invitations are scheduled for the next 7 days.
          </p>
        ) : (
          <ul>
            {automations.map((a) => (
              <li key={a.key}>
                {a.label} -{' '}
                {a.state === 'Awaiting review'
                  ? 'awaiting your review'
                  : a.scheduledAt
                    ? `scheduled for ${formatScheduledFor(a.scheduledAt)}`
                    : 'scheduled'}{' '}
                - <Link href={a.href}>{a.caseNumber}</Link>
              </li>
            ))}
          </ul>
        )}
        <p className="hint">
          The platform progresses these without HR input; anything needing a decision moves to
          Requires your attention above.
        </p>
      </section>

      <section className="panel" aria-labelledby="today-h">
        <h2 id="today-h" style={{ marginTop: 0 }}>
          Today
        </h2>
        <div className="stat-grid">
          {(
            [
              ['Tasks due today', s3.queues.tasksDueToday, '/queue?view=dueToday'],
              ['Email delivery status', s3.queues.notificationsReadyForManualSend, '/admin/outbox'],
              [
                'Cases ready for clearance',
                s3.queues.casesReadyForClearance,
                '/cases?status=ACTIVE',
              ],
            ] as const
          ).map(([label, count, href]) => (
            <Link key={label} href={href} className="stat stat--link">
              <span className="stat__value tabular-nums">{count}</span>
              <span className={`badge ${count > 0 ? 'badge--info' : 'badge--success'}`}>
                {label}
              </span>
            </Link>
          ))}
        </div>
      </section>

      <section className="panel" aria-labelledby="counts-h">
        <h2 id="counts-h" style={{ marginTop: 0 }}>
          Active cases
        </h2>
        <div className="stat-grid">
          {statusOrder.map((s) => (
            <div key={s} className="stat">
              <span className="stat__value">{dash.countsByStatus[s] ?? 0}</span>
              <StatusBadge status={s} />
            </div>
          ))}
          <div className="stat">
            <span className="stat__value">{dash.baselineOpenCount}</span>
            <span className="badge badge--warning">Baseline open</span>
          </div>
          <div className="stat">
            <span className="stat__value">{dash.nonOperationalCount}</span>
            <span className="badge badge--neutral">Training/test records</span>
          </div>
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
          <div className="table-wrap" tabIndex={0}>
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

      <section className="panel" aria-labelledby="wf-h">
        <h2 id="wf-h" style={{ marginTop: 0 }}>
          Process health - workflow operations
        </h2>
        <div className="stat-grid">
          {(
            [
              ['Active workflows', s3.queues.activeWorkflows, 'badge--info'],
              ['Tasks due this week', s3.queues.tasksDueThisWeek, 'badge--neutral'],
              ['Unassigned manager tasks', s3.queues.pendingDepartmentOwnership, 'badge--warning'],
              [
                'Notifications awaiting approval',
                s3.queues.notificationsAwaitingApproval,
                'badge--warning',
              ],
              ['Assets outstanding', s3.queues.assetsOutstanding, 'badge--warning'],
              ['Asset exceptions', s3.queues.assetExceptions, 'badge--warning'],
              ['Handovers outstanding', s3.queues.handoversOutstanding, 'badge--warning'],
              [
                'Cases blocked from clearance',
                s3.queues.casesBlockedFromClearance,
                'badge--danger',
              ],
              ['Completed cases', s3.queues.completedCases, 'badge--success'],
            ] as const
          ).map(([label, count, cls]) => (
            <div key={label} className="stat">
              <span className="stat__value">{count}</span>
              <span className={`badge ${cls}`}>{label}</span>
            </div>
          ))}
        </div>
        <dl className="kv" style={{ marginTop: '0.75rem' }}>
          <dt>Task SLA compliance</dt>
          <dd>
            {s3.reports.taskSlaCompliance.onTime}/{s3.reports.taskSlaCompliance.measured} on time (
            {s3.reports.taskSlaCompliance.pct ?? '-'}%)
          </dd>
          <dt>Median completion hours by department</dt>
          <dd>
            {Object.entries(s3.reports.medianCompletionHoursByDepartment)
              .map(([d, h]) => `${d}: ${h ?? '-'}h`)
              .join('; ') || '-'}
          </dd>
          <dt>Access-revocation timeliness</dt>
          <dd>
            {s3.reports.accessRevocationTimeliness.completed} completed;{' '}
            {s3.reports.accessRevocationTimeliness.late} late (on time{' '}
            {s3.reports.accessRevocationTimeliness.onTimePct ?? '-'}%); max delay{' '}
            {s3.reports.accessRevocationTimeliness.maxDelayMinutes} min
          </dd>
          <dt>Notification timeliness</dt>
          <dd>
            median prep-to-approval{' '}
            {s3.reports.notificationTimeliness.medianPrepToApprovalHours ?? '-'}h; median
            ready-to-manual-send{' '}
            {s3.reports.notificationTimeliness.medianReadyToManualSendHours ?? '-'}h (manual-send
            recording only - no provider delivery exists or is claimed); corrections: superseded{' '}
            {s3.reports.notificationCorrections.superseded}, approvals invalidated{' '}
            {s3.reports.notificationCorrections.approvalsInvalidated}
          </dd>
          <dt>Assets</dt>
          <dd>
            documentation rate {s3.reports.assets.documentationRatePct ?? '-'}% (
            {s3.reports.assets.documentedCount}/{s3.reports.assets.requiredCount}); physical
            recovery rate {s3.reports.assets.physicalRecoveryRatePct ?? '-'}% (
            {s3.reports.assets.physicallyReturned}/{s3.reports.assets.physicalDenominator},
            NOT_ISSUED excluded) - never a payroll effect
          </dd>
          <dt>Handover completion</dt>
          <dd>
            {s3.reports.handoverCompletion.satisfied}/{s3.reports.handoverCompletion.required} (
            {s3.reports.handoverCompletion.pct ?? '-'}%)
          </dd>
          <dt>Cycle times</dt>
          <dd>
            clearance median {s3.reports.clearanceCycleDays.median ?? '-'} day(s) (
            {s3.reports.clearanceCycleDays.count} case(s)); end-to-end median{' '}
            {s3.reports.endToEndCycleDays.median ?? '-'} day(s)
          </dd>
          <dt>Overdue ageing</dt>
          <dd>
            &lt;1d: {s3.reports.overdueAgeing.underOneDay}; 1-3d:{' '}
            {s3.reports.overdueAgeing.oneToThreeDays}; 3-7d:{' '}
            {s3.reports.overdueAgeing.threeToSevenDays}; &gt;7d:{' '}
            {s3.reports.overdueAgeing.overSevenDays}
          </dd>
          <dt>Waivers and overrides</dt>
          <dd>
            task waivers {s3.reports.waiversAndOverrides.taskWaivers}; task corrections{' '}
            {s3.reports.waiversAndOverrides.taskCorrections}
          </dd>
        </dl>
        <p className="hint">
          Workflow reporting covers OPERATIONAL records only; TRAINING/TEST records are excluded.
          Restricted-case data is filtered by your access. See <Link href="/queue">My queue</Link>{' '}
          and the <Link href="/exceptions">exception feed</Link>.
        </p>
      </section>

      <section className="panel" aria-labelledby="work-h">
        <h2 id="work-h" style={{ marginTop: 0 }}>
          Process health - documents, forms and surveys
        </h2>
        <div className="table-wrap" tabIndex={0}>
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
                <td>Action forms ready for review</td>
                <td>{q.formsReadyForReview.length}</td>
                <td>
                  {q.formsReadyForReview.length === 0 ? (
                    '-'
                  ) : (
                    <>
                      {q.formsReadyForReview.slice(0, 6).map((f, i) => (
                        <span key={f.id}>
                          {i > 0 ? ', ' : ''}
                          <Link href={`/cases/${f.case.id}/action-form`}>{f.case.caseNumber}</Link>
                          {f.status === 'PENDING_MANAGER' || f.status === 'PENDING_HR'
                            ? ' (legacy)'
                            : ''}
                        </span>
                      ))}
                      {q.formsReadyForReview.length > 6
                        ? ` +${q.formsReadyForReview.length - 6} more`
                        : ''}
                    </>
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
