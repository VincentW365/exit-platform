import Link from 'next/link';
import type { Metadata } from 'next';
import { ServiceError, listDirectory } from '@exit/db';
import { can } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { DirectoryFreshnessNote } from '@/components/DirectoryFreshness';
import { EmptyState } from '@/components/EmptyState';
import { DirectoryIcon, SearchIcon } from '@/components/icons';
import { AutoFocus } from '@/components/keyboard';
import { Avatar, Chip, Row, Rows, type Tone } from '@/components/patterns';
import { countOf } from '@/lib/text';

export const metadata: Metadata = { title: 'Employee Directory' };
export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<string, Tone> = {
  Active: 'done',
  Inactive: 'neutral',
  Terminated: 'attention',
  Archived: 'neutral',
};

type Sp = Record<string, string | undefined>;

/**
 * The Employee Directory (owner directive, 2026-09-15, sections 4 and 21):
 * a read-only mirror of BambooHR, searched and filtered from LOCAL data
 * only - no request here ever calls BambooHR. Active employees by default;
 * the status filter reaches inactive and archived people, who are kept
 * because cases and history point at them.
 */
export default async function DirectoryPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const { actor } = await requireAuth();
  const sp = await searchParams;
  if (!can(actor, 'employeeSource.search'))
    return (
      <>
        <h1 className="page-title">Access Restricted</h1>
        <p className="panel">The employee directory is limited to authorized HR roles.</p>
      </>
    );
  const status = sp.status === 'inactive' || sp.status === 'all' ? sp.status : 'active';
  const filters = {
    q: sp.q ?? '',
    department: sp.department || undefined,
    location: sp.location || undefined,
    division: sp.division || undefined,
    managerId: sp.manager || undefined,
    status,
  } as const;
  let data: Awaited<ReturnType<typeof listDirectory>>;
  try {
    data = await listDirectory(actor, filters);
  } catch (e) {
    if (e instanceof ServiceError)
      return (
        <>
          <h1 className="page-title">Access Restricted</h1>
          <p className="panel">The employee directory is limited to authorized HR roles.</p>
        </>
      );
    throw e;
  }
  const filtering = Boolean(
    filters.q || filters.department || filters.location || filters.division || filters.managerId,
  );
  const applied = [
    filters.q ? `Matching "${filters.q}"` : null,
    filters.department ?? null,
    filters.location ?? null,
    filters.division ?? null,
    filters.managerId
      ? `Reports to ${data.facets.managers.find((m) => m.id === filters.managerId)?.displayName ?? 'manager'}`
      : null,
    status === 'inactive' ? 'Inactive only' : status === 'all' ? 'All statuses' : null,
  ].filter((x): x is string => !!x);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Employee Directory</h1>
          <p className="page-lede">
            Everyone in the company directory, mirrored from BambooHR and kept in step by continuous
            synchronization. Search by name, employee number, title, department, work email or
            manager, then open a profile to start an offboarding.
          </p>
        </div>
        <div className="actions-row">
          <Link className="button secondary" href="/directory/organization">
            Reporting structure
          </Link>
          {can(actor, 'case.create') ? (
            <Link className="button" href="/cases/new">
              New case
            </Link>
          ) : null}
        </div>
      </div>

      <DirectoryFreshnessNote
        freshness={data.sync.freshness}
        lastSuccessfulAt={data.sync.lastSuccessfulAt}
        admin={can(actor, 'admin.system')}
      />

      <form method="get" className="panel" aria-label="Search the directory" role="search">
        <div className="filter-toolbar">
          <div className="field field--lg">
            <label htmlFor="dir-q">Name, employee number, title or email</label>
            <input
              id="dir-q"
              type="search"
              name="q"
              defaultValue={filters.q}
              placeholder="Search employees…"
              autoComplete="off"
            />
          </div>
          <div className="field field--md">
            <label htmlFor="dir-dept">Department</label>
            <select id="dir-dept" name="department" defaultValue={filters.department ?? ''}>
              <option value="">Any</option>
              {data.facets.departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div className="field field--md">
            <label htmlFor="dir-loc">Location</label>
            <select id="dir-loc" name="location" defaultValue={filters.location ?? ''}>
              <option value="">Any</option>
              {data.facets.locations.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          {data.facets.divisions.length > 0 ? (
            <div className="field field--md">
              <label htmlFor="dir-div">Division</label>
              <select id="dir-div" name="division" defaultValue={filters.division ?? ''}>
                <option value="">Any</option>
                {data.facets.divisions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="field field--md">
            <label htmlFor="dir-mgr">Manager</label>
            <select id="dir-mgr" name="manager" defaultValue={filters.managerId ?? ''}>
              <option value="">Any</option>
              {data.facets.managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="field field--sm">
            <label htmlFor="dir-status">Status</label>
            <select id="dir-status" name="status" defaultValue={status}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All</option>
            </select>
          </div>
          <button type="submit">Search</button>
          {filtering || status !== 'active' ? (
            <Link className="button secondary" href="/directory">
              Clear
            </Link>
          ) : null}
        </div>
        {applied.length ? (
          <p className="filter-applied" aria-live="polite">
            {applied.join(' · ')}
          </p>
        ) : null}
      </form>
      {!filtering ? <AutoFocus selector="#dir-q" /> : null}

      <p className="hint" aria-live="polite">
        {data.total === data.rows.length
          ? countOf(data.total, 'employee')
          : `Showing ${data.rows.length} of ${countOf(data.total, 'employee')}`}
        {status === 'active' ? ' (active)' : status === 'inactive' ? ' (inactive)' : ''}
        {' · '}
        {countOf(data.sync.employees, 'active employee')} in the directory.
      </p>

      {data.rows.length === 0 ? (
        data.sync.freshness.state === 'NEVER' ? (
          <EmptyState
            icon={<DirectoryIcon />}
            title="The directory is empty"
            body="No employee records have been synchronized yet. Once the first synchronization completes, every employee appears here."
            tone="attention"
          />
        ) : (
          <EmptyState
            icon={<SearchIcon />}
            title="No matching employee"
            body={
              filtering
                ? 'Nothing in the directory matches these filters. Try a different spelling or fewer filters - or include inactive employees.'
                : 'No employees match the selected status.'
            }
            action={{ href: '/directory?status=all', label: 'Include inactive employees' }}
          />
        )
      ) : (
        <Rows label="Employees">
          {data.rows.map((e) => (
            <Row
              key={e.id}
              mark={<Avatar name={e.displayName} />}
              title={
                <Link href={`/directory/${e.id}`} data-directory-card>
                  {e.displayName}
                  {e.preferredName && e.preferredName !== e.firstName
                    ? ` (${e.preferredName})`
                    : ''}
                </Link>
              }
              sub={[e.jobTitle, e.department, e.location].filter(Boolean).join(' · ') || '-'}
              facts={
                <>
                  <span className="hint">
                    {e.managerName ? `Manager: ${e.managerName}` : 'No manager recorded'}
                  </span>
                  <span className="hint">{e.employeeNumber ? `#${e.employeeNumber}` : ''}</span>
                  <span className="hint">{e.workEmail ?? ''}</span>
                  <Chip tone={STATUS_TONE[e.status] ?? 'neutral'}>{e.status}</Chip>
                </>
              }
              action={
                <Link className="button secondary" href={`/directory/${e.id}`}>
                  View profile
                </Link>
              }
              muted={!e.active}
            />
          ))}
        </Rows>
      )}
    </>
  );
}
