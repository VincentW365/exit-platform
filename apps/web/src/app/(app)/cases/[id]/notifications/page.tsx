import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ServiceError, listCaseNotifications } from '@exit/db';
import {
  formatInstant,
  formatScheduledFor,
  isSendControlLevel,
  EVIDENCE_CHANNELS,
  MANUAL_SEND_METHODS,
  NOTIFICATION_STATUS_LABELS,
  NOTIFICATION_TYPES,
  type EvidenceChannel,
  type NotificationStatus,
  type NotificationType,
  type SendControlLevel,
} from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { humanize } from '@/lib/text';
import { Activity, Event, SectionHead } from '@/components/patterns';
import { MailIcon } from '@/components/icons';
import { CaseTitle, Feedback } from '@/components/ui';
import { CaseNav } from '../CaseNav';
import {
  approveEmailAction,
  captureDevAction,
  notificationTransitionAction,
  prepareNotificationAction,
  recordEvidenceAction,
  setCaseRecipientAction,
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

const BADGE: Readonly<Record<NotificationStatus, string>> = {
  DRAFT: 'badge--neutral',
  PENDING_APPROVAL: 'badge--warning',
  APPROVED: 'badge--info',
  READY_FOR_MANUAL_SEND: 'badge--info',
  MANUALLY_SENT: 'badge--success',
  CANCELLED: 'badge--neutral',
  FAILED: 'badge--danger',
  SUPERSEDED: 'badge--neutral',
  SENT: 'badge--info',
  ACKNOWLEDGED: 'badge--success',
  CONFIRMED_COMPLETE: 'badge--success',
};

/** Prose only - the control-level enum never appears in HR-facing copy. */
const CONTROL_HINT: Readonly<Record<SendControlLevel, string>> = {
  AUTO_SEND: 'Sends automatically once everything it needs is in place.',
  HR_REVIEW_THEN_SEND: 'Needs your review before it is sent.',
  // Legacy level (DEC-066): released by the HR person executing the case.
  HR_MANAGER_APPROVAL_REQUIRED: 'Needs your review before it is sent.',
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

  // notification.enterRecipient and notification.recordEvidence share the
  // ordinary HR case-work gate that canApproveInternal reflects; the service
  // enforces the exact permission on every submit.
  const canHrAct = data.canApproveInternal;

  return (
    <>
      <CaseTitle title="Email Actions" caseNumber={data.caseNumber} />
      <CaseNav caseId={id} active="notifications" />
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint" role="note">
        Routine notifications are prepared and sent automatically. You only need to act on items
        marked &lsquo;Needs your review&rsquo; or &lsquo;Recipient required&rsquo;.
      </p>

      {data.records.length === 0 ? (
        <p className="panel">
          No email actions exist for this case yet. They are prepared automatically when the case
          becomes active.
        </p>
      ) : null}

      {data.records.map((r) => {
        const typeLabel = TYPE_LABELS[r.notificationType] ?? 'Notification';
        const recipientMissing = !r.recipientConfigId && !r.caseRecipientMask;
        const live = LIVE_STATUSES.includes(r.status);
        // Who may release a waiting item (DEC-066): the HR person executing
        // the approved case - the assigned HR Officer or the HR Manager. The
        // case approval already covered every recipient the plan showed, so
        // no recipient class or control level asks for a second approver.
        const canRelease = data.canApproveInternal;

        const recipientDisplay = (() => {
          const who = [r.recipientName, r.recipientOrg].filter(Boolean).join(', ');
          if (r.caseRecipientMask)
            return `${who || 'Recipient entered on this case'} - ${r.caseRecipientMask}`;
          if (r.recipientConfigId)
            return who ? `${who} (approved directory recipient)` : '(approved directory recipient)';
          return null;
        })();

        return (
          <section className="panel" key={r.id} aria-label={`${typeLabel} email action`}>
            {/* A communication reads as a message: who it goes to, what it
                says, and where it got to - not as a database record. */}
            <SectionHead
              icon={<MailIcon />}
              tone={
                ['ACKNOWLEDGED', 'CONFIRMED_COMPLETE', 'SENT', 'MANUALLY_SENT'].includes(r.status)
                  ? 'done'
                  : r.status === 'FAILED'
                    ? 'critical'
                    : 'progress'
              }
              title={typeLabel}
              description={recipientDisplay ? `To ${recipientDisplay}` : undefined}
              aside={
                <span className={`badge ${BADGE[r.status] ?? 'badge--neutral'}`}>
                  {NOTIFICATION_STATUS_LABELS[r.status] ?? r.status}
                </span>
              }
            />
            {r.subjectSnapshot ? (
              <p className="value" style={{ marginTop: 0 }}>
                {r.subjectSnapshot}
              </p>
            ) : null}
            {live && isSendControlLevel(r.controlLevel) ? (
              <p className="hint">{CONTROL_HINT[r.controlLevel]}</p>
            ) : null}
            {r.ccNames.length > 0 ? (
              <p className="hint">
                Copied:{' '}
                {r.ccNames
                  .map(
                    (name, i) =>
                      `${name || 'Recipient'}${r.ccMasks[i] ? ` (${r.ccMasks[i]})` : ''}`,
                  )
                  .join('; ')}
              </p>
            ) : null}
            {r.attachedDocument ? (
              <p className="hint">
                Attached: {humanize(r.attachedDocument.documentType)} v{r.attachedDocument.version}{' '}
                <span className="meta">
                  checksum {r.attachedDocument.pdfChecksum?.slice(0, 12) ?? '-'}
                </span>
              </p>
            ) : null}
            <div className="well" style={{ marginTop: 'var(--space-3)' }}>
              <Activity label={`${typeLabel} delivery history`}>
                <Event time={formatInstant(r.createdAt)} title="Prepared" />
                {r.scheduledSendAt && !r.sentAt ? (
                  <Event
                    time={formatScheduledFor(r.scheduledSendAt)}
                    title="Scheduled to send"
                    tone="auto"
                  />
                ) : null}
                {r.sentAt ? (
                  <Event time={formatInstant(r.sentAt)} title="Sent" tone="done" />
                ) : null}
                {r.manualSentAt ? (
                  <Event time={formatInstant(r.manualSentAt)} title="Sent by hand" tone="done" />
                ) : null}
                {r.acknowledgedAt ? (
                  <Event
                    time={formatInstant(r.acknowledgedAt)}
                    title="Acknowledged by the recipient"
                    tone="done"
                  />
                ) : null}
                {r.completionConfirmedAt ? (
                  <Event
                    time={formatInstant(r.completionConfirmedAt)}
                    title="Confirmed complete"
                    detail={r.completionEvidenceNote ?? undefined}
                    tone="done"
                  />
                ) : null}
              </Activity>
            </div>

            <details>
              <summary>Preview content</summary>
              <p>
                <strong>Subject:</strong> {r.subjectSnapshot}
              </p>
              <pre style={{ whiteSpace: 'pre-wrap' }}>{r.bodySnapshot}</pre>
            </details>

            {recipientMissing && live && canHrAct ? (
              <div
                className="panel"
                style={{ borderLeft: '4px solid var(--danger, #b00020)', marginTop: '0.75rem' }}
              >
                <h3 style={{ marginTop: 0, fontSize: '1rem' }}>
                  <span className="badge badge--danger">Recipient Required</span>
                </h3>
                <p className="hint">
                  No approved recipient is configured for this email. Enter one for this case;
                  optionally save it as an approved recipient for future cases (approval and
                  verification still apply). Development recipients must use a reserved{' '}
                  <code>.test</code> or <code>.invalid</code> domain, <code>@localhost</code>, or a{' '}
                  <code>capture://</code> channel.
                </p>
                <form action={setCaseRecipientAction} className="stack">
                  <input type="hidden" name="caseId" value={id} />
                  <input type="hidden" name="recordId" value={r.id} />
                  <div className="field">
                    <label htmlFor={`rn-${r.id}`}>Recipient Name</label>
                    <input id={`rn-${r.id}`} name="recipientName" required maxLength={200} />
                  </div>
                  <div className="field">
                    <label htmlFor={`ro-${r.id}`}>Organization</label>
                    <input id={`ro-${r.id}`} name="organization" required maxLength={200} />
                  </div>
                  <div className="field">
                    <label htmlFor={`re-${r.id}`}>Email Address</label>
                    <input id={`re-${r.id}`} name="email" type="email" required maxLength={320} />
                  </div>
                  <label>
                    <input type="checkbox" name="saveForFuture" /> Save as Approved Recipient for
                    Future Cases
                  </label>
                  <button type="submit">Save recipient</button>
                </form>
              </div>
            ) : null}

            {r.status === 'PENDING_APPROVAL' && canRelease ? (
              <form action={approveEmailAction} style={{ display: 'inline-block' }}>
                <input type="hidden" name="caseId" value={id} />
                <input type="hidden" name="recordId" value={r.id} />
                <button type="submit">Review and release</button>
              </form>
            ) : null}

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
                {r.status === 'PENDING_APPROVAL' && canRelease ? (
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
          </section>
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
