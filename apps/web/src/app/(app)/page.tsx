import Link from 'next/link';
import type { Metadata } from 'next';
import {
  TERMINAL_STATUSES,
  can,
  caseWorkStateLabel,
  formatDateOnly,
  formatInstant,
  formatScheduledFor,
  hasRole,
} from '@exit/domain';
import {
  attentionFeed,
  attentionSummary,
  hrDashboard,
  listCases,
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
  CalendarIcon,
  ChartIcon,
  CheckCircleIcon,
  ClockIcon,
  DocumentIcon,
  FlowIcon,
  QueueIcon,
} from '@/components/icons';
import { EmptyState } from '@/components/EmptyState';
import { Chip, Avatar, Kpi, Row, Rows, SectionHead, type Tone } from '@/components/patterns';

// "Exit Center" (owner request 2026-08-17): the company's separate "HR
// Dashboard" app makes a generic "Dashboard" label ambiguous.
export const metadata: Metadata = { title: 'Exit Center' };
export const dynamic = 'force-dynamic';

/**
 * Presentation pass (owner directive, 2026-09-23): the page keeps its
 * sections and their meaning; what changed is the hierarchy - identity and
 * primary action first, the summary figures, then the person's own work,
 * then everything that needs a decision - and the wording, which is now
 * business language with no raw status words, one date format, and helper
 * text only where it prevents a misreading.
 */

/** Exception severity, in words and one calm colour family each. */
const SEVERITY: Record<string, { label: string; tone: Tone }> = {
  CRITICAL: { label: 'Critical', tone: 'critical' },
  HIGH: { label: 'High', tone: 'attention' },
  WARNING: { label: 'Warning', tone: 'pending' },
  INFO: { label: 'Info', tone: 'neutral' },
};

/** The personal workload reads in the order it needs finishing. */
const CASE_ORDER: Record<string, number> = {
  APPROVED: 0,
  DRAFT: 1,
  REOPENED: 2,
  ACTIVE: 3,
  PENDING_HR_REVIEW: 4,
  CLEARANCE_REVIEW: 5,
  ON_HOLD: 6,
};

/** What a case is waiting for, as a chip tone: act, wait, or keep going. */
function workStateTone(status: string): Tone {
  switch (status) {
    case 'APPROVED':
    case 'REOPENED':
      return 'attention';
    case 'DRAFT':
      return 'pending';
    case 'ACTIVE':
      return 'progress';
    default:
      return 'neutral';
  }
}

const MY_WORK_LIMIT = 6;

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

/** A small count tile: label, figure, and colour only when the figure asks for it. */
function CountTile({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: Exclude<Tone, 'neutral'>;
}) {
  return (
    <Kpi
      compact
      label={label}
      value={count}
      tone={count > 0 ? tone : 'neutral'}
      quiet={count === 0}
    />
  );
}

export default async function DashboardPage() {
  const { user, actor } = await requireAuth();

  if (!can(actor, 'baseline.viewDashboard')) {
    // Only the HR Manager and HR Officer can sign in (DEC-063) and both hold
    // the dashboard, so a session lands here only when every stored role
    // assignment of the account is retired: there is nothing for it to do.
    return (
      <>
        <h1>Welcome, {user.displayName}</h1>
        <section className="panel">
          <p>
            This account holds no active application role. The platform has two roles - HR Manager
            and HR Officer - and only an HR Manager can grant one.
          </p>
        </section>
      </>
    );
  }

  const isManager = hasRole(actor, 'HR_MANAGER');

  // Directive 6.2 (AB): one parallel round trip instead of serial ones;
  // EXIT_TIMING=1 logs each service's duration in development. The two case
  // lists feed My Work: what this person is responsible for (DEC-065), and
  // for the HR Manager the cases waiting on their approval (DEC-066).
  const [dash, s2, s3, attention, feed, automations, flags, assigned, awaitingApproval] =
    await Promise.all([
      timed('dashboard.hr', () => hrDashboard(actor)),
      timed('dashboard.stage2', () => stage2Dashboard(actor)),
      timed('dashboard.stage3', () => stage3Dashboard(actor)),
      timed('dashboard.attention', () => attentionSummary(actor)),
      timed('dashboard.attentionFeed', () => attentionFeed(actor)),
      timed('dashboard.automations', () => upcomingAutomations(actor)),
      timed('dashboard.flags', () => listFlags(actor)),
      timed('dashboard.myCases', () => listCases(actor, { officer: actor.userId }).catch(() => [])),
      isManager
        ? timed('dashboard.approvals', () =>
            listCases(actor, { status: 'PENDING_HR_REVIEW' }).catch(() => []),
          )
        : Promise.resolve([]),
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

  // My Work: the manager's approvals first, then anyone's own open cases,
  // in the order they need finishing. Never the whole register (section 11).
  const myCases = assigned
    .filter((c) => !(TERMINAL_STATUSES as readonly string[]).includes(c.status))
    .sort(
      (a, b) =>
        (CASE_ORDER[a.status] ?? 9) - (CASE_ORDER[b.status] ?? 9) ||
        (a.effectiveSeparationAt?.getTime() ?? Infinity) -
          (b.effectiveSeparationAt?.getTime() ?? Infinity),
    );
  const approvals = awaitingApproval.filter((c) => !c.minimized);
  const approvalIds = new Set(approvals.map((c) => c.id));
  const myWork = [...approvals, ...myCases.filter((c) => !approvalIds.has(c.id))];
  const myWorkShown = myWork.slice(0, MY_WORK_LIMIT);
  const myWorkMore = myWork.length - myWorkShown.length;

  const exceptions = [
    ...q.docsNeedingAttention
      .filter((d) => d.status !== 'DRAFT')
      .map((d) => ({
        label:
          d.status === 'RETURNED' ? 'Document returned for changes' : 'Document validation failed',
        caseNumber: d.case.caseNumber,
        href: `/cases/${d.case.id}/documents`,
        severity: 'warn' as const,
      })),
    ...q.renderFailures.map((d) => ({
      label: 'PDF could not be generated (the platform is retrying)',
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
  const attentionCount = feed.length + s3.queues.criticalAccessTasks.length + exceptions.length;

  const queueKpis = [
    ['Awaiting approval', attention.pendingApproval, '/cases?status=PENDING_HR_REVIEW', 'pending'],
    ['Critical tasks', attention.criticalTasks, '/queue?view=critical', 'critical'],
    ['Overdue tasks', attention.overdueTasks, '/queue?view=overdue', 'critical'],
    ['Due today', attention.dueToday, '/queue?view=dueToday', 'pending'],
    ['Ready for clearance', s3.queues.casesReadyForClearance, '/cases?status=ACTIVE', 'info'],
  ] as const;

  const documentQueues: Array<{ label: string; count: number; next: React.ReactNode }> = [
    {
      label: 'Document drafts needing attention',
      count: q.docsNeedingAttention.length,
      next: q.docsNeedingAttention[0] ? (
        <Link href={`/cases/${q.docsNeedingAttention[0].case.id}/documents`}>
          {q.docsNeedingAttention[0].case.caseNumber}
        </Link>
      ) : null,
    },
    {
      label: 'Documents awaiting HR Manager approval',
      count: q.docsPendingApproval.length,
      next: q.docsPendingApproval[0] ? (
        <Link href={`/cases/${q.docsPendingApproval[0].case.id}/documents`}>
          {q.docsPendingApproval[0].case.caseNumber}
        </Link>
      ) : null,
    },
    {
      label: 'PDFs not yet generated',
      count: q.renderFailures.length,
      next: q.renderFailures[0] ? (
        <Link href={`/cases/${q.renderFailures[0].case.id}/documents`}>
          {q.renderFailures[0].case.caseNumber}
        </Link>
      ) : null,
    },
    { label: 'Action forms still in preparation', count: q.formsIncomplete, next: null },
    {
      label: 'Action forms ready for review',
      count: q.formsReadyForReview.length,
      next:
        q.formsReadyForReview.length === 0 ? null : (
          <>
            {q.formsReadyForReview.slice(0, 6).map((f, i) => (
              <span key={f.id}>
                {i > 0 ? ', ' : ''}
                <Link href={`/cases/${f.case.id}/action-form`}>{f.case.caseNumber}</Link>
                {f.status === 'PENDING_MANAGER' || f.status === 'PENDING_HR' ? ' (legacy)' : ''}
              </span>
            ))}
            {q.formsReadyForReview.length > 6 ? ` +${q.formsReadyForReview.length - 6} more` : ''}
          </>
        ),
    },
    {
      label: 'Survey invitations due',
      count: q.invitationsDue.length,
      next: q.invitationsDue[0] ? (
        <Link href={`/cases/${q.invitationsDue[0].case.id}/survey`}>
          {q.invitationsDue[0].case.caseNumber}
        </Link>
      ) : null,
    },
    {
      label: 'Survey reminders due',
      count: q.remindersDue.length,
      next: q.remindersDue[0] ? (
        <Link href={`/cases/${q.remindersDue[0].case.id}/survey`}>
          {q.remindersDue[0].case.caseNumber}
        </Link>
      ) : null,
    },
  ].filter((row) => row.count > 0);

  const daysTone = (d: number | null): Tone =>
    d !== null && d <= 3 ? 'critical' : d !== null && d <= 7 ? 'attention' : 'neutral';

  return (
    <div className="exit-center">
      {/* Level 1 - page identity and the one action that matters most today. */}
      <div className="page-head">
        <div className="page-head__text">
          <h1 className="page-title">Exit Center</h1>
          <p className="page-lede">
            Active offboarding cases, approvals, assigned work and upcoming actions.
          </p>
        </div>
        <div className="page-head__actions">
          {isManager && approvals.length > 0 ? (
            <Link className="button" href="/cases?status=PENDING_HR_REVIEW">
              Review pending approvals
            </Link>
          ) : null}
          <Link
            className={`button${isManager && approvals.length > 0 ? ' secondary' : ''}`}
            href="/cases/new"
          >
            Create offboarding case
          </Link>
          <Link className="button secondary" href="/cases">
            View cases
          </Link>
          <Link className="button secondary" href="/queue">
            My Work
          </Link>
        </div>
      </div>
      {automationOff ? <BaselineBanner /> : null}

      {/* The shape of the work before the detail of it: how many departures
          sit at each stage, so a glance says where the load is. */}
      <section aria-labelledby="pipeline-h" className="band">
        <SectionHead
          id="pipeline-h"
          icon={<FlowIcon />}
          title="Exit pipeline"
          description="Open cases by stage. Select a stage to work its cases."
        />
        <ol className="pipeline">
          {statusOrder.map((s) => {
            const count = dash.countsByStatus[s] ?? 0;
            return (
              <li key={s} className={`pipeline__stage${count > 0 ? ' is-live' : ''}`}>
                <Link href={`/cases?status=${s}`} className="pipeline__link">
                  <span className="pipeline__count numeric">{count}</span>
                  <span className="pipeline__name">{humanize(s)}</span>
                </Link>
              </li>
            );
          })}
        </ol>
        {dash.baselineOpenCount > 0 || dash.nonOperationalCount > 0 ? (
          <p className="meta band__note">
            {dash.baselineOpenCount > 0
              ? `${countOf(dash.baselineOpenCount, 'baseline case')} open. `
              : ''}
            {dash.nonOperationalCount > 0
              ? `${countOf(dash.nonOperationalCount, 'training or test record')} excluded from these counts.`
              : ''}
          </p>
        ) : null}
      </section>

      {/* Summary figures: the queues that decide today's work. Zero reads as
          calm, not as a green success - colour is kept for what is open. */}
      <section aria-label="Open work queues" className="kpi-grid kpi-grid--summary">
        {queueKpis.map(([label, count, href, tone]) => (
          <Link key={label} href={href} className="kpi-link" aria-label={`${label}: ${count}`}>
            <Kpi
              label={label}
              value={count}
              tone={count > 0 ? tone : 'neutral'}
              quiet={count === 0}
            />
          </Link>
        ))}
      </section>

      {/* My Work (DEC-065, DEC-066): the person's own responsibility - for
          the HR Manager the cases waiting on their approval first, then any
          case assigned to them; for the HR Officer their assigned cases. */}
      <section className="panel" aria-labelledby="mywork-h">
        <SectionHead
          id="mywork-h"
          icon={<QueueIcon />}
          tone={myWork.length > 0 ? 'progress' : 'done'}
          title="My Work"
          aside={
            <>
              {isManager && approvals.length > 0 ? (
                <Chip tone="attention">{approvals.length} awaiting approval</Chip>
              ) : null}
              {myCases.length > 0 ? <Chip tone="progress">{myCases.length} assigned</Chip> : null}
            </>
          }
        />
        {myWork.length === 0 ? (
          <EmptyState
            icon={<CheckCircleIcon />}
            tone="done"
            title="You're all caught up"
            body={
              isManager
                ? 'No cases are waiting for your approval and none are assigned to you.'
                : 'No assigned cases currently require your attention.'
            }
          />
        ) : (
          <>
            <Rows label="My work">
              {myWorkShown.map((c) => {
                const needsApproval = c.status === 'PENDING_HR_REVIEW' && isManager;
                return (
                  <Row
                    key={c.id}
                    tone={
                      c.tasksOverdue > 0 || c.openExceptions > 0
                        ? 'attention'
                        : needsApproval
                          ? 'pending'
                          : workStateTone(c.status)
                    }
                    mark={
                      c.tasksOverdue > 0 ? <AlertIcon /> : <Avatar name={c.employeeDisplayName} />
                    }
                    title={<Link href={`/cases/${c.id}`}>{c.employeeDisplayName}</Link>}
                    sub={
                      <>
                        {c.caseNumber}
                        {c.department ? ` · ${c.department}` : ''}
                        {' · '}
                        {humanize(c.departureType)}
                      </>
                    }
                    facts={
                      <>
                        <StatusBadge status={c.status} />
                        <span>
                          <span className="label">Next action</span>
                          <span className="value">
                            {needsApproval ? 'Your approval' : caseWorkStateLabel(c.status)}
                          </span>
                        </span>
                        <span>
                          <span className="label">Employment ends</span>
                          <span className="value numeric">
                            {c.effectiveSeparationAt
                              ? formatDateOnly(c.effectiveSeparationAt)
                              : 'Not set'}
                          </span>
                        </span>
                        {isManager && c.officerName ? (
                          <span>
                            <span className="label">HR Officer</span>
                            <span className="value">{c.officerName}</span>
                          </span>
                        ) : null}
                        {c.tasksOverdue > 0 ? (
                          <Chip tone="critical">{countOf(c.tasksOverdue, 'overdue task')}</Chip>
                        ) : null}
                        {c.openExceptions > 0 ? (
                          <Chip tone="attention">{countOf(c.openExceptions, 'exception')}</Chip>
                        ) : null}
                      </>
                    }
                    action={
                      <Link
                        href={needsApproval ? `/cases/${c.id}/approve` : `/cases/${c.id}`}
                        className="button secondary compact"
                      >
                        {needsApproval
                          ? 'Review and approve'
                          : c.status === 'DRAFT'
                            ? 'Continue draft'
                            : 'Open case'}
                      </Link>
                    }
                  />
                );
              })}
            </Rows>
            <p className="section-foot">
              {myWorkMore > 0
                ? `${countOf(myWorkMore, 'more case')} in `
                : 'Tasks and the full list in '}
              <Link href="/queue">My Work</Link>.
            </p>
          </>
        )}
      </section>

      {/* Directive 6.3 (Z, correction 8): exception-first - the dashboard
          leads with what needs a human decision, not with metrics. */}
      <section className="panel attention-row" aria-labelledby="attn-h">
        <SectionHead
          id="attn-h"
          icon={<AlertIcon />}
          tone={attentionCount > 0 ? 'attention' : 'done'}
          title="Requires your attention"
          aside={attentionCount > 0 ? <Chip tone="attention">{attentionCount} open</Chip> : null}
        />
        {attentionCount === 0 ? (
          <EmptyState
            icon={<CheckCircleIcon />}
            tone="done"
            title="Nothing needs your attention right now"
            body="Everything else is running without you."
          />
        ) : null}
        {feed.length > 0 ? (
          <ul className="attention-list">
            {feed.map((f) => {
              const sev = SEVERITY[f.severity] ?? { label: humanize(f.severity), tone: 'neutral' };
              return (
                <li key={f.id}>
                  <Chip tone={sev.tone}>{sev.label}</Chip>
                  <span className="attention-list__title">{f.title}</span>
                  <Link className="attention-list__case" href={f.href}>
                    {f.caseNumber}
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}
        {s3.queues.criticalAccessTasks.length > 0 ? (
          <>
            <h3>Critical access-revocation tasks</h3>
            <ul className="attention-list">
              {s3.queues.criticalAccessTasks.map((t) => (
                <li key={t.id}>
                  <Chip tone="critical">Critical</Chip>
                  <span className="attention-list__title">
                    <Link href={`/tasks/${t.id}`}>{t.title}</Link>
                    <span className="attention-list__meta">
                      {' '}
                      · due {t.dueAt ? formatInstant(t.dueAt) : 'not set'} · {humanize(t.status)}
                      {t.escalationLevel > 0 ? ` · escalation level ${t.escalationLevel}` : ''}
                    </span>
                  </span>
                  <Link className="attention-list__case" href={`/cases/${t.case.id}/workflow`}>
                    {t.case.caseNumber}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        {exceptions.length > 0 ? (
          <>
            <h3>Also needs review</h3>
            <ul className="attention-list">
              {exceptions.map((e, i) => (
                <li key={i}>
                  <Chip tone={e.severity === 'danger' ? 'critical' : 'attention'}>
                    {e.severity === 'danger' ? 'Failed' : 'Needs attention'}
                  </Chip>
                  <span className="attention-list__title">{e.label}</span>
                  <Link className="attention-list__case" href={e.href}>
                    {e.caseNumber}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      {/* Directive 6.3 (Z): what the platform will do without HR input. */}
      <section className="panel" aria-labelledby="auto-h">
        <SectionHead
          id="auto-h"
          icon={<ClockIcon />}
          tone={'progress'}
          title="In progress automatically"
          description="Scheduled work the platform carries out on its own over the next 7 days."
        />
        {automations.length === 0 ? (
          <p className="hint">Nothing is scheduled for the next 7 days.</p>
        ) : (
          <ul className="attention-list">
            {automations.map((a) => (
              <li key={a.key}>
                <Chip tone={a.state === 'Awaiting review' ? 'attention' : 'progress'}>
                  {a.state === 'Awaiting review' ? 'Awaiting review' : 'Scheduled'}
                </Chip>
                <span className="attention-list__title">
                  {a.label}
                  {a.state !== 'Awaiting review' && a.scheduledAt ? (
                    <span className="attention-list__meta">
                      {' '}
                      · {formatScheduledFor(a.scheduledAt)}
                    </span>
                  ) : null}
                </span>
                <Link className="attention-list__case" href={a.href}>
                  {a.caseNumber}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel" aria-labelledby="upcoming-h">
        <SectionHead
          id="upcoming-h"
          icon={<CalendarIcon />}
          tone="pending"
          title="Leaving in the next 30 days"
          description="Nearest departure first."
          aside={
            dash.upcomingDepartures.length > 0 ? (
              <Chip tone="pending">{dash.upcomingDepartures.length} upcoming</Chip>
            ) : null
          }
        />
        {dash.upcomingDepartures.length === 0 ? (
          <EmptyState
            icon={<CalendarIcon />}
            title="Nobody is leaving in the next 30 days"
            body="Approved departures appear here as their last working day approaches."
          />
        ) : (
          <Rows label="Upcoming departures">
            {dash.upcomingDepartures.map((c) => (
              <Row
                key={c.id}
                tone={
                  c.daysUntil !== null && c.daysUntil <= 3
                    ? 'critical'
                    : c.daysUntil !== null && c.daysUntil <= 7
                      ? 'attention'
                      : 'progress'
                }
                mark={<Avatar name={c.employeeDisplayName} />}
                title={<Link href={`/cases/${c.id}`}>{c.employeeDisplayName}</Link>}
                sub={
                  <>
                    {c.caseNumber} · {humanize(c.departureType)}
                  </>
                }
                facts={
                  <>
                    <StatusBadge status={c.status} />
                    <span>
                      <span className="label">Employment ends</span>
                      <span className="value numeric">
                        {c.effectiveSeparationAt ? formatDateOnly(c.effectiveSeparationAt) : '-'}
                      </span>
                    </span>
                    {c.assignedOfficerName ? (
                      <span>
                        <span className="label">HR Officer</span>
                        <span className="value">{c.assignedOfficerName}</span>
                      </span>
                    ) : null}
                    {c.classification === 'RESTRICTED' ? (
                      <ClassificationBadge classification={c.classification} />
                    ) : null}
                  </>
                }
                action={
                  <Chip tone={daysTone(c.daysUntil)}>
                    {c.daysUntil === null
                      ? 'No date'
                      : c.daysUntil <= 0
                        ? 'Today'
                        : `${c.daysUntil} day${c.daysUntil === 1 ? '' : 's'} left`}
                  </Chip>
                }
              />
            ))}
          </Rows>
        )}
      </section>

      <section className="panel" aria-labelledby="wf-h">
        <SectionHead
          id="wf-h"
          icon={<ChartIcon />}
          tone={'info'}
          title="Workflow health"
          description="Timeliness, blockages and cycle times."
        />
        <div className="kpi-grid kpi-grid--tiles">
          <CountTile label="Tasks due this week" count={s3.queues.tasksDueThisWeek} tone="info" />
          <CountTile
            label="Unassigned manager tasks"
            count={s3.queues.pendingDepartmentOwnership}
            tone="pending"
          />
          <CountTile
            label="Notifications awaiting approval"
            count={s3.queues.notificationsAwaitingApproval}
            tone="pending"
          />
          <CountTile
            label="Cases blocked from clearance"
            count={s3.queues.casesBlockedFromClearance}
            tone="critical"
          />
        </div>
        <div className="metric-grid">
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
        <p className="section-foot">
          Full analytics in <Link href="/reports">Reports</Link>.
        </p>
      </section>

      <section className="panel" aria-labelledby="assets-h">
        <SectionHead
          id="assets-h"
          icon={<BoxIcon />}
          tone={'info'}
          title="Asset recovery"
          description="Company property still to come back, and anything needing HR review."
        />
        <div className="kpi-grid kpi-grid--tiles">
          <CountTile
            label="Assets outstanding"
            count={s3.queues.assetsOutstanding}
            tone="pending"
          />
          <CountTile label="Asset exceptions" count={s3.queues.assetExceptions} tone="attention" />
        </div>
        <div className="metric-grid">
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
      </section>

      <section className="panel" aria-labelledby="work-h">
        <SectionHead
          id="work-h"
          icon={<DocumentIcon />}
          tone="info"
          title="Documents, forms and surveys"
          description="Paperwork waiting on someone, and how quickly it turns around."
        />
        {documentQueues.length === 0 ? (
          <p className="hint">No document, form or survey work is waiting.</p>
        ) : (
          <div className="table-wrap" tabIndex={0}>
            <table className="data">
              <caption className="sr-only">Open document, form and survey queues</caption>
              <thead>
                <tr>
                  <th scope="col">Queue</th>
                  <th scope="col" className="numeric">
                    Open
                  </th>
                  <th scope="col">Case</th>
                </tr>
              </thead>
              <tbody>
                {documentQueues.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td className="numeric">{row.count}</td>
                    <td>{row.next ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="metric-grid">
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
        <p className="section-foot">
          Correction and non-completion breakdowns in <Link href="/reports">Reports</Link>.
        </p>
      </section>
    </div>
  );
}
