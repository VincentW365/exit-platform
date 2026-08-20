import Link from 'next/link';
import type { Metadata } from 'next';
import { can, formatInstant, formatScheduledFor } from '@exit/domain';
import {
  attentionFeed,
  attentionSummary,
  hrDashboard,
  listFlags,
  stage2Dashboard,
  stage3Dashboard,
  timed,
  upcomingAutomations,
} from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { BaselineBanner, ClassificationBadge, StatusBadge } from '@/components/ui';
import { countOf, humanize, plural } from '@/lib/text';
import {
  AlertIcon,
  BoxIcon,
  CasesIcon,
  ChartIcon,
  ClockIcon,
  DocumentIcon,
} from '@/components/icons';

// "Exit Center" (owner request 2026-08-17): the company's separate "HR
// Dashboard" app makes a generic "Dashboard" label ambiguous.
export const metadata: Metadata = { title: 'Exit Center' };
export const dynamic = 'force-dynamic';

const SEV_BADGE: Record<string, string> = {
  INFO: 'badge--neutral',
  WARNING: 'badge--warning',
  HIGH: 'badge--warning',
  CRITICAL: 'badge--danger',
};

/**
 * One process-health metric: uppercase label, tabular headline value, quiet
 * detail line, optional single-hue meter for percentages (owner aesthetic
 * pass, 2026-08-17). The meter is decorative - the value text carries it.
 */
function Metric({
  label,
  value,
  detail,
  pct,
}: {
  label: string;
  value: React.ReactNode;
  detail: string;
  pct?: number | null;
}) {
  return (
    <div className="metric">
      <span className="metric__label">{label}</span>
      <span className="metric__value">{value}</span>
      {typeof pct === 'number' ? (
        <div className="meter" aria-hidden="true">
          <div className="meter__fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </div>
      ) : null}
      <span className="metric__detail">{detail}</span>
    </div>
  );
}

/** Overdue-ageing distribution: four buckets of one hue, values in the legend. */
function AgeingCard({
  ageing,
}: {
  ageing: {
    underOneDay: number;
    oneToThreeDays: number;
    threeToSevenDays: number;
    overSevenDays: number;
  };
}) {
  const buckets = [
    ['Under 1 day', ageing.underOneDay, 'var(--seq-1)'],
    ['1-3 days', ageing.oneToThreeDays, 'var(--seq-2)'],
    ['3-7 days', ageing.threeToSevenDays, 'var(--seq-3)'],
    ['Over 7 days', ageing.overSevenDays, 'var(--seq-4)'],
  ] as const;
  const total = buckets.reduce((sum, [, n]) => sum + n, 0);
  return (
    <div className="metric">
      <span className="metric__label">Overdue ageing</span>
      <span className="metric__value">
        {total} <small>{plural(total, 'overdue task')}</small>
      </span>
      {total > 0 ? (
        <div className="ageing-bar" aria-hidden="true">
          {buckets
            .filter(([, n]) => n > 0)
            .map(([label, n, color]) => (
              <span key={label} style={{ flexGrow: n, background: color }} />
            ))}
        </div>
      ) : null}
      <span className="ageing-legend">
        {buckets.map(([label, n, color]) => (
          <span key={label}>
            <span className="swatch" style={{ background: color }} aria-hidden="true" />
            {label} <b>{n}</b>
          </span>
        ))}
      </span>
    </div>
  );
}

export default async function DashboardPage() {
  const { user, actor } = await requireAuth();

  if (!can(actor, 'baseline.viewDashboard')) {
    // Owner decision 2026-08-19: IT, Finance and the line manager all
    // participate by controlled email now, so no one outside HR has an
    // offboarding work list here.
    return (
      <>
        <h1>Welcome, {user.displayName}</h1>
        {can(actor, 'queue.view') ? (
          <section className="panel" aria-labelledby="queue-link-h">
            <h2 id="queue-link-h" style={{ marginTop: 0 }}>
              Your Department Work Queue
            </h2>
            <p>
              Offboarding tasks assigned to your department are in{' '}
              <Link href="/queue">My work</Link>. Tasks show only the minimum information needed to
              complete the work.
            </p>
          </section>
        ) : null}
        <section className="panel">
          {can(actor, 'admin.roles') ? (
            <p>
              System administration does not include HR case access (least privilege). Go to{' '}
              <Link href="/admin">Administration</Link> or the technical{' '}
              <Link href="/audit">Audit center</Link>.
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
  const [dash, s2, s3, attention, feed, automations, flags] = await Promise.all([
    timed('dashboard.hr', () => hrDashboard(actor)),
    timed('dashboard.stage2', () => stage2Dashboard(actor)),
    timed('dashboard.stage3', () => stage3Dashboard(actor)),
    timed('dashboard.attention', () => attentionSummary(actor)),
    timed('dashboard.attentionFeed', () => attentionFeed(actor)),
    timed('dashboard.automations', () => upcomingAutomations(actor)),
    timed('dashboard.flags', () => listFlags(actor)),
  ]);
  // The baseline-capture warning is only true while every automation flag is
  // off; with automation enabled it would contradict what the platform does.
  const automationOff = flags.every((f) => !f.enabled);
  const statusOrder = [
    'DRAFT',
    'PENDING_HR_REVIEW',
    'APPROVED',
    'ACTIVE',
    'CLEARANCE_REVIEW',
  ] as const;
  const q = s2.queues;
  const m = s2.metrics;
  // Empty-state display: a metric with no measurements yet shows a quiet
  // em dash, never a dangling "-%" or "- days".
  const pctText = (p: number | null | undefined) => (p == null ? '—' : `${p}%`);
  const numText = (n: number | null | undefined) => (n == null ? '—' : `${n}`);
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
      label: 'PDF Render Failed (Worker Retries)',
      caseNumber: d.case.caseNumber,
      href: `/cases/${d.case.id}/documents`,
      severity: 'danger' as const,
    })),
    ...q.invitationsDue.map((i) => ({
      label: 'Survey Invitation Due, Not yet Sent',
      caseNumber: i.case.caseNumber,
      href: `/cases/${i.case.id}/survey`,
      severity: 'warn' as const,
    })),
    ...q.remindersDue.map((i) => ({
      label: 'Survey Reminder Due',
      caseNumber: i.case.caseNumber,
      href: `/cases/${i.case.id}/survey`,
      severity: 'warn' as const,
    })),
  ];

  return (
    <>
      <h1>Exit Center</h1>
      {automationOff ? <BaselineBanner /> : null}

      {/* Directive 6.3 (Z, correction 8): exception-first - the dashboard
          leads with what needs a human decision, not with metrics. */}
      <section className="panel attention-row" aria-labelledby="attn-h">
        <h2 id="attn-h" style={{ marginTop: 0 }}>
          <span className="icon-tile section-icon icon-tile--attention">
            <AlertIcon />
          </span>
          Requires Your Attention
        </h2>
        {feed.length === 0 ? (
          <p className="hint">Nothing needs your attention right now.</p>
        ) : (
          <ul>
            {feed.map((f) => (
              <li key={f.id}>
                <span className={`badge ${SEV_BADGE[f.severity] ?? 'badge--neutral'}`}>
                  {humanize(f.severity)}
                </span>{' '}
                {f.title} - <Link href={f.href}>{f.caseNumber}</Link>
              </li>
            ))}
          </ul>
        )}
        {s3.queues.criticalAccessTasks.length > 0 ? (
          <>
            <h3>Critical Access-revocation Tasks</h3>
            <ul>
              {s3.queues.criticalAccessTasks.map((t) => (
                <li key={t.id}>
                  <span className="badge badge--danger">Critical</span>{' '}
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
            <h3>Also Needs Review</h3>
            <ul>
              {exceptions.map((e, i) => (
                <li key={i}>
                  <span
                    className={`badge ${e.severity === 'danger' ? 'badge--danger' : 'badge--warning'}`}
                  >
                    {e.severity === 'danger' ? 'Failed' : 'Needs attention'}
                  </span>{' '}
                  {e.label} - <Link href={e.href}>{e.caseNumber}</Link>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <h3>Open Work Queues</h3>
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
              [
                'Ready for clearance',
                s3.queues.casesReadyForClearance,
                '/cases?status=ACTIVE',
                'badge--info',
              ],
            ] as const
          ).map(([label, count, href, cls]) => (
            <Link key={label} href={href} className="stat stat--link">
              <span className="stat__value tabular-nums">{count}</span>
              <span className={`badge ${count > 0 ? cls : 'badge--success'}`}>{label}</span>
            </Link>
          ))}
        </div>
        <p className="hint">Select any item above to go straight to where it is handled.</p>
      </section>

      {/* Directive 6.3 (Z): what the platform will do without HR input. */}
      <section className="panel" aria-labelledby="auto-h">
        <h2 id="auto-h" style={{ marginTop: 0 }}>
          <span className="icon-tile section-icon icon-tile--progress">
            <ClockIcon />
          </span>
          In Progress Automatically
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

      <section className="panel" aria-labelledby="counts-h">
        <h2 id="counts-h" style={{ marginTop: 0 }}>
          <span className="icon-tile section-icon">
            <CasesIcon />
          </span>
          Active Cases
        </h2>
        <div className="stat-grid">
          {statusOrder.map((s) => (
            <div key={s} className="stat">
              <span className="stat__value">{dash.countsByStatus[s] ?? 0}</span>
              <StatusBadge status={s} />
            </div>
          ))}
          {dash.baselineOpenCount > 0 ? (
            <div className="stat">
              <span className="stat__value">{dash.baselineOpenCount}</span>
              <span className="badge badge--warning">Baseline open</span>
            </div>
          ) : null}
          {dash.nonOperationalCount > 0 ? (
            <div className="stat">
              <span className="stat__value">{dash.nonOperationalCount}</span>
              <span className="badge badge--neutral">Training/test records</span>
            </div>
          ) : null}
        </div>
        <p className="hint">
          Counts include only cases your access permits; restricted cases you are not assigned to
          are excluded everywhere, including totals.
        </p>
      </section>

      <section className="panel" aria-labelledby="upcoming-h">
        <h2 id="upcoming-h" style={{ marginTop: 0 }}>
          <span className="icon-tile section-icon">
            <ClockIcon />
          </span>
          Upcoming Departures (Next 30 Days)
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
                  <th scope="col">Effective Separation</th>
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
                    <td>{humanize(c.departureType)}</td>
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
          <span className="icon-tile section-icon">
            <ChartIcon />
          </span>
          Workflow Health
        </h2>
        <div className="stat-grid">
          {(
            [
              ['Tasks due this week', s3.queues.tasksDueThisWeek, 'badge--neutral'],
              ['Unassigned manager tasks', s3.queues.pendingDepartmentOwnership, 'badge--warning'],
              [
                'Notifications awaiting approval',
                s3.queues.notificationsAwaitingApproval,
                'badge--warning',
              ],
              [
                'Cases blocked from clearance',
                s3.queues.casesBlockedFromClearance,
                'badge--danger',
              ],
            ] as const
          ).map(([label, count, cls]) => (
            <div key={label} className="stat">
              <span className="stat__value">{count}</span>
              <span className={`badge ${count > 0 ? cls : 'badge--success'}`}>{label}</span>
            </div>
          ))}
        </div>
        <div className="metric-grid" style={{ marginTop: '0.9rem' }}>
          <Metric
            label="Task SLA compliance"
            value={pctText(s3.reports.taskSlaCompliance.pct)}
            detail={`${s3.reports.taskSlaCompliance.onTime} of ${s3.reports.taskSlaCompliance.measured} tasks on time`}
            pct={s3.reports.taskSlaCompliance.pct}
          />
          <Metric
            label="Access revocation on time"
            value={pctText(s3.reports.accessRevocationTimeliness.onTimePct)}
            detail={`${s3.reports.accessRevocationTimeliness.completed} completed · ${s3.reports.accessRevocationTimeliness.late} late · max delay ${s3.reports.accessRevocationTimeliness.maxDelayMinutes} min`}
            pct={s3.reports.accessRevocationTimeliness.onTimePct}
          />
          <Metric
            label="Cycle times (median)"
            value={
              <>
                {numText(s3.reports.clearanceCycleDays.median)} <small>days to clearance</small>
              </>
            }
            detail={`End to end ${s3.reports.endToEndCycleDays.median ?? '—'} days · ${countOf(s3.reports.clearanceCycleDays.count, 'case')} measured`}
          />
          <AgeingCard ageing={s3.reports.overdueAgeing} />
        </div>
        <p className="hint">
          Full analytics - timeliness, department breakdowns and corrections - live in{' '}
          <Link href="/reports">Reports</Link>.
        </p>
      </section>

      <section className="panel" aria-labelledby="assets-h">
        <h2 id="assets-h" style={{ marginTop: 0 }}>
          <span className="icon-tile section-icon">
            <BoxIcon />
          </span>
          Asset Recovery
        </h2>
        <div className="stat-grid">
          {(
            [
              ['Assets outstanding', s3.queues.assetsOutstanding, 'badge--warning'],
              ['Asset exceptions', s3.queues.assetExceptions, 'badge--warning'],
            ] as const
          ).map(([label, count, cls]) => (
            <div key={label} className="stat">
              <span className="stat__value">{count}</span>
              <span className={`badge ${count > 0 ? cls : 'badge--success'}`}>{label}</span>
            </div>
          ))}
        </div>
        <div className="metric-grid" style={{ marginTop: '0.9rem' }}>
          <Metric
            label="Asset documentation"
            value={pctText(s3.reports.assets.documentationRatePct)}
            detail={`${s3.reports.assets.documentedCount} of ${s3.reports.assets.requiredCount} required dispositions documented`}
            pct={s3.reports.assets.documentationRatePct}
          />
          <Metric
            label="Physical recovery"
            value={pctText(s3.reports.assets.physicalRecoveryRatePct)}
            detail={`${s3.reports.assets.physicallyReturned} of ${s3.reports.assets.physicalDenominator} physical items returned (not-issued excluded)`}
            pct={s3.reports.assets.physicalRecoveryRatePct}
          />
        </div>
        <p className="hint">
          Asset outcomes never calculate or recommend any payroll effect; losses become audited
          exceptions for HR review.
        </p>
      </section>

      <section className="panel" aria-labelledby="work-h">
        <h2 id="work-h" style={{ marginTop: 0 }}>
          <span className="icon-tile section-icon">
            <DocumentIcon />
          </span>
          Documents, Forms and Surveys
        </h2>
        {(() => {
          const queueRows: Array<{
            label: string;
            count: number;
            next: React.ReactNode;
          }> = [
            {
              label: 'Document Drafts Needing Attention',
              count: q.docsNeedingAttention.length,
              next: q.docsNeedingAttention[0] ? (
                <Link href={`/cases/${q.docsNeedingAttention[0].case.id}/documents`}>
                  {q.docsNeedingAttention[0].case.caseNumber}
                </Link>
              ) : null,
            },
            {
              label: 'Documents Pending HR Manager Approval',
              count: q.docsPendingApproval.length,
              next: q.docsPendingApproval[0] ? (
                <Link href={`/cases/${q.docsPendingApproval[0].case.id}/documents`}>
                  {q.docsPendingApproval[0].case.caseNumber}
                </Link>
              ) : null,
            },
            {
              label: 'PDF Render Failures',
              count: q.renderFailures.length,
              next: q.renderFailures[0] ? (
                <Link href={`/cases/${q.renderFailures[0].case.id}/documents`}>
                  {q.renderFailures[0].case.caseNumber}
                </Link>
              ) : null,
            },
            {
              label: 'Action Forms Incomplete (Draft/returned)',
              count: q.formsIncomplete,
              next: null,
            },
            {
              label: 'Action Forms Ready for Review',
              count: q.formsReadyForReview.length,
              next:
                q.formsReadyForReview.length === 0 ? null : (
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
                ),
            },
            {
              label: 'Survey Invitations Due',
              count: q.invitationsDue.length,
              next: q.invitationsDue[0] ? (
                <Link href={`/cases/${q.invitationsDue[0].case.id}/survey`}>
                  {q.invitationsDue[0].case.caseNumber}
                </Link>
              ) : null,
            },
            {
              label: 'Survey Reminders Due',
              count: q.remindersDue.length,
              next: q.remindersDue[0] ? (
                <Link href={`/cases/${q.remindersDue[0].case.id}/survey`}>
                  {q.remindersDue[0].case.caseNumber}
                </Link>
              ) : null,
            },
          ].filter((row) => row.count > 0);
          return queueRows.length === 0 ? (
            <p className="hint">No document, form or survey work is waiting.</p>
          ) : (
            <div className="table-wrap" tabIndex={0}>
              <table className="data">
                <caption className="sr-only">Open document, form and survey queues</caption>
                <thead>
                  <tr>
                    <th scope="col">Queue</th>
                    <th scope="col">Count</th>
                    <th scope="col">Next action</th>
                  </tr>
                </thead>
                <tbody>
                  {queueRows.map((row) => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td>{row.count}</td>
                      <td>{row.next ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })()}
        <div className="metric-grid" style={{ marginTop: '0.9rem' }}>
          <Metric
            label="Document turnaround"
            value={
              <>
                {numText(m.documentTurnaround.medianDays)} <small>days median</small>
              </>
            }
            detail={`${countOf(m.documentTurnaround.count, 'document')} · ${pctText(m.documentTurnaround.withinTwoBusinessDaysPct)} within 2 business days`}
            pct={m.documentTurnaround.withinTwoBusinessDaysPct}
          />
          <Metric
            label="Survey completion"
            value={pctText(m.surveyCompletion.rate.pct)}
            detail={`${m.surveyCompletion.rate.numerator} of ${m.surveyCompletion.rate.denominator} sent invitations completed · online ${m.surveyCompletion.completedOnline} · verbal ${m.surveyCompletion.completedVerbal}`}
            pct={m.surveyCompletion.rate.pct}
          />
        </div>
        <p className="hint">
          Correction and non-completion breakdowns live in <Link href="/reports">Reports</Link>.
        </p>
      </section>

      <p>
        <Link className="button" href="/cases/new">
          Create offboarding case
        </Link>
      </p>
    </>
  );
}
