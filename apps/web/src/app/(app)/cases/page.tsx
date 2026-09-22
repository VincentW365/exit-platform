import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { can, formatDateOnly, formatInstant } from '@exit/domain';
import { listCaseFilterOptions, listCases } from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { ClassificationBadge, Feedback, PurposeBadge, StatusBadge } from '@/components/ui';
import { humanize } from '@/lib/text';
import { PlusIcon } from '@/components/icons';
import { EmptyState } from '@/components/EmptyState';
import { Chip, Avatar, Row, Rows } from '@/components/patterns';
import { CasesIcon } from '@/components/icons';

export const metadata: Metadata = { title: 'Cases' };
export const dynamic = 'force-dynamic';

const STATUSES = ['DRAFT', 'PENDING_HR_REVIEW', 'APPROVED', 'CANCELLED', 'VOIDED'] as const;

const LEAVING_LABEL: Record<string, string> = {
  week: 'Leaving within 7 days',
  month: 'Leaving within 30 days',
  overdue: 'Already gone, case open',
};
const PROGRESS_LABEL: Record<string, string> = {
  'not-started': 'Not started',
  underway: 'Underway',
  'nearly-done': 'Nearly done',
  done: 'All tasks done',
};

/**
 * Section 15: which filters are on, said in the reader's words. The officer
 * filter is a user id in the URL, so its chip is resolved from the options
 * the page already loaded rather than printing a uuid at somebody.
 */
type Sp = Record<string, string | undefined>;
const ACTIVE_FILTERS: ReadonlyArray<(sp: Sp) => string | null> = [
  (sp) => (sp.q ? `Matching "${sp.q}"` : null),
  (sp) => (sp.status ? humanize(sp.status) : null),
  (sp) => (sp.departureType ? humanize(sp.departureType) : null),
  (sp) => sp.department ?? null,
  (sp) => (sp.manager ? `Manager: ${sp.manager}` : null),
  (sp) => (sp.leaving ? (LEAVING_LABEL[sp.leaving] ?? sp.leaving) : null),
  (sp) => (sp.progress ? (PROGRESS_LABEL[sp.progress] ?? sp.progress) : null),
  (sp) => (sp.attention === 'yes' ? 'Needs attention' : null),
];

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  if (!can(actor, 'case.list')) redirect('/unauthorized');
  const sp = await searchParams;
  const filter = {
    status: sp.status || undefined,
    departureType: sp.departureType || undefined,
    measurementCohort: sp.measurementCohort || undefined,
    recordPurpose: sp.recordPurpose || undefined,
    q: sp.q || undefined,
    department: sp.department || undefined,
    officer: sp.officer || undefined,
    manager: sp.manager || undefined,
    leaving: sp.leaving || undefined,
    attention: sp.attention || undefined,
    progress: sp.progress || undefined,
  };
  const [rows, options] = await Promise.all([
    listCases(actor, filter),
    listCaseFilterOptions(actor),
  ]);
  // Section 15: the reader should be able to see at a glance that a filter is
  // on, and undo it in one click - a filtered list that looks like the whole
  // list is how people conclude cases have gone missing.
  const applied = ACTIVE_FILTERS.map((f) => f(sp)).filter((x): x is string => x !== null);
  const officerName = options.officers.find((o) => o.id === sp.officer)?.displayName;
  if (officerName) applied.push(`Officer: ${officerName}`);

  return (
    <>
      <div className="page-header">
        <h1>Offboarding Cases</h1>
        {can(actor, 'case.create') ? (
          <Link className="button button--primary" href="/cases/new">
            <PlusIcon />
            Create New Case
          </Link>
        ) : null}
      </div>
      <Feedback err={sp.err} ok={sp.ok} />

      <form method="get" className="panel" aria-label="Filter cases">
        <div className="filter-toolbar">
          <div className="field field--lg">
            <label htmlFor="f-q">Case Number or Employee</label>
            <input
              id="f-q"
              type="search"
              name="q"
              defaultValue={sp.q ?? ''}
              placeholder="Search cases…"
            />
          </div>
          <div className="field field--md">
            <label htmlFor="f-status">Status</label>
            <select id="f-status" name="status" defaultValue={sp.status ?? ''}>
              <option value="">Any</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {humanize(s)}
                </option>
              ))}
            </select>
          </div>
          <div className="field field--md">
            <label htmlFor="f-type">Departure Type</label>
            <select id="f-type" name="departureType" defaultValue={sp.departureType ?? ''}>
              <option value="">Any</option>
              <option value="RESIGNATION_WITH_NOTICE">Resignation with notice</option>
              <option value="IMMEDIATE_RESIGNATION">Immediate resignation</option>
              <option value="TERMINATION">Termination</option>
            </select>
          </div>
          <div className="field field--md">
            <label htmlFor="f-dept">Department</label>
            <select id="f-dept" name="department" defaultValue={sp.department ?? ''}>
              <option value="">Any</option>
              {options.departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div className="field field--md">
            <label htmlFor="f-officer">HR Officer</label>
            <select id="f-officer" name="officer" defaultValue={sp.officer ?? ''}>
              <option value="">Anyone</option>
              {options.officers.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="field field--md">
            <label htmlFor="f-manager">Manager</label>
            <input
              id="f-manager"
              type="search"
              name="manager"
              defaultValue={sp.manager ?? ''}
              placeholder="Manager name"
            />
          </div>
          <div className="field field--md">
            <label htmlFor="f-leaving">Leaving</label>
            <select id="f-leaving" name="leaving" defaultValue={sp.leaving ?? ''}>
              <option value="">Any time</option>
              <option value="week">Within 7 days</option>
              <option value="month">Within 30 days</option>
              <option value="overdue">Already gone, case still open</option>
            </select>
          </div>
          <div className="field field--md">
            <label htmlFor="f-progress">Progress</label>
            <select id="f-progress" name="progress" defaultValue={sp.progress ?? ''}>
              <option value="">Any</option>
              <option value="not-started">Not started</option>
              <option value="underway">Underway</option>
              <option value="nearly-done">Nearly done</option>
              <option value="done">All tasks done</option>
            </select>
          </div>
          <div className="field field--check">
            <label htmlFor="f-attention">
              <input
                id="f-attention"
                type="checkbox"
                name="attention"
                value="yes"
                defaultChecked={sp.attention === 'yes'}
              />
              <span>Needs attention only</span>
            </label>
          </div>
          {/* Final-product surface (owner request, 2026-08-17): the cohort and
              record-purpose filters left the UI; the query parameters still
              work for legacy-record housekeeping. */}
          <button type="submit" className="secondary">
            Apply Filters
          </button>
        </div>
        {applied.length > 0 ? (
          <p className="filter-applied">
            <span className="label">Filtered by</span>
            {applied.map((a) => (
              <Chip key={a} tone="info">
                {a}
              </Chip>
            ))}
            <Link className="button secondary compact" href="/cases">
              Clear all
            </Link>
          </p>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<CasesIcon />}
            title="No cases to show"
            body="Nothing matches your filters, and restricted cases you are not assigned to are never listed. Clear the filters or start a new offboarding."
            action={{ href: '/cases/new', label: 'Create New Case' }}
          />
        </div>
      ) : (
        <>
          <p className="meta" style={{ marginBottom: 'var(--space-3)' }}>
            {rows.length} case{rows.length === 1 ? '' : 's'}. Restricted cases you are not assigned
            to are never listed.
          </p>
          {/* A case is a person, so the row leads with the person and carries
              enough context to act without opening it. */}
          <Rows label="Offboarding cases">
            {rows.map((c) => {
              const days = c.daysUntil;
              const soon = days !== null && days >= 0 && days <= 7;
              // Section 15: the row answers the filter's questions, so a
              // reader who filtered on "needs attention" can see why.
              const needs = c.tasksOverdue > 0 || c.openExceptions > 0;
              const pct = c.tasksTotal > 0 ? Math.round((c.tasksDone / c.tasksTotal) * 100) : null;
              return (
                <Row
                  key={c.id}
                  tone={needs ? 'critical' : soon ? 'attention' : undefined}
                  mark={<Avatar name={c.employeeDisplayName} />}
                  title={
                    c.minimized ? (
                      c.employeeDisplayName
                    ) : (
                      <Link href={`/cases/${c.id}`}>{c.employeeDisplayName}</Link>
                    )
                  }
                  sub={
                    <>
                      {humanize(c.departureType)} · {c.caseNumber} · received{' '}
                      {formatDateOnly(c.receivedAt)}
                    </>
                  }
                  facts={
                    <>
                      <span>
                        <span className="label">Employment ends</span>
                        <span className="value numeric">
                          {c.effectiveSeparationAt ? formatInstant(c.effectiveSeparationAt) : '-'}
                        </span>
                      </span>
                      {pct !== null ? (
                        <span>
                          <span className="label">Progress</span>
                          <span className="value numeric">
                            {pct}% · {c.tasksDone}/{c.tasksTotal}
                          </span>
                        </span>
                      ) : null}
                      {/* DEC-065: the register shows every case with its
                          operational owner; an officer sees at once which
                          rows are theirs to work and which are read-only. */}
                      {!c.minimized ? (
                        <span>
                          <span className="label">Assigned HR Officer</span>
                          <span className="value">{c.officerName ?? 'Unassigned'}</span>
                        </span>
                      ) : null}
                      {!c.minimized && !c.editable ? <Chip tone="neutral">View only</Chip> : null}
                      <StatusBadge status={c.status} />
                      <ClassificationBadge classification={c.classification} />
                      <PurposeBadge purpose={c.recordPurpose} cohort={c.measurementCohort} />
                      {c.tasksOverdue > 0 ? (
                        <Chip tone="critical">
                          {c.tasksOverdue} overdue task{c.tasksOverdue === 1 ? '' : 's'}
                        </Chip>
                      ) : null}
                      {c.openExceptions > 0 ? (
                        <Chip tone="attention">
                          {c.openExceptions} exception{c.openExceptions === 1 ? '' : 's'}
                        </Chip>
                      ) : null}
                    </>
                  }
                  action={
                    soon ? (
                      <Chip tone="attention">
                        {days === 0 ? 'Today' : `${days} day${days === 1 ? '' : 's'} left`}
                      </Chip>
                    ) : null
                  }
                />
              );
            })}
          </Rows>
        </>
      )}
    </>
  );
}
