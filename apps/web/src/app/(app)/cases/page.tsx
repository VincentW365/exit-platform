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
import { Chip, Avatar, Row, Rows } from '@/components/patterns';
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
              return (
                <Row
                  key={c.id}
                  tone={soon ? 'attention' : undefined}
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
                      <StatusBadge status={c.status} />
                      <ClassificationBadge classification={c.classification} />
                      <PurposeBadge purpose={c.recordPurpose} cohort={c.measurementCohort} />
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
