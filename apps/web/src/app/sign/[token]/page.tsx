import type { Metadata } from 'next';
import { getSigningView } from '@exit/db';
import { formatDateOnly, SIGNING_PAGE_MESSAGES } from '@exit/domain';
import { BrandMark } from '@/components/BrandMark';
import { SigningForm } from '@/components/SigningForm';
import { submitSigningAction } from './actions';

export const metadata: Metadata = {
  title: 'Review and Sign',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

/**
 * Public no-login signing page (DEC-068, directive 1 sections 10 to 16).
 *
 * The signer arrives from an emailed or shared secure link and needs no HR
 * account, no role and no development login. The link authorizes ONE named
 * signer to sign ONE form, and the page shows only what that person must read
 * to sign honestly - never the wider HR case, its notes, its tasks or its
 * other documents.
 *
 * Every unusable link ends here in the same neutral way, in the wording the
 * owner specified: completed, expired, or no longer valid.
 */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" className="signing">
      <header className="signing__brand">
        <BrandMark size="lg" />
      </header>
      {children}
    </main>
  );
}

function Message({ heading, body }: { heading: string; body: string }) {
  return (
    <Shell>
      <h1>{heading}</h1>
      <p className="panel">{body}</p>
    </Shell>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="signing__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export default async function SignPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const query = await searchParams;

  if (query['done'] === '1')
    return (
      <Message
        heading="Thank you"
        body="Your signed form has been returned to Human Resources. You can close this page."
      />
    );
  if (query['retry'] === '1')
    return (
      <Message
        heading="Please try again"
        body="Too many attempts were made from this connection. Wait a moment and open the link again."
      />
    );

  const outcome = await getSigningView(token);
  if (outcome.state !== 'OPEN') {
    if (outcome.state === 'COMPLETED')
      return <Message heading="Already signed" body={SIGNING_PAGE_MESSAGES.completed} />;
    if (outcome.state === 'EXPIRED')
      return <Message heading="Link expired" body={SIGNING_PAGE_MESSAGES.expired} />;
    return <Message heading="Link not available" body={SIGNING_PAGE_MESSAGES.invalid} />;
  }

  const { view } = outcome;
  const failed = query['error'] === '1';

  return (
    <Shell>
      <h1>{view.documentTitle}</h1>
      <p className="signing__lede">
        {view.signerName}, please review the details below and add your initials and signature. This
        link is valid until {formatDateOnly(view.expiresAt)}.
      </p>

      {failed ? (
        <div className="alert alert--error" role="alert">
          <p>
            Your signature could not be recorded. Please check that every box has a mark and try
            again.
          </p>
        </div>
      ) : null}

      <SigningForm
        token={token}
        blocks={view.blocks}
        consentText={view.consentText}
        reviewText="I confirm that I have reviewed the information shown above."
        action={submitSigningAction}
      >
        {view.document.kind === 'ACTION_FORM' ? (
          <dl className="signing__facts">
            <Row label="Employee" value={view.document.form.employeeName} />
            <Row label="Employee number" value={view.document.form.employeeNumber} />
            <Row label="Position" value={view.document.form.position} />
            <Row label="Department" value={view.document.form.department} />
            <Row label="Location" value={view.document.form.location} />
            <Row label="Separation type" value={view.document.form.departureType} />
            <Row label="Notice received" value={view.document.form.receivedAt} />
            <Row label="Final working day" value={view.document.form.confirmedLastDay} />
            <Row
              label="Effective date of separation"
              value={view.document.form.effectiveSeparationAt}
            />
            <Row
              label="Employment status"
              value={`${view.document.form.priorStatus} to ${view.document.form.newStatus}`}
            />
            <Row label="Case reference" value={view.document.form.caseReference} />
          </dl>
        ) : (
          // DEC-069: the Exit Checklist for Return Items, row by row, as the
          // company's printed sheet lists it.
          <>
            <dl className="signing__facts">
              <Row label="Employee" value={view.document.receipt.employeeName} />
              <Row label="Reason for exit" value={view.document.receipt.reasonForExit} />
              <Row label="Date of exit" value={view.document.receipt.dateOfExit} />
              <Row label="Case reference" value={view.document.receipt.caseReference} />
            </dl>
            <table className="form-table">
              <caption className="sr-only">Return items and their recorded status</caption>
              <thead>
                <tr>
                  <th scope="col" aria-label="Number" className="form-table__num" />
                  <th scope="col">Items</th>
                  <th scope="col">Check (&#10003;)</th>
                  <th scope="col">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {view.document.receipt.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="form-table__num">{r.number}.</td>
                    <th scope="row">
                      {r.group === 'KEYS' ? 'Keys - ' : ''}
                      {r.label}
                    </th>
                    <td>{r.statusLabel}</td>
                    <td>
                      {[
                        r.remarks,
                        r.quantity != null ? `Qty ${r.quantity}` : null,
                        r.condition,
                        r.returnedAt ? `Returned ${r.returnedAt}` : null,
                        r.assetReference ? `Ref ${r.assetReference}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="signing__facts">
              <Row label="Items received by" value={view.document.receipt.receivedByName} />
              <Row label="Date received" value={view.document.receipt.receivedAt} />
              {view.document.receipt.outstanding.length > 0 ? (
                <Row
                  label="Still outstanding"
                  value={view.document.receipt.outstanding.join(', ')}
                />
              ) : null}
            </dl>
            {view.document.receipt.hrNotes ? (
              <p className="hint">{view.document.receipt.hrNotes}</p>
            ) : null}
          </>
        )}
        <p className="hint">
          If anything above is wrong, do not sign. Contact Human Resources and they will correct the
          form and send you a new link.
        </p>
      </SigningForm>
    </Shell>
  );
}
