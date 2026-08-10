import type { Metadata } from 'next';
import Link from 'next/link';
import { ServiceError, listMyQueue } from '@exit/db';
import { formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';

export const metadata: Metadata = { title: 'My work queue' };
export const dynamic = 'force-dynamic';

const VIEWS = [
  ['all', 'All open'],
  ['ready', 'Ready'],
  ['inProgress', 'In progress'],
  ['blocked', 'Blocked'],
  ['dueToday', 'Due today'],
  ['dueThisWeek', 'Due this week'],
  ['overdue', 'Overdue'],
  ['criticalOverdue', 'Critical overdue'],
  ['assignedToMe', 'Assigned to me'],
  ['unassigned', 'Unassigned'],
  ['reassigned', 'Reassigned'],
  ['completed', 'Completed'],
  ['waived', 'Waived'],
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
          <h1>My work queue</h1>
          <p className="panel">Your role does not have a department work queue.</p>
        </>
      );
    if (e instanceof ServiceError) {
      return (
        <>
          <h1>My work queue</h1>
          <p className="panel">Invalid filter; showing nothing. Adjust the filters and retry.</p>
        </>
      );
    }
    throw e;
  }

  const activeView = sp.view ?? 'all';
  const mkHref = (view: string) => {
    const p = new URLSearchParams();
    p.set('view', view);
    if (sp.department) p.set('department', sp.department);
    if (sp.q) p.set('q', sp.q);
    return `/queue?${p.toString()}`;
  };

  return (
    <>
      <h1>My work queue</h1>
      <p className="hint">
        Departments visible to you: {data.departments.join(', ') || 'none'}. Tasks show only the
        minimum information needed to do the work; a task never grants wider case access.
      </p>

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
                    ? { background: 'var(--brand-blue)', color: '#fff' }
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
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          {data.departments.length > 1 ? (
            <div className="field" style={{ maxWidth: '13rem' }}>
              <label htmlFor="qf-dept">Department</label>
              <select id="qf-dept" name="department" defaultValue={sp.department ?? ''}>
                <option value="">All my departments</option>
                {data.departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="field" style={{ maxWidth: '18rem' }}>
            <label htmlFor="qf-q">Search (task title or case number)</label>
            <input id="qf-q" name="q" defaultValue={sp.q ?? ''} maxLength={100} />
          </div>
          <button type="submit">Apply filters</button>
        </div>
      </form>

      {data.rows.length === 0 ? (
        <p className="panel">No tasks match this view.</p>
      ) : (
        <div className="panel" style={{ overflowX: 'auto' }} tabIndex={0}>
          <table>
            <caption className="visually-hidden">Work queue tasks</caption>
            <thead>
              <tr>
                <th scope="col">Task</th>
                <th scope="col">Case / employee</th>
                <th scope="col">Department</th>
                <th scope="col">Status</th>
                <th scope="col">Priority</th>
                <th scope="col">Due</th>
                <th scope="col">Next action</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/tasks/${r.id}`}>{r.title}</Link>
                    {r.taskKind === 'ACCESS_REVOCATION' ? (
                      <>
                        {' '}
                        <span className="badge badge--danger">EXACT TIME</span>
                      </>
                    ) : null}
                    {r.confidential ? (
                      <>
                        {' '}
                        <span className="badge badge--warning">Restricted</span>
                      </>
                    ) : null}
                  </td>
                  <td>
                    {r.caseId ? (
                      <Link href={`/cases/${r.caseId}`}>{r.caseNumber}</Link>
                    ) : (
                      r.caseNumber
                    )}
                    <br />
                    <span className="hint">{r.employeeDisplayName}</span>
                    {r.departureType ? <span className="hint"> - {r.departureType}</span> : null}
                  </td>
                  <td>{r.department}</td>
                  <td>
                    <span className={`badge ${TASK_BADGE[r.status] ?? 'badge--neutral'}`}>
                      {r.status}
                    </span>
                    {r.overdueMinutes > 0 ? (
                      <>
                        {' '}
                        <span className="badge badge--danger">
                          {r.overdueMinutes >= 1440
                            ? `${Math.floor(r.overdueMinutes / 1440)}d overdue`
                            : `${r.overdueMinutes}m overdue`}
                        </span>
                      </>
                    ) : null}
                    {r.blockedReason ? <p className="hint">Blocker: {r.blockedReason}</p> : null}
                  </td>
                  <td>{r.priority}</td>
                  <td>{r.dueAt ? formatInstant(r.dueAt) : '-'}</td>
                  <td>
                    {r.nextAction}
                    {r.assignedToMe ? <span className="hint"> (assigned to you)</span> : null}
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
