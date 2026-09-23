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
  const f = view.form;
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
        <dl className="signing__facts">
          <Row label="Employee" value={f.employeeName} />
          <Row label="Employee number" value={f.employeeNumber} />
          <Row label="Position" value={f.position} />
          <Row label="Department" value={f.department} />
          <Row label="Location" value={f.location} />
          <Row label="Separation type" value={f.departureType} />
          <Row label="Notice received" value={f.receivedAt} />
          <Row label="Final working day" value={f.confirmedLastDay} />
          <Row label="Effective date of separation" value={f.effectiveSeparationAt} />
          <Row label="Employment status" value={`${f.priorStatus} to ${f.newStatus}`} />
          <Row label="Case reference" value={f.caseReference} />
        </dl>
        <p className="hint">
          If anything above is wrong, do not sign. Contact Human Resources and they will correct the
          form and send you a new link.
        </p>
      </SigningForm>
    </Shell>
  );
}
