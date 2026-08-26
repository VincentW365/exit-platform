import type { Metadata } from 'next';
import Link from 'next/link';
import { ServiceError, listMyQueue } from '@exit/db';
import { formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import { claimTaskAction, returnTaskAction } from './actions';
import { humanize } from '@/lib/text';
import { EmptyState } from '@/components/EmptyState';
import { Chip, Row, Rows } from '@/components/patterns';
import { AlertIcon, CheckCircleIcon, QueueIcon } from '@/components/icons';

export const metadata: Metadata = { title: 'My Work' };
export const dynamic = 'force-dynamic';

// Directive 6.2 (V/W): ONE consolidated filter row. Additional service views
// (ready, inProgress, dueThisWeek, assignedToMe, reassigned, waived) remain
// reachable by URL for saved links; the service view keys are unchanged.
const VIEWS = [
  ['myTasks', 'My tasks'],
  ['unassigned', 'Unassigned'],
  ['dueToday', 'Due today'],
  ['overdue', 'Overdue'],
  ['blocked', 'Blocked'],
  ['critical', 'Critical'],
  ['completed', 'Completed'],
  ['all', 'All authorized'],
] as const;

const TASK_BADGE: Record<string, string> = {
  READY: 'badge--info',
  IN_PROGRESS: 'badge--info',
  BLOCKED: 'badge--danger',
  COMPLETED: 'badge--success',
  WAIVED: 'badge--warning',
  CANCELLED: 'badge--neutral',
};

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const sp = await searchParams;

  let data: Awaited<ReturnType<typeof listMyQueue>>;
  try {
    data = await listMyQueue(actor, {
      view: sp.view ?? 'all',
      department: sp.department || undefined,
      departureType: sp.departureType || undefined,
      q: sp.q || undefined,
    });
  } catch (e) {
    if (e instanceof ServiceError && e.code === 'FORBIDDEN')
      return (
        <>
          <h1>My Work</h1>
          <p className="panel">Your role does not have a work queue.</p>
        </>
      );
    if (e instanceof ServiceError) {
      return (
        <>
          <h1>My Work</h1>
          <p className="panel">Invalid filter; showing nothing. Adjust the filters and retry.</p>
        </>
      );
    }
    throw e;
  }

  const activeView = sp.view ?? 'all';
  // Department chrome only earns its place when work actually spans
  // departments (a filtered view keeps it visible so the filter can be
  // cleared).
  const showDepartments = data.departmentsWithWork.length > 1 || !!sp.department;
  const mkHref = (view: string) => {
    const p = new URLSearchParams();
    p.set('view', view);
    if (sp.department) p.set('department', sp.department);
    if (sp.departureType) p.set('departureType', sp.departureType);
    if (sp.q) p.set('q', sp.q);
    return `/queue?${p.toString()}`;
  };
  // Current filters, preserved across claim/return round-trips.
  const queryString = (() => {
    const p = new URLSearchParams();
    p.set('view', activeView);
    if (sp.department) p.set('department', sp.department);
    if (sp.departureType) p.set('departureType', sp.departureType);
    if (sp.q) p.set('q', sp.q);
    return p.toString();
  })();

  return (
    <>
      <h1>My Work</h1>
      <Feedback err={sp.err} ok={sp.ok} />

      <nav aria-label="Queue views" className="panel" style={{ padding: '0.4rem 0.75rem' }}>
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.25rem',
          }}
        >
          {VIEWS.map(([key, label]) => (
            <li key={key}>
              <Link
                href={mkHref(key)}
                className="button secondary"
                aria-current={activeView === key ? 'page' : undefined}
                style={
                  activeView === key
                    ? { background: 'var(--accent)', color: 'var(--on-accent)' }
                    : { border: '1px solid transparent' }
                }
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <form method="get" action="/queue" className="panel" aria-label="Queue filters">
        <input type="hidden" name="view" value={activeView} />
        <div className="filter-toolbar">
          {/* The department filter appears only when live work genuinely
              spans more than one department (owner request, 2026-08-18):
              the current workflow puts everything in HR plus manager
              handover, so it stays hidden in normal operation. */}
          {showDepartments ? (
            <div className="field field--md">
              <label htmlFor="qf-dept">Department</label>
              <select id="qf-dept" name="department" defaultValue={sp.department ?? ''}>
                <option value="">All my departments</option>
                {data.departmentsWithWork.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="field field--lg">
            <label htmlFor="qf-q">Task Title or Case Number</label>
            <input
              id="qf-q"
              type="search"
              name="q"
              defaultValue={sp.q ?? ''}
              maxLength={100}
              placeholder="Search tasks…"
            />
          </div>
          <button type="submit" className="secondary">
            Apply Filters
          </button>
        </div>
      </form>

      {data.rows.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<CheckCircleIcon />}
            tone="done"
            title="Nothing in this view"
            body="No task matches the filters you have applied. Try another view above, or clear the search."
          />
        </div>
      ) : (
        <Rows label="Work queue tasks">
          {data.rows.map((r) => (
            <Row
              key={r.id}
              tone={
                r.overdueMinutes > 0
                  ? 'critical'
                  : r.status === 'BLOCKED'
                    ? 'attention'
                    : r.status === 'COMPLETED'
                      ? 'done'
                      : 'progress'
              }
              muted={r.status === 'COMPLETED'}
              mark={r.overdueMinutes > 0 ? <AlertIcon /> : <QueueIcon />}
              title={
                <>
                  <Link href={`/tasks/${r.id}`}>{r.title}</Link>
                  {r.taskKind === 'ACCESS_REVOCATION' ? (
                    <>
                      {' '}
                      <Chip tone="critical">Exact time</Chip>
                    </>
                  ) : null}
                  {r.confidential ? (
                    <>
                      {' '}
                      <Chip tone="attention">Restricted</Chip>
                    </>
                  ) : null}
                </>
              }
              sub={
                <>
                  {r.caseId ? (
                    <Link href={`/cases/${r.caseId}`}>{r.caseNumber}</Link>
                  ) : (
                    r.caseNumber
                  )}
                  {' · '}
                  {r.employeeDisplayName}
                  {showDepartments ? ` · ${r.department}` : ''}
                  {r.blockedReason ? ` · blocker: ${r.blockedReason}` : ''}
                </>
              }
              facts={
                <>
                  <span>
                    <span className="label">Due</span>
                    <span className="value numeric">
                      {r.dueAt ? formatInstant(r.dueAt) : 'No date'}
                    </span>
                  </span>
                  <span>
                    <span className="label">Owner</span>
                    <span className="value">
                      {r.assignedToMe ? 'You' : (r.assigneeName ?? 'Unassigned')}
                    </span>
                  </span>
                  <span className={`badge ${TASK_BADGE[r.status] ?? 'badge--neutral'}`}>
                    {humanize(r.status)}
                  </span>
                  {r.overdueMinutes > 0 ? (
                    <Chip tone="critical">
                      {r.overdueMinutes >= 1440
                        ? `${Math.floor(r.overdueMinutes / 1440)}d overdue`
                        : `${r.overdueMinutes}m overdue`}
                    </Chip>
                  ) : null}
                  {r.priority && r.priority !== 'NORMAL' ? (
                    <Chip tone="attention">{humanize(r.priority)}</Chip>
                  ) : null}
                </>
              }
              action={
                <>
                  {r.canClaimHere ? (
                    <form action={claimTaskAction}>
                      <input type="hidden" name="taskId" value={r.id} />
                      <input type="hidden" name="query" value={queryString} />
                      <button type="submit" className="secondary compact">
                        Claim
                      </button>
                    </form>
                  ) : null}
                  {r.assignedToMe && ['READY', 'IN_PROGRESS', 'BLOCKED'].includes(r.status) ? (
                    <details className="action">
                      <summary>Return to queue</summary>
                      <form action={returnTaskAction} className="stack">
                        <input type="hidden" name="taskId" value={r.id} />
                        <input type="hidden" name="query" value={queryString} />
                        <div className="field">
                          <label htmlFor={`rtq-${r.id}`}>Reason (Required, Audited)</label>
                          <input id={`rtq-${r.id}`} name="reason" required maxLength={500} />
                        </div>
                        <button type="submit" className="secondary">
                          Return task
                        </button>
                      </form>
                    </details>
                  ) : null}
                </>
              }
            />
          ))}
        </Rows>
      )}
    </>
  );
}
