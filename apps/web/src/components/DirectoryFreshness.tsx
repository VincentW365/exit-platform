import Link from 'next/link';
import { formatInstant, type DirectoryFreshness as Freshness } from '@exit/domain';

/**
 * How current the employee directory is (owner directive, 2026-09-15,
 * section 19). Calm while the mirror is fresh - one quiet line - and louder
 * only as the gap grows. The directory itself stays usable in every state:
 * the ONLY message that says "unavailable" is the one for an installation
 * that has never synchronized at all.
 */
export function DirectoryFreshnessNote({
  freshness,
  lastSuccessfulAt,
  admin = false,
}: {
  freshness: Freshness;
  lastSuccessfulAt: Date | null;
  admin?: boolean;
}) {
  const when = lastSuccessfulAt ? formatInstant(lastSuccessfulAt) : null;
  if (freshness.state === 'CURRENT') {
    return (
      <p className="hint" data-directory-freshness="CURRENT">
        {freshness.message}
        {when ? ` (${when}).` : ''} Read-only mirror of BambooHR.
      </p>
    );
  }
  if (freshness.state === 'DELAYED') {
    return (
      <p className="hint" role="status" data-directory-freshness="DELAYED">
        <span className="badge badge--warning">Refresh delayed</span> {freshness.message}
        {when ? ` Last successful synchronization ${when}.` : ''}
      </p>
    );
  }
  if (freshness.state === 'NEVER') {
    return (
      <div
        className="panel panel--edge panel--edge-attention"
        role="status"
        data-directory-freshness="NEVER"
      >
        <p style={{ margin: 0 }}>
          <span className="badge badge--warning">Not yet synchronized</span> The employee directory
          is unavailable because it has never been synchronized from BambooHR.
          {admin ? (
            <>
              {' '}
              <Link href="/admin/system#directory-h">Refresh the directory now</Link>.
            </>
          ) : (
            ' Ask the HR Manager to run the first synchronization.'
          )}
        </p>
      </div>
    );
  }
  const alert = freshness.state === 'ALERT';
  return (
    <div
      className={`panel panel--edge ${alert ? 'panel--edge-critical' : 'panel--edge-attention'}`}
      role={alert ? 'alert' : 'status'}
      data-directory-freshness={freshness.state}
    >
      <p style={{ margin: 0 }}>
        <span className={`badge ${alert ? 'badge--danger' : 'badge--warning'}`}>
          {freshness.label}
        </span>{' '}
        {freshness.message}
        {when ? ` Last successful synchronization ${when}.` : ''}{' '}
        {alert && admin ? (
          <Link href="/admin/directory-sync">Review the synchronization log</Link>
        ) : (
          'Employee data shown here may not reflect the latest BambooHR changes.'
        )}
      </p>
    </div>
  );
}
