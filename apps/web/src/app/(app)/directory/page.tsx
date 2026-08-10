import type { Metadata } from 'next';
import { formatInstant } from '@exit/domain';
import { ServiceError, directoryOverview } from '@exit/db';
import { requireAuth } from '@/lib/auth';

export const metadata: Metadata = { title: 'Organization directory' };
export const dynamic = 'force-dynamic';

export default async function DirectoryPage() {
  const { actor } = await requireAuth();
  let data: Awaited<ReturnType<typeof directoryOverview>>;
  try {
    data = await directoryOverview(actor);
  } catch (e) {
    if (e instanceof ServiceError)
      return <p className="panel">The organization directory is limited to authorized HR roles.</p>;
    throw e;
  }

  return (
    <>
      <h1>Organization directory (case preparation)</h1>
      <p className="hint" role="note">
        Reference view over the LOCAL employee-source cache for HR case preparation only - not an
        employee self-service directory. Employee emails are deliberately not shown here. Use
        &quot;New case&quot; to search and select an individual employee.
      </p>

      <section className="panel" aria-labelledby="dir-totals-h">
        <h2 id="dir-totals-h" style={{ marginTop: 0 }}>
          Coverage
        </h2>
        <ul>
          <li>
            {data.totals.records} directory record(s): {data.totals.active} active,{' '}
            {data.totals.inactive} inactive
            {data.totals.purged > 0 ? `, ${data.totals.purged} purged` : ''}.
          </li>
          <li>{data.positions} distinct position(s).</li>
          <li>{data.withManager} record(s) with manager data.</li>
          <li>
            Sources:{' '}
            {data.bySource.map((s) => `${s.sourceSystem} (${s.records})`).join(', ') || 'none yet'}.
          </li>
        </ul>
      </section>

      <section className="panel" aria-labelledby="dir-dept-h">
        <h2 id="dir-dept-h" style={{ marginTop: 0 }}>
          Departments and locations
        </h2>
        <div className="table-wrap" tabIndex={0}>
          <table className="data">
            <caption className="visually-hidden">Records per department</caption>
            <thead>
              <tr>
                <th scope="col">Department</th>
                <th scope="col">Records</th>
              </tr>
            </thead>
            <tbody>
              {data.byDepartment.map((d) => (
                <tr key={d.department}>
                  <td>{d.department}</td>
                  <td>{d.records}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">
          Locations:{' '}
          {data.byLocation.map((l) => `${l.location} (${l.records})`).join(', ') || 'none recorded'}
          .
        </p>
      </section>

      <section className="panel" aria-labelledby="dir-gaps-h">
        <h2 id="dir-gaps-h" style={{ marginTop: 0 }}>
          Data gaps to resolve before case work
        </h2>
        {data.gaps.missingDepartment.length === 0 &&
        data.gaps.missingManager.length === 0 &&
        data.gaps.missingPosition.length === 0 ? (
          <p>No missing organizational data in the cached directory.</p>
        ) : (
          <ul>
            {data.gaps.missingDepartment.map((e) => (
              <li key={`d-${e.sourceId}`}>
                {e.displayName} ({e.sourceId}) - missing department
              </li>
            ))}
            {data.gaps.missingPosition.map((e) => (
              <li key={`p-${e.sourceId}`}>
                {e.displayName} ({e.sourceId}) - missing position
              </li>
            ))}
            {data.gaps.missingManager.map((e) => (
              <li key={`m-${e.sourceId}`}>
                {e.displayName} ({e.sourceId}) - missing manager data
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel" aria-labelledby="dir-sync-h">
        <h2 id="dir-sync-h" style={{ marginTop: 0 }}>
          Synchronization history
        </h2>
        {data.lastSyncs.length === 0 ? (
          <p>No synchronization has run yet.</p>
        ) : (
          <ul>
            {data.lastSyncs.map((s, i) => (
              <li key={i}>
                {s.mode} - started {formatInstant(s.startedAt)}
                {s.finishedAt ? `, finished ${formatInstant(s.finishedAt)}` : ''} - {s.created}{' '}
                created, {s.updated} updated.
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
