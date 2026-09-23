import type { listCaseNotifications, getNotificationPreview } from '@exit/db';
import {
  formatInstant,
  formatScheduledFor,
  isSendControlLevel,
  EMAIL_DISPLAY_LABELS,
  NOTIFICATION_STATUS_LABELS,
  type SendControlLevel,
} from '@exit/domain';
import { Activity, Event, SectionHead } from '@/components/patterns';
import { MailIcon } from '@/components/icons';
import { EmailPreviewFrame } from '@/components/EmailPreviewFrame';
import { RevisionHistory } from '@/components/RevisionHistory';
import { humanize } from '@/lib/text';
import { RecipientPicker } from './RecipientPicker';
import {
  approveEmailAction,
  overrideAddressAction,
  overrideRecipientAction,
  prepareCorrectionAction,
  restoreAutoRecipientAction,
  updateNotificationContentAction,
} from './actions';

/**
 * One communication as a workspace (DEC-069 sections 9 to 12, 16 to 30, 43):
 * who it goes to and why, what it says, what it looks like, and what HR can
 * still do about each of those before it is sent. Afterwards it is a record.
 */
type EmailRecord = Awaited<ReturnType<typeof listCaseNotifications>>['records'][number];
type Preview = Awaited<ReturnType<typeof getNotificationPreview>>;

/**
 * The platform's existing status words stay on the badge (directive section
 * 36: existing terminology where an equivalent state exists); the directive's
 * five words describe the same state in the line beneath.
 */
const BADGE: Readonly<Record<string, string>> = {
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

const CONTROL_HINT: Readonly<Record<SendControlLevel, string>> = {
  AUTO_SEND: 'Sends automatically once everything it needs is in place.',
  HR_REVIEW_THEN_SEND: 'Needs your review before it is sent.',
  HR_MANAGER_APPROVAL_REQUIRED: 'Needs your review before it is sent.',
};

export function EmailCard({
  caseId,
  typeLabel,
  r,
  preview,
  canRelease,
  canUpdateStored,
  children,
}: {
  caseId: string;
  typeLabel: string;
  r: EmailRecord;
  preview: Preview | null;
  canRelease: boolean;
  /** May update a configured recipient's stored address (directory authority). */
  canUpdateStored: boolean;
  /** The legacy manual-handling block and evidence forms, unchanged. */
  children?: React.ReactNode;
}) {
  const live = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'READY_FOR_MANUAL_SEND'].includes(
    r.status,
  );
  const sent = r.displayStatus === 'SENT';
  const rec = r.recipient;
  const configured = !!r.recipientConfigId;
  const toneOf = sent
    ? 'done'
    : r.displayStatus === 'FAILED'
      ? 'critical'
      : rec.unresolved
        ? 'attention'
        : 'progress';

  return (
    <section className="panel email-card" aria-label={`${typeLabel} email action`}>
      <SectionHead
        icon={<MailIcon />}
        tone={toneOf}
        title={typeLabel}
        description={r.subjectSnapshot ?? undefined}
        aside={
          <span className={`badge ${BADGE[r.status] ?? 'badge--neutral'}`}>
            {NOTIFICATION_STATUS_LABELS[r.status] ?? r.status}
          </span>
        }
      />
      <p className="meta">
        {EMAIL_DISPLAY_LABELS[r.displayStatus]}
        {live && isSendControlLevel(r.controlLevel) ? ` · ${CONTROL_HINT[r.controlLevel]}` : ''}
        {r.correctsRecordId ? ' · Corrected copy of an earlier message' : ''}
      </p>

      {/* --- To: the hierarchy's answer, any override, and the controls --- */}
      <div
        className="recipient"
        data-override={rec.overrideKind ?? 'none'}
        data-unresolved={rec.unresolved ? 'yes' : 'no'}
      >
        <div className="recipient__to">
          <span className="label">To</span>
          {rec.unresolved ? (
            <span className="badge badge--danger">Recipient not resolved</span>
          ) : (
            <>
              <span className="value">{rec.to.name ?? 'Recipient'}</span>
              <span className="meta">{rec.to.address ?? rec.to.mask}</span>
            </>
          )}
        </div>
        <p className="recipient__source meta">
          {rec.overrideKind ? (
            <>
              <span className="badge badge--warning">
                {rec.overrideKind === 'RECIPIENT'
                  ? 'Recipient overridden'
                  : rec.overrideKind === 'ADDRESS'
                    ? 'Email address changed'
                    : 'Manual recipient'}
              </span>{' '}
              {rec.auto ? (
                <>
                  Auto-assigned: {rec.auto.name ?? rec.auto.mask ?? 'not resolved'}
                  {rec.auto.mask && rec.auto.name ? ` (${rec.auto.mask})` : ''} · {rec.auto.source}
                </>
              ) : (
                'No auto-assignment was available.'
              )}
            </>
          ) : rec.auto ? (
            rec.auto.source
          ) : (
            rec.headline
          )}
        </p>
        {r.ccNames.length > 0 ? (
          <p className="meta">
            Copied:{' '}
            {r.ccNames
              .map((name, i) => `${name || 'Recipient'}${r.ccMasks[i] ? ` (${r.ccMasks[i]})` : ''}`)
              .join('; ')}
          </p>
        ) : null}
        {sent && r.deliveredToMask ? (
          <p className="meta">
            Delivered to {r.deliveredToMask}
            {r.rehearsal ? ' (rehearsal mailbox)' : ''}
          </p>
        ) : null}

        {r.recipientEditable ? (
          <div className="actions-row recipient__actions">
            <details className="action">
              <summary>{rec.unresolved ? 'Choose recipient' : 'Change recipient'}</summary>
              <RecipientPicker caseId={caseId} recordId={r.id} action={overrideRecipientAction} />
            </details>
            {!rec.unresolved ? (
              <details className="action">
                <summary>Change email</summary>
                <form action={overrideAddressAction} className="stack">
                  <input type="hidden" name="caseId" value={caseId} />
                  <input type="hidden" name="recordId" value={r.id} />
                  <p className="hint">
                    Keep <strong>{rec.to.name ?? 'the recipient'}</strong> and send this message to
                    a different address.
                  </p>
                  <label className="field">
                    <span className="field__label">Send this email to</span>
                    <input type="email" name="email" className="input" maxLength={254} required />
                  </label>
                  <fieldset className="field">
                    <legend className="field__label">Change email address</legend>
                    <label className="check">
                      <input type="radio" name="scope" value="message" defaultChecked /> Use for
                      this email only
                    </label>
                    {configured && canUpdateStored ? (
                      <label className="check">
                        <input type="radio" name="scope" value="stored" /> Update stored recipient
                        email (goes through recipient approval and verification)
                      </label>
                    ) : (
                      <p className="hint">
                        {configured
                          ? 'Updating the stored recipient address needs recipient-directory authority.'
                          : 'This address comes from the employee directory (read-only). Correct it there; the change here applies to this message only.'}
                      </p>
                    )}
                  </fieldset>
                  <label className="field">
                    <span className="field__label">Reason (optional)</span>
                    <input type="text" name="reason" className="input" maxLength={300} />
                  </label>
                  <button type="submit" className="secondary">
                    Change email address
                  </button>
                </form>
              </details>
            ) : null}
            {rec.overrideKind ? (
              <form action={restoreAutoRecipientAction}>
                <input type="hidden" name="caseId" value={caseId} />
                <input type="hidden" name="recordId" value={r.id} />
                <button type="submit" className="secondary compact">
                  Restore auto-assigned recipient
                </button>
              </form>
            ) : null}
          </div>
        ) : null}
      </div>

      {r.attachedDocument ? (
        <p className="hint">
          Attached: {humanize(r.attachedDocument.documentType)} v{r.attachedDocument.version}{' '}
          <span className="meta">
            checksum {r.attachedDocument.pdfChecksum?.slice(0, 12) ?? '-'}
          </span>
        </p>
      ) : null}

      {/* --- the message: edit, preview, PDF ------------------------------ */}
      <div className="actions-row email-card__tools">
        {preview ? (
          <details className="action">
            <summary>Preview</summary>
            <div className="email-preview-head">
              <p className="meta">
                <strong>To:</strong> {preview.to.name ? `${preview.to.name} ` : ''}
                {preview.to.address}
                {preview.cc.length ? (
                  <>
                    {' '}
                    · <strong>Cc:</strong> {preview.cc.join('; ')}
                  </>
                ) : null}
                {preview.bcc.length ? (
                  <>
                    {' '}
                    · <strong>Bcc:</strong> {preview.bcc.join('; ')}
                  </>
                ) : null}
              </p>
              <p className="meta">
                <strong>Subject:</strong> {preview.subject} · <strong>From:</strong>{' '}
                {preview.sender}
                {preview.attachments.length ? (
                  <>
                    {' '}
                    · <strong>Attachments:</strong> {preview.attachments.join('; ')}
                  </>
                ) : null}
                {preview.bannerKind
                  ? ` · Banner: ${preview.bannerKind.toLowerCase()}`
                  : ' · No banner'}
              </p>
            </div>
            <div className="email-preview" data-email-preview>
              <EmailPreviewFrame html={preview.html} title={`Email preview: ${preview.subject}`} />
            </div>
          </details>
        ) : null}
        <a
          className="button secondary compact"
          href={`/api/notifications/${r.id}/pdf`}
          target="_blank"
          rel="noreferrer"
        >
          {sent ? 'Download email record PDF' : 'Download preview PDF'}
        </a>
      </div>

      {r.contentEditable ? (
        <details className="action">
          <summary>Edit email</summary>
          <form action={updateNotificationContentAction} className="stack email-editor">
            <input type="hidden" name="caseId" value={caseId} />
            <input type="hidden" name="recordId" value={r.id} />
            <label className="field">
              <span className="field__label">Subject</span>
              <input
                type="text"
                name="subject"
                className="input"
                defaultValue={r.subjectSnapshot ?? ''}
                maxLength={300}
                required
              />
            </label>
            <label className="field">
              <span className="field__label">Message</span>
              <textarea
                name="body"
                className="input"
                rows={14}
                defaultValue={r.bodySnapshot ?? ''}
                required
              />
              <span className="hint">
                Plain text. Blank lines separate paragraphs. Keep any line that says a link is
                inserted at send time.
              </span>
            </label>
            <label className="field">
              <span className="field__label">
                Additional HR note (optional, sent with the message)
              </span>
              <textarea
                name="hrNote"
                className="input"
                rows={3}
                defaultValue={r.hrNote ?? ''}
                maxLength={2000}
              />
            </label>
            <div className="actions-row">
              <button type="submit">Save email</button>
              <span className="meta">Each save is kept as a version.</span>
            </div>
          </form>
        </details>
      ) : null}

      {sent && canRelease ? (
        <details className="action">
          <summary>Prepare corrected copy</summary>
          <form action={prepareCorrectionAction} className="stack">
            <input type="hidden" name="caseId" value={caseId} />
            <input type="hidden" name="recordId" value={r.id} />
            <p className="hint">
              A sent message is never changed. This prepares a new message from it that you edit and
              release; both stay on the case.
            </p>
            <label className="field">
              <span className="field__label">Reason</span>
              <input type="text" name="reason" className="input" maxLength={300} required />
            </label>
            <button type="submit" className="secondary">
              Prepare corrected copy
            </button>
          </form>
        </details>
      ) : null}

      <div className="well" style={{ marginTop: 'var(--space-3)' }}>
        <Activity label={`${typeLabel} delivery history`}>
          <Event time={formatInstant(r.createdAt)} title="Prepared" />
          {r.editedAt ? (
            <Event time={formatInstant(r.editedAt)} title="Edited before sending" />
          ) : null}
          {r.recipientOverrideAt ? (
            <Event time={formatInstant(r.recipientOverrideAt)} title="Recipient adjusted by HR" />
          ) : null}
          {r.scheduledSendAt && !r.sentAt ? (
            <Event
              time={formatScheduledFor(r.scheduledSendAt)}
              title="Scheduled to send"
              tone="auto"
            />
          ) : null}
          {r.sentAt ? <Event time={formatInstant(r.sentAt)} title="Sent" tone="done" /> : null}
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

      <RevisionHistory revisions={r.revisions} title="Message versions" />

      {r.status === 'PENDING_APPROVAL' && canRelease ? (
        <form action={approveEmailAction} style={{ display: 'inline-block' }}>
          <input type="hidden" name="caseId" value={caseId} />
          <input type="hidden" name="recordId" value={r.id} />
          <button type="submit" disabled={rec.unresolved}>
            {rec.unresolved ? 'Choose a recipient to send' : 'Send'}
          </button>
        </form>
      ) : null}

      {children}
    </section>
  );
}
