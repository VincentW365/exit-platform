import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ServiceError, getNotificationPreview, listCaseNotifications } from '@exit/db';
import {
  can,
  formatInstant,
  EVIDENCE_CHANNELS,
  MANUAL_SEND_METHODS,
  NOTIFICATION_TYPES,
  type EvidenceChannel,
  type NotificationType,
} from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { CaseTitle, Feedback } from '@/components/ui';
import { CaseNav } from '../CaseNav';
import { EmailCard } from './EmailCard';
import {
  captureDevAction,
  notificationTransitionAction,
  prepareNotificationAction,
  recordEvidenceAction,
} from './actions';

export const metadata: Metadata = { title: 'Email Actions' };
export const dynamic = 'force-dynamic';

/** Business-language type labels (Directive 6.3 correction 7): never enum names. */
const TYPE_LABELS: Readonly<Record<NotificationType, string>> = {
  IT_ACCESS_REMOVAL: 'IT access removal',
  FINANCE_OFFBOARDING: 'Finance offboarding',
  LINE_MANAGER_HANDOVER: 'Line manager departure notice',
  RETURN_ITEMS_CHECKLIST: 'Exit checklist for return items',
  RESIGNATION_ACCEPTANCE_LETTER: 'Resignation acceptance letter',
  SAGICOR_GROUP_HEALTH_REMOVAL: 'Sagicor group health removal',
  NCB_GROUP_LIFE_REMOVAL: 'NCB group life removal',
  SURVEY_INVITATION_REFERENCE: 'Exit survey invitation',
  SIGNATURE_REQUEST: 'Signature request',
  MANUAL_EXCEPTION_NOTIFICATION: 'Manual exception notice',
  PAYROLL_OR_BANK_NOTIFICATION: 'Payroll or bank notification',
  OTHER_EXTERNAL_OFFBOARDING_NOTIFICATION: 'Other external provider notification',
};

const EVIDENCE_CHANNEL_LABELS: Readonly<Record<EvidenceChannel, string>> = {
  EMAIL: 'Email reply',
  PHONE: 'Phone call',
  OTHER: 'Other channel',
};

const LIVE_STATUSES: readonly string[] = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'READY_FOR_MANUAL_SEND',
];

/**
 * The case's communications as a workspace (DEC-069): each message shows who
 * it goes to and why, what it says, what it looks like, and what HR can still
 * do before it is sent. Automation prepares and addresses everything first;
 * HR intervenes only where necessary, and every intervention is audited.
 */
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
          <h1>Access Restricted</h1>
          <p className="panel">This area requires full case access.</p>
        </>
      );
    throw e;
  }

  // The rendered preview of every message, as the recipient will see it.
  const previews = new Map<string, Awaited<ReturnType<typeof getNotificationPreview>>>();
  await Promise.all(
    data.records.map(async (r) => {
      try {
        previews.set(r.id, await getNotificationPreview(actor, r.id));
      } catch {
        // A preview that cannot be built is not a reason to hide the record.
      }
    }),
  );

  const canHrAct = data.canApproveInternal;
  const canUpdateStored = can(actor, 'recipients.editTechnical');

  return (
    <>
      <CaseTitle title="Email Actions" caseNumber={data.caseNumber} />
      <CaseNav caseId={id} active="notifications" />
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint" role="note">
        Routine notifications are prepared and addressed automatically from the business hierarchy.
        Review, edit or re-address a message before it is sent; once sent, it is a record and a
        correction is a new message.
      </p>

      {data.records.length === 0 ? (
        <p className="panel">
          No email actions exist for this case yet. They are prepared automatically when the case
          becomes active.
        </p>
      ) : null}

      {data.records.map((r) => {
        const typeLabel = TYPE_LABELS[r.notificationType] ?? 'Notification';
        const live = LIVE_STATUSES.includes(r.status);
        return (
          <EmailCard
            key={r.id}
            caseId={id}
            typeLabel={typeLabel}
            r={r}
            preview={previews.get(r.id) ?? null}
            canRelease={canHrAct}
            canUpdateStored={canUpdateStored}
          >
            {(r.status === 'SENT' || r.status === 'ACKNOWLEDGED') && canHrAct ? (
              <details className="action">
                <summary>Record evidence</summary>
                <form action={recordEvidenceAction} className="stack">
                  <input type="hidden" name="caseId" value={id} />
                  <input type="hidden" name="recordId" value={r.id} />
                  <div className="field">
                    <label htmlFor={`ek-${r.id}`}>What Is Being Recorded?</label>
                    <select
                      id={`ek-${r.id}`}
                      name="kind"
                      required
                      defaultValue={r.status === 'ACKNOWLEDGED' ? 'COMPLETED' : ''}
                    >
                      <option value="" disabled>
                        Choose...
                      </option>
                      {r.status === 'SENT' ? (
                        <option value="ACKNOWLEDGED">Receipt was acknowledged</option>
                      ) : null}
                      <option value="COMPLETED">The action is completed</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`ec-${r.id}`}>How Was It Confirmed?</label>
                    <select id={`ec-${r.id}`} name="channel" required defaultValue="EMAIL">
                      {EVIDENCE_CHANNELS.map((c) => (
                        <option key={c} value={c}>
                          {EVIDENCE_CHANNEL_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor={`en-${r.id}`}>Evidence Note (Required)</label>
                    <textarea id={`en-${r.id}`} name="note" required rows={3} maxLength={1000} />
                  </div>
                  <button type="submit">Record evidence</button>
                </form>
              </details>
            ) : null}

            {r.origin === 'MANUAL' ? (
              <details className="action">
                <summary>Manual handling (legacy)</summary>
                {r.captures.length > 0 ? (
                  <p className="hint">
                    Development capture copies: {r.captures.length} (no real email was sent) -
                    latest {formatInstant(r.captures[r.captures.length - 1]!.capturedAt)}
                  </p>
                ) : null}
                {r.status === 'DRAFT' && data.canPrepare ? (
                  <form action={notificationTransitionAction} style={{ display: 'inline-block' }}>
                    <input type="hidden" name="caseId" value={id} />
                    <input type="hidden" name="recordId" value={r.id} />
                    <input type="hidden" name="action" value="submit" />
                    <button type="submit">Submit for review</button>
                  </form>
                ) : null}
                {r.status === 'PENDING_APPROVAL' && canHrAct ? (
                  <details className="action" style={{ display: 'inline-block' }}>
                    <summary>Return for correction</summary>
                    <form action={notificationTransitionAction}>
                      <input type="hidden" name="caseId" value={id} />
                      <input type="hidden" name="recordId" value={r.id} />
                      <input type="hidden" name="action" value="return" />
                      <label htmlFor={`ret-${r.id}`}>Reason (Required)</label>
                      <textarea
                        id={`ret-${r.id}`}
                        name="reason"
                        required
                        rows={2}
                        maxLength={500}
                      />
                      <button type="submit">Return</button>
                    </form>
                  </details>
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
                        Approved Destination Reference (NEVER a Personal Address)
                      </label>
                      <input id={`d-${r.id}`} name="destinationRef" required maxLength={200} />
                      <label htmlFor={`sn-${r.id}`}>Safe Note (Optional)</label>
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
                {live && data.canPrepare ? (
                  <details className="action">
                    <summary>Cancel</summary>
                    <form action={notificationTransitionAction}>
                      <input type="hidden" name="caseId" value={id} />
                      <input type="hidden" name="recordId" value={r.id} />
                      <input type="hidden" name="action" value="cancel" />
                      <label htmlFor={`c-${r.id}`}>Reason (Required)</label>
                      <textarea id={`c-${r.id}`} name="reason" required rows={2} maxLength={500} />
                      <button type="submit">Cancel notification</button>
                    </form>
                  </details>
                ) : null}
              </details>
            ) : null}
          </EmailCard>
        );
      })}

      {data.canPrepare ? (
        <details className="action">
          <summary>Prepare a manual notification (exceptional)</summary>
          <p className="hint">
            Only for situations the automatic preparation does not cover. External provider notices
            require a recorded applicability confirmation.
          </p>
          <form action={prepareNotificationAction} className="stack">
            <input type="hidden" name="caseId" value={id} />
            <div className="field">
              <label htmlFor="n-type">Notification</label>
              <select id="n-type" name="notificationType" required defaultValue="">
                <option value="" disabled>
                  Choose...
                </option>
                {NOTIFICATION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="n-applic">
                Applicability Confirmation (Required for External Provider Notices)
              </label>
              <textarea id="n-applic" name="applicabilityNote" rows={2} maxLength={500} />
            </div>
            <div className="field">
              <label htmlFor="n-manual">
                Manual Note (Used Only by the Manual Exception Notice)
              </label>
              <textarea id="n-manual" name="manualNote" rows={2} maxLength={1000} />
            </div>
            <button type="submit">Prepare draft</button>
          </form>
        </details>
      ) : null}
    </>
  );
}
