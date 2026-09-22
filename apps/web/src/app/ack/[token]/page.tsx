import type { Metadata } from 'next';
import { getActionByToken } from '@exit/db';
import { BrandMark } from '@/components/BrandMark';
import { redeemAckAction } from './actions';

export const metadata: Metadata = {
  title: 'Confirm an offboarding action',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

/**
 * Public no-login acknowledgement page (Directive 6.3 T). Mirrors the exit
 * survey token route: outside the authenticated (app) group, neutral failures,
 * and never more case data than the email already carried (case number +
 * subject line).
 */

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" style={{ maxWidth: '38rem', margin: '2rem auto', padding: '0 1rem 3rem' }}>
      {/* The company logo on every page a recipient is handed (owner
          directive 2026-09-22, section 8). */}
      <div className="public-brand">
        <BrandMark size="lg" />
      </div>
      {children}
    </main>
  );
}

/** Neutral page for every invalid/expired/used link - no detail leaks. */
function NeutralPage() {
  return (
    <Shell>
      <h1>Link Not Available</h1>
      <p className="panel">This link is not valid. It may have expired or already been used.</p>
    </Shell>
  );
}

export default async function PublicAckPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string; retry?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;

  // After a successful redemption the token is dead by design (single use),
  // so the thank-you renders from the redirect marker, not the token.
  if (sp.done === '1') {
    return (
      <Shell>
        <h1>Thank You</h1>
        <p className="panel">Recorded. You can close this page.</p>
      </Shell>
    );
  }

  const action = await getActionByToken(token);
  if (!action) return <NeutralPage />;

  if (action.alreadyDone) {
    return (
      <Shell>
        <h1>Already Recorded</h1>
        <p className="panel">Already recorded. Nothing further is needed.</p>
      </Shell>
    );
  }

  const isReceipt = action.purpose === 'ACKNOWLEDGE_RECEIPT';
  return (
    <Shell>
      <h1>{isReceipt ? 'Acknowledge receipt' : 'Confirm completion'}</h1>
      <p className="panel">
        <strong>{action.actionLabel}</strong>
        <br />
        Case reference: {action.caseReference}
      </p>
      {sp.retry === '1' ? (
        <p className="hint" role="status">
          Your response could not be recorded just now. Please try again in a minute.
        </p>
      ) : null}
      <form action={redeemAckAction} className="stack">
        <input type="hidden" name="token" value={token} />
        <div className="field">
          <label htmlFor="ack-note">Note (Optional)</label>
          <textarea id="ack-note" name="note" rows={3} maxLength={500} />
        </div>
        <p className="hint">This secure link can be used once and then stops working.</p>
        <button type="submit">
          {isReceipt ? 'Acknowledge receipt' : 'Confirm the action is completed'}
        </button>
      </form>
    </Shell>
  );
}
