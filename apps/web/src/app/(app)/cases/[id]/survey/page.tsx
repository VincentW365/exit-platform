import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ServiceError, getCaseSurvey, getInvitationResponse } from '@exit/db';
import { formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import { CaseNav } from '../CaseNav';
import {
  cancelInvitationAction,
  createInvitationAction,
  declinedAction,
  generateTokenAction,
  invalidContactAction,
  markSentAction,
  notEligibleAction,
  reminderAction,
} from './actions';

export const metadata: Metadata = { title: 'Exit survey' };
export const dynamic = 'force-dynamic';

const INV_BADGE: Record<string, string> = {
  PENDING: 'badge--neutral',
  MANUALLY_SENT: 'badge--info',
  COMPLETED: 'badge--success',
  DECLINED: 'badge--neutral',
  EXPIRED: 'badge--warning',
  CANCELLED: 'badge--neutral',
  INVALID_CONTACT: 'badge--warning',
  NOT_ELIGIBLE: 'badge--neutral',
};

export default async function CaseSurveyPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const { id } = await params;
  const sp = await searchParams;

  let data: Awaited<ReturnType<typeof getCaseSurvey>>;
  try {
    data = await getCaseSurvey(actor, id);
  } catch (e) {
    if (e instanceof ServiceError && e.code === 'NOT_FOUND') notFound();
    if (e instanceof ServiceError && e.code === 'FORBIDDEN')
      return (
        <>
          <h1>Access restricted</h1>
          <p className="panel">This area requires explicit case assignment.</p>
        </>
      );
    throw e;
  }

  const current = data.invitations[0] ?? null;
  const response =
    current && current.status === 'COMPLETED' && data.capabilities.canViewResponses
      ? await getInvitationResponse(actor, current.id).catch(() => null)
      : null;

  return (
    <>
      <h1>Exit survey</h1>
      <CaseNav caseId={id} active="survey" />
      <Feedback err={sp.err} ok={sp.ok} />
      {sp.link ? (
        <section className="panel" aria-label="Generated invitation link">
          <h2 style={{ marginTop: 0 }}>Secure invitation link (shown once)</h2>
          <p>
            Copy this link and send it manually through an approved channel. The application does
            not send email.
          </p>
          <p>
            <code style={{ wordBreak: 'break-all' }}>{sp.link}</code>
          </p>
          <p className="hint">
            Only a cryptographic hash of the token is stored. If the link is lost, regenerate it -
            the old link stops working.
          </p>
        </section>
      ) : null}

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Eligibility</h2>
        <p>
          {data.eligibility.eligibleByDefault ? (
            <span className="badge badge--success">Eligible by default (resignation)</span>
          ) : (
            <span className="badge badge--warning">
              Termination: not eligible by default - HR Manager override required
            </span>
          )}
        </p>
        {data.capabilities.canManage && !current ? (
          <form action={createInvitationAction} className="stack" style={{ maxWidth: '34rem' }}>
            <input type="hidden" name="caseId" value={id} />
            {!data.eligibility.eligibleByDefault ? (
              <div className="field">
                <label htmlFor="ov-reason">HR Manager override reason (required, audited)</label>
                <textarea id="ov-reason" name="overrideReason" rows={2} maxLength={300} />
              </div>
            ) : null}
            <button type="submit">Create survey invitation</button>
          </form>
        ) : null}
      </section>

      {data.invitations.map((inv) => (
        <section key={inv.id} className="panel" aria-label={`Invitation ${inv.id.slice(0, 8)}`}>
          <h2 style={{ marginTop: 0 }}>
            {inv.template.title} v{inv.template.version}{' '}
            <span className={`badge ${INV_BADGE[inv.status]}`}>
              {inv.status.replaceAll('_', ' ')}
            </span>
            {inv.responseChannel ? (
              <span className="badge badge--info" style={{ marginLeft: '0.4rem' }}>
                {inv.responseChannel.replaceAll('_', ' ').toLowerCase()}
              </span>
            ) : null}
          </h2>
          <dl className="kv">
            <dt>Invitation due</dt>
            <dd>{formatInstant(inv.invitationDueAt)} (3 days after effective separation)</dd>
            <dt>Manually sent</dt>
            <dd>
              {inv.manualSentAt
                ? formatInstant(inv.manualSentAt)
                : 'not yet - no email is ever sent automatically'}
            </dd>
            {inv.reminder1DueAt ? (
              <>
                <dt>Reminder 1</dt>
                <dd>
                  due {formatInstant(inv.reminder1DueAt)}
                  {inv.reminder1SentAt
                    ? `; recorded sent ${formatInstant(inv.reminder1SentAt)}`
                    : ''}
                </dd>
                <dt>Reminder 2</dt>
                <dd>
                  due {formatInstant(inv.reminder2DueAt!)}
                  {inv.reminder2SentAt
                    ? `; recorded sent ${formatInstant(inv.reminder2SentAt)}`
                    : ''}
                </dd>
                <dt>Expires</dt>
                <dd>{formatInstant(inv.expiresAt!)}</dd>
              </>
            ) : null}
            {inv.completedAt ? (
              <>
                <dt>Completed</dt>
                <dd>{formatInstant(inv.completedAt)}</dd>
              </>
            ) : null}
            <dt>Link</dt>
            <dd>{inv.tokenHash ? 'active link exists (hash stored only)' : 'no active link'}</dd>
          </dl>

          {data.capabilities.canManage && ['PENDING', 'MANUALLY_SENT'].includes(inv.status) ? (
            <div className="actions-row" style={{ marginTop: '0.5rem' }}>
              <form action={generateTokenAction}>
                <input type="hidden" name="caseId" value={id} />
                <input type="hidden" name="invitationId" value={inv.id} />
                <button type="submit" className="secondary">
                  {inv.tokenHash ? 'Invalidate and regenerate link' : 'Generate secure link'}
                </button>
              </form>
              {inv.status === 'PENDING' ? (
                <form action={markSentAction}>
                  <input type="hidden" name="caseId" value={id} />
                  <input type="hidden" name="invitationId" value={inv.id} />
                  <button type="submit">Record manually sent</button>
                </form>
              ) : null}
              {inv.status === 'MANUALLY_SENT' && !inv.reminder1SentAt ? (
                <form action={reminderAction}>
                  <input type="hidden" name="caseId" value={id} />
                  <input type="hidden" name="invitationId" value={inv.id} />
                  <input type="hidden" name="which" value="1" />
                  <button type="submit" className="secondary">
                    Record reminder 1 sent
                  </button>
                </form>
              ) : null}
              {inv.status === 'MANUALLY_SENT' && inv.reminder1SentAt && !inv.reminder2SentAt ? (
                <form action={reminderAction}>
                  <input type="hidden" name="caseId" value={id} />
                  <input type="hidden" name="invitationId" value={inv.id} />
                  <input type="hidden" name="which" value="2" />
                  <button type="submit" className="secondary">
                    Record reminder 2 sent
                  </button>
                </form>
              ) : null}
              {(
                [
                  ['Cancel invitation', cancelInvitationAction, 'cancel'],
                  ['Record invalid contact info', invalidContactAction, 'invalid'],
                  ['Mark not eligible', notEligibleAction, 'ne'],
                  ['Record declined', declinedAction, 'decl'],
                ] as const
              ).map(([label, action, key]) => (
                <details key={key} className="action">
                  <summary>{label}</summary>
                  <form action={action} className="stack">
                    <input type="hidden" name="caseId" value={id} />
                    <input type="hidden" name="invitationId" value={inv.id} />
                    <div className="field">
                      <label htmlFor={`${key}-${inv.id}`}>Reason/note (required)</label>
                      <input
                        id={`${key}-${inv.id}`}
                        name="note"
                        type="text"
                        required
                        maxLength={300}
                      />
                    </div>
                    <button type="submit" className="secondary">
                      Confirm
                    </button>
                  </form>
                </details>
              ))}
              {data.capabilities.canRecordVerbal ? (
                <a
                  className="button secondary"
                  href={`/cases/${id}/survey/verbal?invitation=${inv.id}`}
                >
                  Record verbal debrief
                </a>
              ) : null}
            </div>
          ) : null}
        </section>
      ))}

      {response && response.response && !response.masked ? (
        <section className="panel" aria-labelledby="resp-h">
          <h2 id="resp-h" style={{ marginTop: 0 }}>
            Response (restricted HR data)
          </h2>
          <p className="banner-restricted">
            Identifiable survey responses are restricted to authorized HR personnel. Access is
            audited.
          </p>
          <dl className="kv">
            {(
              response.response as {
                answers: Array<{
                  question: { prompt: string };
                  valueChoice: string[];
                  valueRating: number | null;
                  valueText: string | null;
                }>;
              }
            ).answers.map((a, i) => (
              <div key={i} style={{ display: 'contents' }}>
                <dt>{a.question.prompt}</dt>
                <dd>
                  {a.valueRating ??
                    (a.valueChoice.length ? a.valueChoice.join(', ') : (a.valueText ?? '-'))}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </>
  );
}
