import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { can, formatDateOnly, formatInstant } from '@exit/domain';
import { listCases } from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { ClassificationBadge, Feedback, PurposeBadge, StatusBadge } from '@/components/ui';
import { humanize } from '@/lib/text';
import { PlusIcon } from '@/components/icons';
import { EmptyState } from '@/components/EmptyState';
import { CasesIcon } from '@/components/icons';

export const metadata: Metadata = { title: 'Cases' };
export const dynamic = 'force-dynamic';

const STATUSES = ['DRAFT', 'PENDING_HR_REVIEW', 'APPROVED', 'CANCELLED', 'VOIDED'] as const;

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  if (!can(actor, 'case.list')) redirect('/unauthorized');
  const sp = await searchParams;
  const rows = await listCases(actor, {
    status: sp.status || undefined,
    departureType: sp.departureType || undefined,
    measurementCohort: sp.measurementCohort || undefined,
    recordPurpose: sp.recordPurpose || undefined,
    q: sp.q || undefined,
  });

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
          {/* Final-product surface (owner request, 2026-08-17): the cohort and
              record-purpose filters left the UI; the query parameters still
              work for legacy-record housekeeping. */}
          <button type="submit" className="secondary">
            Apply Filters
          </button>
        </div>
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
        <div className="table-wrap" tabIndex={0}>
          <table className="data">
            <caption>
              {rows.length} case{rows.length === 1 ? '' : 's'} (restricted cases you are not
              assigned to are not listed)
            </caption>
            <thead>
              <tr>
                <th scope="col">Case</th>
                <th scope="col">Employee</th>
                <th scope="col">Type</th>
                <th scope="col">Status</th>
                <th scope="col">Received</th>
                <th scope="col">Effective separation</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.minimized ? (
                      c.caseNumber
                    ) : (
                      <Link href={`/cases/${c.id}`}>{c.caseNumber}</Link>
                    )}{' '}
                    <ClassificationBadge classification={c.classification} />{' '}
                    <PurposeBadge purpose={c.recordPurpose} cohort={c.measurementCohort} />
                  </td>
                  <td>{c.employeeDisplayName}</td>
                  <td>{humanize(c.departureType)}</td>
                  <td>
                    <StatusBadge status={c.status} />
                  </td>
                  <td>{formatDateOnly(c.receivedAt)}</td>
                  <td>{c.effectiveSeparationAt ? formatInstant(c.effectiveSeparationAt) : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
