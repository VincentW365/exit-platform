import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { can, formatInstant } from '@exit/domain';
import { listGlobalAudit } from '@exit/db';
import { requireAuth } from '@/lib/auth';

export const metadata: Metadata = { title: 'Audit feed' };
export const dynamic = 'force-dynamic';

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ eventType?: string }>;
}) {
  const { actor } = await requireAuth();
  if (!can(actor, 'audit.viewGlobal')) redirect('/unauthorized');
  const { eventType } = await searchParams;
  const events = await listGlobalAudit(actor, { eventType: eventType || undefined });

  return (
    <>
      <h1>Audit feed (read-only oversight)</h1>
      <form method="get" className="panel actions-row" aria-label="Filter audit events">
        <div className="field" style={{ maxWidth: '20rem' }}>
          <label htmlFor="a-type">Event type (exact, optional)</label>
          <input id="a-type" name="eventType" type="text" defaultValue={eventType ?? ''} />
        </div>
        <div style={{ alignSelf: 'end' }}>
          <button type="submit">Filter</button>
        </div>
      </form>
      <div className="table-wrap" tabIndex={0}>
        <table className="data">
          <caption>
            Most recent {events.length} events. Metadata is sanitized: no document bodies, personal
            addresses, tokens or survey content is ever recorded.
          </caption>
          <thead>
            <tr>
              <th scope="col">When (America/Jamaica)</th>
              <th scope="col">Event</th>
              <th scope="col">Object</th>
              <th scope="col">Result</th>
              <th scope="col">Roles</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>{formatInstant(e.occurredAt)}</td>
                <td>{e.eventType}</td>
                <td>
                  {e.objectType} <span className="hint">{e.objectId.slice(0, 8)}</span>
                </td>
                <td>{e.result}</td>
                <td className="hint">{e.effectiveRoles.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
