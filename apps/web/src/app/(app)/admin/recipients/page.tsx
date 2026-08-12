import type { Metadata } from 'next';
import { ServiceError, listRecipients } from '@exit/db';
import { can, formatInstant, NOTIFICATION_TYPES, RECIPIENT_CLASSES } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import {
  approveRecipientAction,
  suspendRecipientAction,
  upsertRecipientAction,
  verifyRecipientAction,
} from './actions';

export const metadata: Metadata = { title: 'Recipient directory' };
export const dynamic = 'force-dynamic';

export default async function RecipientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const sp = await searchParams;
  let recipients: Awaited<ReturnType<typeof listRecipients>>;
  try {
    recipients = await listRecipients(actor);
  } catch (e) {
    if (e instanceof ServiceError)
      return (
        <>
          <h1>Access restricted</h1>
          <p className="panel">The recipient directory requires an authorized role.</p>
        </>
      );
    throw e;
  }
  const canEdit = can(actor, 'recipients.editBusiness') || can(actor, 'recipients.editTechnical');

  return (
    <>
      <h1>Notification recipient directory</h1>
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint" role="note">
        Destinations are encrypted at rest and shown MASKED. Development uses capture:// or
        @example.invalid destinations only; production rejects them. External recipient changes need
        HR Manager approval; no real address is ever seeded.
      </p>

      {recipients.length === 0 ? <p className="panel">No recipients configured.</p> : null}
      {recipients.map((r) => (
        <section className="panel" key={r.id} aria-label={`${r.recipientClass} recipient`}>
          <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>
            {r.displayName} <span className="badge badge--neutral">{r.recipientClass}</span>{' '}
            <span
              className={`badge ${
                r.approvalStatus === 'APPROVED'
                  ? 'badge--success'
                  : r.approvalStatus === 'SUSPENDED'
                    ? 'badge--danger'
                    : 'badge--warning'
              }`}
            >
              {r.approvalStatus}
            </span>{' '}
            {r.isExternal ? <span className="badge badge--warning">External</span> : null}
            {r.verifiedAt ? (
              <span className="badge badge--success"> Verified</span>
            ) : (
              <span className="badge badge--warning"> Unverified</span>
            )}
          </h2>
          <p className="hint">
            Destination (masked): <code>{r.destinationMask}</code> - environment {r.environment} -
            allowed types: {r.allowedTypes.join(', ')}
            {r.verifiedAt ? ` - verified ${formatInstant(r.verifiedAt)}` : ''}
            {r.changeReason ? ` - last change: ${r.changeReason}` : ''}
          </p>
          {canEdit && r.approvalStatus === 'PENDING_APPROVAL' ? (
            <form action={approveRecipientAction} style={{ display: 'inline-block' }}>
              <input type="hidden" name="id" value={r.id} />
              <button type="submit">Approve{r.isExternal ? ' (HR Manager required)' : ''}</button>
            </form>
          ) : null}{' '}
          {canEdit && r.approvalStatus === 'APPROVED' && !r.verifiedAt ? (
            <form action={verifyRecipientAction} style={{ display: 'inline-block' }}>
              <input type="hidden" name="id" value={r.id} />
              <button type="submit">Verify (dev capture probe)</button>
            </form>
          ) : null}{' '}
          {canEdit && r.approvalStatus !== 'SUSPENDED' ? (
            <details className="action" style={{ display: 'inline-block' }}>
              <summary>Suspend</summary>
              <form action={suspendRecipientAction}>
                <input type="hidden" name="id" value={r.id} />
                <label htmlFor={`sus-${r.id}`}>Reason (required, audited)</label>
                <input id={`sus-${r.id}`} name="reason" required maxLength={500} />
                <button type="submit">Suspend recipient</button>
              </form>
            </details>
          ) : null}
        </section>
      ))}

      {canEdit ? (
        <details className="action">
          <summary>Add or update a recipient configuration</summary>
          <form action={upsertRecipientAction}>
            <label htmlFor="r-class">Recipient class</label>
            <select id="r-class" name="recipientClass" required>
              {RECIPIENT_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <label htmlFor="r-name">Display name</label>
            <input id="r-name" name="displayName" required maxLength={200} />
            <label htmlFor="r-dest">
              Destination (development: capture://name or name@example.invalid ONLY)
            </label>
            <input id="r-dest" name="destination" required maxLength={320} />
            <fieldset>
              <legend>Allowed notification types</legend>
              {NOTIFICATION_TYPES.map((t) => (
                <label key={t} style={{ display: 'block' }}>
                  <input type="checkbox" name="allowedTypes" value={t} /> {t}
                </label>
              ))}
            </fieldset>
            <label htmlFor="r-reason">Change reason (required, audited)</label>
            <input id="r-reason" name="changeReason" required maxLength={500} />
            <button type="submit">Save recipient (resets approval + verification)</button>
          </form>
        </details>
      ) : null}
    </>
  );
}
