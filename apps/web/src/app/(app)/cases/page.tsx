import Link from 'next/link';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { can, formatDateOnly, formatInstant } from '@exit/domain';
import { listCases } from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { ClassificationBadge, Feedback, PurposeBadge, StatusBadge } from '@/components/ui';

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
      <h1>Offboarding cases</h1>
      <Feedback err={sp.err} ok={sp.ok} />

      <form method="get" className="panel" aria-label="Filter cases">
        <div className="actions-row">
          <div className="field" style={{ maxWidth: '16rem' }}>
            <label htmlFor="f-q">Search (case number or employee)</label>
            <input id="f-q" type="search" name="q" defaultValue={sp.q ?? ''} />
          </div>
          <div className="field" style={{ maxWidth: '13rem' }}>
            <label htmlFor="f-status">Status</label>
            <select id="f-status" name="status" defaultValue={sp.status ?? ''}>
              <option value="">Any</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replaceAll('_', ' ')}
                </option>
              ))}
            </select>
          </div>
          <div className="field" style={{ maxWidth: '15rem' }}>
            <label htmlFor="f-type">Departure type</label>
            <select id="f-type" name="departureType" defaultValue={sp.departureType ?? ''}>
              <option value="">Any</option>
              <option value="RESIGNATION_WITH_NOTICE">Resignation with notice</option>
              <option value="IMMEDIATE_RESIGNATION">Immediate resignation</option>
              <option value="TERMINATION">Termination</option>
            </select>
          </div>
          <div className="field" style={{ maxWidth: '11rem' }}>
            <label htmlFor="f-cohort">Cohort</label>
            <select
              id="f-cohort"
              name="measurementCohort"
              defaultValue={sp.measurementCohort ?? ''}
            >
              <option value="">Any</option>
              <option value="BASELINE">BASELINE</option>
              <option value="PILOT">PILOT</option>
              <option value="POST_ROLLOUT">POST_ROLLOUT</option>
            </select>
          </div>
          <div className="field" style={{ maxWidth: '11rem' }}>
            <label htmlFor="f-purpose">Record purpose</label>
            <select id="f-purpose" name="recordPurpose" defaultValue={sp.recordPurpose ?? ''}>
              <option value="">Any</option>
              <option value="OPERATIONAL">OPERATIONAL</option>
              <option value="TRAINING">TRAINING</option>
              <option value="TEST">TEST</option>
            </select>
          </div>
          <div style={{ alignSelf: 'end' }}>
            <button type="submit">Apply filters</button>
          </div>
        </div>
      </form>

      {rows.length === 0 ? (
        <p className="panel">No cases match your access and filters.</p>
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
                <th scope="col">Cohort / purpose</th>
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
                    <ClassificationBadge classification={c.classification} />
                  </td>
                  <td>{c.employeeDisplayName}</td>
                  <td>{c.departureType.replaceAll('_', ' ').toLowerCase()}</td>
                  <td>
                    <StatusBadge status={c.status} />
                  </td>
                  <td>
                    <PurposeBadge purpose={c.recordPurpose} cohort={c.measurementCohort} />
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
