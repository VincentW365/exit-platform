import type { Metadata } from 'next';
import { ServiceError, listOutbox } from '@exit/db';
import { can, formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import {
  cancelOutboxAction,
  resolveDeadLetterAction,
  retryOutboxAction,
  runOutboxNowAction,
} from './actions';

export const metadata: Metadata = { title: 'Notification outbox' };
export const dynamic = 'force-dynamic';

const BADGE: Record<string, string> = {
  PENDING: 'badge--neutral',
  CLAIMED: 'badge--info',
  SUBMITTED: 'badge--success',
  DELIVERED: 'badge--success',
  FAILED_RETRYABLE: 'badge--warning',
  FAILED_PERMANENT: 'badge--danger',
  CANCELLED: 'badge--neutral',
  DEAD_LETTER: 'badge--danger',
};

export default async function OutboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const sp = await searchParams;
  let rows: Awaited<ReturnType<typeof listOutbox>>;
  try {
    rows = await listOutbox(actor, { status: sp.status });
  } catch (e) {
    if (e instanceof ServiceError)
      return <p className="panel">The outbox monitor requires an authorized role.</p>;
    throw e;
  }
  const canResolve = can(actor, 'outbox.resolve');

  return (
    <>
      <h1>Notification outbox</h1>
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint" role="note">
        Transactional outbox: approved notifications are enqueued in the same database transaction
        and dispatched by the worker with bounded backoff. CAPTURED/SUBMITTED are provider
        acceptance - DELIVERED appears only with provider delivery evidence. Destinations are always
        masked.
      </p>
      <form action={runOutboxNowAction} style={{ marginBottom: '1rem' }}>
        <button type="submit">Run outbox pass now</button>
      </form>

      {rows.length === 0 ? <p className="panel">No outbox records.</p> : null}
      <div className="panel" style={{ overflowX: 'auto' }} tabIndex={0}>
        <table>
          <caption className="visually-hidden">Outbox records</caption>
          <thead>
            <tr>
              <th scope="col">Notification / case</th>
              <th scope="col">Provider</th>
              <th scope="col">Destination (masked)</th>
              <th scope="col">Status</th>
              <th scope="col">Attempts</th>
              <th scope="col">Timing</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.notificationRecord.notificationType}
                  <br />
                  <span className="hint">{r.notificationRecord.case.caseNumber}</span>
                </td>
                <td>{r.provider}</td>
                <td>
                  <code>{r.destinationMask}</code>
                </td>
                <td>
                  <span className={`badge ${BADGE[r.status] ?? 'badge--neutral'}`}>{r.status}</span>
                  {r.deliveryStatus ? <span className="hint"> {r.deliveryStatus}</span> : null}
                  {r.lastErrorCode ? (
                    <>
                      <br />
                      <span className="hint">error: {r.lastErrorCode}</span>
                    </>
                  ) : null}
                  {r.resolutionNote ? (
                    <>
                      <br />
                      <span className="hint">resolved: {r.resolutionNote}</span>
                    </>
                  ) : null}
                </td>
                <td>{r.attempts}</td>
                <td>
                  scheduled {formatInstant(r.scheduledAt)}
                  {r.submittedAt ? (
                    <>
                      <br />
                      submitted {formatInstant(r.submittedAt)}
                    </>
                  ) : null}
                </td>
                <td>
                  {['PENDING', 'FAILED_RETRYABLE', 'CLAIMED'].includes(r.status) ? (
                    <details className="action">
                      <summary>Cancel</summary>
                      <form action={cancelOutboxAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <label htmlFor={`c-${r.id}`}>Reason</label>
                        <input id={`c-${r.id}`} name="reason" required maxLength={500} />
                        <button type="submit">Cancel dispatch</button>
                      </form>
                    </details>
                  ) : null}
                  {canResolve &&
                  ['FAILED_RETRYABLE', 'FAILED_PERMANENT', 'DEAD_LETTER'].includes(r.status) ? (
                    <details className="action">
                      <summary>Retry</summary>
                      <form action={retryOutboxAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <label htmlFor={`rt-${r.id}`}>Reason (audited)</label>
                        <input id={`rt-${r.id}`} name="reason" required maxLength={500} />
                        <button type="submit">Queue retry</button>
                      </form>
                    </details>
                  ) : null}
                  {canResolve &&
                  ['DEAD_LETTER', 'FAILED_PERMANENT'].includes(r.status) &&
                  !r.resolvedAt ? (
                    <details className="action">
                      <summary>Resolve</summary>
                      <form action={resolveDeadLetterAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <label htmlFor={`rs-${r.id}`}>Resolution (audited)</label>
                        <input id={`rs-${r.id}`} name="resolution" required maxLength={500} />
                        <button type="submit">Record resolution</button>
                      </form>
                    </details>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
