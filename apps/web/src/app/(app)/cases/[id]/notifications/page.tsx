import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ServiceError, listCaseNotifications } from '@exit/db';
import {
  formatInstant,
  requiresManagerApproval,
  APPLICABILITY_GATED_TYPES,
  MANUAL_SEND_METHODS,
  NOTIFICATION_TYPES,
} from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import { CaseNav } from '../CaseNav';
import {
  captureDevAction,
  notificationTransitionAction,
  prepareNotificationAction,
} from './actions';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

const BADGE: Record<string, string> = {
  DRAFT: 'badge--neutral',
  PENDING_APPROVAL: 'badge--warning',
  APPROVED: 'badge--info',
  READY_FOR_MANUAL_SEND: 'badge--info',
  MANUALLY_SENT: 'badge--success',
  CANCELLED: 'badge--neutral',
  FAILED: 'badge--danger',
  SUPERSEDED: 'badge--neutral',
};

export default async function CaseNotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const { id } = await params;
  const sp = await searchParams;

  let data: Awaited<ReturnType<typeof listCaseNotifications>>;
  try {
    data = await listCaseNotifications(actor, id);
  } catch (e) {
    if (e instanceof ServiceError && e.code === 'NOT_FOUND') notFound();
    if (e instanceof ServiceError && e.code === 'FORBIDDEN')
      return (
        <>
          <h1>Access restricted</h1>
          <p className="panel">This area requires full case access.</p>
        </>
      );
    throw e;
  }

  return (
    <>
      <h1>Notifications - {data.caseNumber}</h1>
      <CaseNav caseId={id} active="notifications" />
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint" role="note">
        No live email exists in this increment. Notifications are prepared from deterministic
        approved templates, approved by HR, and recorded as MANUALLY sent through approved channels.
        External providers (Sagicor / NCB) are never universally applicable.
      </p>

      {data.canPrepare ? (
        <details className="action">
          <summary>Prepare a notification</summary>
          <form action={prepareNotificationAction}>
            <input type="hidden" name="caseId" value={id} />
            <label htmlFor="n-type">Notification type</label>
            <select id="n-type" name="notificationType" required>
              {NOTIFICATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <label htmlFor="n-applic">
              Applicability confirmation (REQUIRED for Sagicor / NCB external notices)
            </label>
            <textarea id="n-applic" name="applicabilityNote" rows={2} maxLength={500} />
            <label htmlFor="n-manual">
              Manual note (used only by the manual-exception notification)
            </label>
            <textarea id="n-manual" name="manualNote" rows={2} maxLength={1000} />
            <button type="submit">Prepare draft</button>
          </form>
        </details>
      ) : null}

      {data.records.length === 0 ? (
        <p className="panel">No notification records exist for this case.</p>
      ) : null}

      {data.records.map((r) => {
        const managerNeeded = requiresManagerApproval(r.recipientClass);
        const canApprove = managerNeeded ? data.canApproveExternal : data.canApproveInternal;
        return (
          <section className="panel" key={r.id} aria-label={`${r.notificationType} notification`}>
            <h2 style={{ marginTop: 0 }}>
              {r.notificationType}{' '}
              <span className={`badge ${BADGE[r.status] ?? 'badge--neutral'}`}>{r.status}</span>{' '}
              <span className="badge badge--neutral">{r.recipientClass}</span>
            </h2>
            <p className="hint">
              Template v{r.templateVersion} - checksum{' '}
              <code>{r.contentChecksum?.slice(0, 12) ?? '-'}...</code> - created{' '}
              {formatInstant(r.createdAt)}
              {r.approvedAt ? ` - approved ${formatInstant(r.approvedAt)}` : ''}
              {r.manualSentAt
                ? ` - manually sent ${formatInstant(r.manualSentAt)} via ${r.sentMethod} to ${r.destinationRef}`
                : ''}
              {r.applicabilityNote ? ` - applicability: ${r.applicabilityNote}` : ''}
              {r.supersededReason ? ` - superseded: ${r.supersededReason}` : ''}
            </p>
            {APPLICABILITY_GATED_TYPES.includes(r.notificationType) ? (
              <p className="hint">
                External provider notice: contains name, employee reference and effective date ONLY.
              </p>
            ) : null}
            <details>
              <summary>Preview content</summary>
              <p>
                <strong>Subject:</strong> {r.subjectSnapshot}
              </p>
              <pre style={{ whiteSpace: 'pre-wrap' }}>{r.bodySnapshot}</pre>
            </details>
            {r.captures.length > 0 ? (
              <p className="hint">
                Development captures: {r.captures.length} (NOT deliveries) - latest{' '}
                {formatInstant(r.captures[r.captures.length - 1]!.capturedAt)}
              </p>
            ) : null}

            {r.status === 'DRAFT' && data.canPrepare ? (
              <form action={notificationTransitionAction} style={{ display: 'inline-block' }}>
                <input type="hidden" name="caseId" value={id} />
                <input type="hidden" name="recordId" value={r.id} />
                <input type="hidden" name="action" value="submit" />
                <button type="submit">Submit for approval</button>
              </form>
            ) : null}
            {r.status === 'PENDING_APPROVAL' && canApprove ? (
              <>
                <form action={notificationTransitionAction} style={{ display: 'inline-block' }}>
                  <input type="hidden" name="caseId" value={id} />
                  <input type="hidden" name="recordId" value={r.id} />
                  <input type="hidden" name="action" value="approve" />
                  <button type="submit">
                    Approve{managerNeeded ? ' (HR Manager authority)' : ''}
                  </button>
                </form>{' '}
                <details className="action" style={{ display: 'inline-block' }}>
                  <summary>Return to draft</summary>
                  <form action={notificationTransitionAction}>
                    <input type="hidden" name="caseId" value={id} />
                    <input type="hidden" name="recordId" value={r.id} />
                    <input type="hidden" name="action" value="return" />
                    <label htmlFor={`ret-${r.id}`}>Reason (required)</label>
                    <textarea id={`ret-${r.id}`} name="reason" required rows={2} maxLength={500} />
                    <button type="submit">Return</button>
                  </form>
                </details>
              </>
            ) : null}
            {r.status === 'APPROVED' && data.canRecordSend ? (
              <form action={notificationTransitionAction} style={{ display: 'inline-block' }}>
                <input type="hidden" name="caseId" value={id} />
                <input type="hidden" name="recordId" value={r.id} />
                <input type="hidden" name="action" value="markReady" />
                <button type="submit">Mark ready for manual send</button>
              </form>
            ) : null}
            {r.status === 'READY_FOR_MANUAL_SEND' && data.canRecordSend ? (
              <details className="action" open>
                <summary>Record manual send</summary>
                <form action={notificationTransitionAction}>
                  <input type="hidden" name="caseId" value={id} />
                  <input type="hidden" name="recordId" value={r.id} />
                  <input type="hidden" name="action" value="recordManualSend" />
                  <label htmlFor={`m-${r.id}`}>Method</label>
                  <select id={`m-${r.id}`} name="method" required>
                    {MANUAL_SEND_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <label htmlFor={`d-${r.id}`}>
                    Approved destination reference (NEVER a personal address)
                  </label>
                  <input id={`d-${r.id}`} name="destinationRef" required maxLength={200} />
                  <label htmlFor={`sn-${r.id}`}>Safe note (optional)</label>
                  <input id={`sn-${r.id}`} name="sentNote" maxLength={500} />
                  <button type="submit">Record manual send</button>
                </form>
              </details>
            ) : null}
            {(r.status === 'APPROVED' || r.status === 'READY_FOR_MANUAL_SEND') &&
            data.recordPurpose !== 'OPERATIONAL' &&
            data.canRecordSend ? (
              <form action={captureDevAction} style={{ display: 'inline-block' }}>
                <input type="hidden" name="caseId" value={id} />
                <input type="hidden" name="recordId" value={r.id} />
                <button type="submit" className="secondary">
                  Capture via development adapter (not a delivery)
                </button>
              </form>
            ) : null}
            {['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'READY_FOR_MANUAL_SEND'].includes(
              r.status,
            ) && data.canPrepare ? (
              <details className="action">
                <summary>Cancel</summary>
                <form action={notificationTransitionAction}>
                  <input type="hidden" name="caseId" value={id} />
                  <input type="hidden" name="recordId" value={r.id} />
                  <input type="hidden" name="action" value="cancel" />
                  <label htmlFor={`c-${r.id}`}>Reason (required)</label>
                  <textarea id={`c-${r.id}`} name="reason" required rows={2} maxLength={500} />
                  <button type="submit">Cancel notification</button>
                </form>
              </details>
            ) : null}
          </section>
        );
      })}
    </>
  );
}
