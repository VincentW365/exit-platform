import type { Metadata } from 'next';
import { getActionByToken, getChecklistForToken } from '@exit/db';
import {
  formatDateInput,
  formatDateOnly,
  RETURN_ITEM_STATUSES,
  RETURN_ITEM_STATUS_LABEL,
} from '@exit/domain';
import { submitChecklistAction } from './actions';

export const metadata: Metadata = {
  title: 'Exit Checklist for Return Items',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

/**
 * Public no-login Exit Checklist for Return Items (owner directive, 2026-08-19).
 *
 * The secure link opens THIS employee's checklist directly - the recipient
 * never searches the HR platform for the right person. Same shape as
 * /ack/[token]: outside the authenticated (app) group, neutral failures, and
 * nothing beyond what the email already carried plus the items being returned.
 */

/** The two key rows print under a "KEYS" sub-heading on the paper form. */
function itemName(itemKey: string, label: string): string {
  return itemKey.startsWith('KEYS_') ? `Keys - ${label}` : label;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" style={{ maxWidth: '48rem', margin: '2rem auto', padding: '0 1rem 3rem' }}>
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

export default async function PublicChecklistPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string; err?: string; retry?: string }>;
}) {
  const { token } = await params;
  const sp = await searchParams;

  // The link is spent on submission, so the confirmation renders from the
  // redirect marker rather than from the token.
  if (sp.done === '1') {
    return (
      <Shell>
        <h1>Checklist Received</h1>
        <p className="panel">
          Thank you. The completed checklist has been recorded and Human Resources can see it. You
          can close this page.
        </p>
      </Shell>
    );
  }

  const action = await getActionByToken(token);
  if (!action || action.purpose !== 'COMPLETE_RETURN_CHECKLIST') return <NeutralPage />;

  const data = await getChecklistForToken(action.caseId);
  if (!data) return <NeutralPage />;
  const { checklist, case: c } = data;
  const errors = (sp.err ?? '').split('|').filter(Boolean).slice(0, 12);
  const lastDay = c.confirmedLastDay ?? c.effectiveSeparationAt;

  return (
    <Shell>
      <h1>Exit Checklist for Return Items</h1>
      <div className="panel stack">
        <p>
          <strong>{c.employeeDisplayName}</strong>
          <br />
          Case reference: {c.caseNumber}
          {lastDay ? (
            <>
              <br />
              Last working day: {formatDateOnly(lastDay)}
            </>
          ) : null}
        </p>
        <p className="hint">
          Record each item below. Add a remark for anything not returned. Items that were never
          issued should be marked <em>Not applicable</em>.
        </p>
      </div>

      {errors.length ? (
        <div className="error-summary" role="alert">
          <h2>The checklist was not submitted</h2>
          <ul>
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <p className="hint">
            What you entered has been kept. Correct the points above and submit.
          </p>
        </div>
      ) : null}
      {sp.retry === '1' ? (
        <p className="hint" role="status">
          Your response could not be recorded just now. Please try again in a minute.
        </p>
      ) : null}

      <form action={submitChecklistAction} className="stack">
        <input type="hidden" name="token" value={token} />

        <div className="table-wrap">
          <table className="table-checklist">
            <caption className="sr-only">Items to be returned</caption>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Status</th>
                <th scope="col">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {checklist.items.map((item, index) => {
                const name = itemName(item.itemKey, item.label);
                return (
                  <tr key={item.id}>
                    <th scope="row">
                      <label htmlFor={`status-${index}`}>{name}</label>
                    </th>
                    <td>
                      <input type="hidden" name={`item.${index}.key`} value={item.itemKey} />
                      <select
                        id={`status-${index}`}
                        name={`item.${index}.status`}
                        defaultValue={item.status}
                      >
                        {RETURN_ITEM_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {RETURN_ITEM_STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="text"
                        name={`item.${index}.remarks`}
                        aria-label={`Remarks for ${name}`}
                        maxLength={500}
                        defaultValue={item.remarks ?? ''}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <fieldset className="stack">
          <legend>Who Completed This Checklist</legend>
          <div className="field">
            <label htmlFor="receivedByName">Items Received By</label>
            <input
              id="receivedByName"
              name="receivedByName"
              maxLength={120}
              required
              defaultValue={checklist.receivedByName ?? ''}
            />
          </div>
          <div className="field">
            <label htmlFor="receivedAt">Date Received</label>
            <input
              id="receivedAt"
              name="receivedAt"
              type="date"
              defaultValue={checklist.receivedAt ? formatDateInput(checklist.receivedAt) : ''}
            />
          </div>
          <div className="field">
            <label htmlFor="submittedByName">Your Name</label>
            <input
              id="submittedByName"
              name="submittedByName"
              maxLength={120}
              required
              defaultValue={checklist.submittedByName ?? ''}
            />
          </div>
          <div className="field">
            <label htmlFor="employeeAcknowledgedBy">Employee Acknowledgement</label>
            <input
              id="employeeAcknowledgedBy"
              name="employeeAcknowledgedBy"
              maxLength={120}
              defaultValue={checklist.employeeAcknowledgedBy ?? ''}
            />
            <span className="hint">
              Optional. Enter the employee&apos;s name if they signed for the handover.
            </span>
          </div>
        </fieldset>

        <p className="hint">
          This secure link can be used once. Human Resources will follow up on anything still
          outstanding.
        </p>
        <button type="submit">Submit Checklist</button>
      </form>
    </Shell>
  );
}
