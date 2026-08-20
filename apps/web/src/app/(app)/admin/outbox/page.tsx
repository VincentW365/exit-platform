import type { Metadata } from 'next';
import { ServiceError, getTestMode, listOutbox } from '@exit/db';
import { can, formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import {
  cancelOutboxAction,
  resolveDeadLetterAction,
  retryOutboxAction,
  runOutboxNowAction,
  setTestModeAction,
} from './actions';
import { humanize } from '@/lib/text';
import { EmptyState } from '@/components/EmptyState';
import { MailIcon } from '@/components/icons';

export const metadata: Metadata = { title: 'Notification Outbox' };
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
      return (
        <>
          <h1>Access Restricted</h1>
          <p className="panel">The outbox monitor requires an authorized role.</p>
        </>
      );
    throw e;
  }
  const canResolve = can(actor, 'outbox.resolve');
  const canSetTestMode = can(actor, 'notifications.testMode');
  const testMode = await getTestMode(actor);

  return (
    <>
      <h1>Notification Outbox</h1>
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint" role="note">
        Transactional outbox: approved notifications are enqueued in the same database transaction
        and dispatched by the worker with bounded backoff. CAPTURED/SUBMITTED are provider
        acceptance - DELIVERED appears only with provider delivery evidence. Destinations are always
        masked.
      </p>
      {testMode.enabled ? (
        <p className="banner-restricted" role="status">
          Rehearsal mode is ON. Every outgoing message is being diverted to one mailbox and marked
          as a test - nothing is reaching its real recipients.
        </p>
      ) : null}

      {canSetTestMode ? (
        <details className="action" open={testMode.enabled}>
          <summary>
            Rehearsal mode {testMode.enabled ? '(currently ON)' : '(currently off)'}
          </summary>
          <form action={setTestModeAction} className="stack">
            <p className="hint">
              Walk the real workflow without a message reaching a real person. While this is on,
              every email goes to the mailbox below instead of its recipients, carries a &quot;TEST
              MODE&quot; subject marker, and states in its own body who it would have gone to.
              Templates, rules, timing, attachments and evidence are unchanged.
            </p>
            <div className="field">
              <label htmlFor="tm-to">Redirect Every Message To</label>
              <input
                id="tm-to"
                name="redirectTo"
                type="email"
                maxLength={200}
                defaultValue={testMode.redirectTo}
              />
            </div>
            <div className="field">
              <label htmlFor="tm-note">Note Shown in Redirected Messages</label>
              <input
                id="tm-note"
                name="note"
                type="text"
                maxLength={200}
                defaultValue={testMode.note ?? ''}
              />
            </div>
            <div className="actions-row">
              <button type="submit" name="enabled" value="on">
                Turn rehearsal mode on
              </button>
              <button type="submit" name="enabled" value="off" className="secondary">
                Turn it off
              </button>
            </div>
          </form>
        </details>
      ) : null}

      <form action={runOutboxNowAction} style={{ marginBottom: '1rem' }}>
        <button type="submit">Run outbox pass now</button>
      </form>

      {rows.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<MailIcon />}
            title="Nothing queued"
            body="Messages appear here while they wait to be sent, and stay for a while afterwards as delivery evidence."
          />
        </div>
      ) : null}
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
                  <span className={`badge ${BADGE[r.status] ?? 'badge--neutral'}`}>
                    {humanize(r.status)}
                  </span>
                  {r.deliveryStatus ? (
                    <span className="hint"> {humanize(r.deliveryStatus)}</span>
                  ) : null}
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
                        <label htmlFor={`rt-${r.id}`}>Reason (Audited)</label>
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
                        <label htmlFor={`rs-${r.id}`}>Resolution (Audited)</label>
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
