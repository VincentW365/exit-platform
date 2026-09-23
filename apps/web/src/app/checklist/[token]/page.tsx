import type { Metadata } from 'next';
import { getActionByToken, getChecklistForToken } from '@exit/db';
import {
  formatDateInput,
  formatDateOnly,
  RETURN_ITEM_STATUSES,
  RETURN_ITEM_STATUS_LABEL,
} from '@exit/domain';
import { humanize } from '@/lib/text';
import { BrandMark } from '@/components/BrandMark';
import { submitChecklistAction } from './actions';

export const metadata: Metadata = {
  title: 'Exit Checklist for Return Items',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

/**
 * Public no-login Exit Checklist for Return Items (owner directive, 2026-08-19).
 *
 * The page replicates the company's printed checklist - letterhead, the
 * Employee / Reason / Date header, the ruled item table with its KEYS
 * sub-heading, and the Received By line - as an interactive document. The
 * paper form's single tick column becomes a tick per outcome, because "not
 * returned" and "lost / damaged" are answers HR needs, not blank cells.
 *
 * Same trust shape as /ack/[token]: outside the authenticated (app) group,
 * neutral failures, and nothing beyond what the email already carried plus
 * the items being returned.
 */

/**
 * Items above the KEYS sub-heading, exactly as the sheet numbers them. Rows HR
 * added for property the printed form does not list (DEC-069) have no
 * catalogue key; they are shown read-only here, because the recipient of the
 * secure link answers the company's own rows and HR records the rest.
 */
function splitItems<T extends { itemKey: string | null }>(items: readonly T[]) {
  return {
    main: items.filter((i) => !(i.itemKey ?? '').startsWith('KEYS_')),
    keys: items.filter((i) => (i.itemKey ?? '').startsWith('KEYS_')),
  };
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main id="main" style={{ maxWidth: '56rem', margin: '2rem auto', padding: '0 1rem 3rem' }}>
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

/** One ruled table row: number, item, the tick options, remarks. */
function ItemRow({
  item,
  index,
  number,
}: {
  item: {
    id: string;
    itemKey: string | null;
    label: string;
    status: string;
    remarks: string | null;
  };
  index: number;
  number: number;
}) {
  if (!item.itemKey)
    return (
      <tr>
        <td className="form-table__num">{number}.</td>
        <th scope="row">{item.label}</th>
        <td className="meta">Recorded by HR</td>
        <td className="meta">{item.remarks ?? '-'}</td>
      </tr>
    );
  return (
    <tr>
      <td className="form-table__num">{number}.</td>
      <th scope="row" id={`item-name-${index}`}>
        {item.label}
      </th>
      <td>
        <input type="hidden" name={`item.${index}.key`} value={item.itemKey} />
        <div className="tickset" role="radiogroup" aria-labelledby={`item-name-${index}`}>
          {RETURN_ITEM_STATUSES.filter((s) => s !== 'OUTSTANDING').map((s) => (
            <label key={s} className="tick">
              <input
                type="radio"
                name={`item.${index}.status`}
                value={s}
                defaultChecked={item.status === s}
              />
              {RETURN_ITEM_STATUS_LABEL[s]}
            </label>
          ))}
        </div>
        {/* An unticked row stays OUTSTANDING: the fallback posts only when no
            tick above it is selected (FormData.get takes the first entry). */}
        <input type="hidden" name={`item.${index}.status`} value="OUTSTANDING" />
      </td>
      <td>
        <input
          type="text"
          name={`item.${index}.remarks`}
          aria-label={`Remarks for ${item.label}`}
          maxLength={500}
          defaultValue={item.remarks ?? ''}
        />
      </td>
    </tr>
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
  const { main, keys } = splitItems(checklist.items);

  return (
    <Shell>
      <h1 className="sr-only">Exit Checklist for Return Items</h1>

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

      <form action={submitChecklistAction}>
        <input type="hidden" name="token" value={token} />

        <div className="paper">
          <header className="paper__letterhead">
            {/* The company logo on every form the employee is handed
                (owner directive 2026-09-22, section 8). */}
            <BrandMark size="lg" />
            <div className="paper__org">Bert&apos;s Auto Parts Limited</div>
            <p className="paper__title">Exit Checklist for Return Items</p>
            <p className="paper__ref">Case reference: {c.caseNumber}</p>
          </header>

          {/* The sheet's header facts come from the case and stay fixed - the
              link is already bound to this one employee. */}
          <div className="sigline">
            <span className="sigline__label">Employee:</span>
            <span className="sigline__value">{c.employeeDisplayName}</span>
          </div>
          <div className="sigline">
            <span className="sigline__label">Reason for Exit:</span>
            <span className="sigline__value">{humanize(c.departureType)}</span>
          </div>
          <div className="sigline">
            <span className="sigline__label">Date of Exit:</span>
            <span className="sigline__value">{lastDay ? formatDateOnly(lastDay) : '-'}</span>
          </div>

          <p className="hint" style={{ margin: 'var(--space-3) 0' }}>
            Tick the outcome for each item. Add a remark for anything not returned; items that were
            never issued should be ticked <em>Not applicable</em>. Anything left blank stays
            outstanding.
          </p>

          <table className="form-table">
            <caption className="sr-only">Items to be returned</caption>
            <thead>
              <tr>
                <th scope="col" aria-label="Number" className="form-table__num" />
                <th scope="col">Items</th>
                <th scope="col">Check (&#10003;)</th>
                <th scope="col">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {main.map((item, i) => (
                <ItemRow key={item.id} item={item} index={i} number={i + 1} />
              ))}
              <tr className="form-table__group">
                <td className="form-table__num" />
                <th scope="rowgroup" colSpan={3}>
                  Keys
                </th>
              </tr>
              {keys.map((item, i) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  index={main.length + i}
                  number={main.length + i + 1}
                />
              ))}
            </tbody>
          </table>

          <div className="paper__bar">Received By</div>
          <div className="sigline">
            <label className="sigline__label" htmlFor="receivedByName">
              Items Received By:
            </label>
            <input
              id="receivedByName"
              name="receivedByName"
              maxLength={120}
              required
              autoComplete="name"
              defaultValue={checklist.receivedByName ?? ''}
            />
            <label className="sigline__label" htmlFor="receivedAt">
              Date:
            </label>
            <input
              id="receivedAt"
              name="receivedAt"
              type="date"
              style={{ flex: '0 1 11rem' }}
              defaultValue={checklist.receivedAt ? formatDateInput(checklist.receivedAt) : ''}
            />
          </div>
          <div className="sigline">
            <label className="sigline__label" htmlFor="submittedByName">
              Your Name:
            </label>
            <input
              id="submittedByName"
              name="submittedByName"
              maxLength={120}
              required
              autoComplete="name"
              defaultValue={checklist.submittedByName ?? ''}
            />
          </div>
          <div className="sigline">
            <label className="sigline__label" htmlFor="employeeAcknowledgedBy">
              Employee Acknowledgement:
            </label>
            <input
              id="employeeAcknowledgedBy"
              name="employeeAcknowledgedBy"
              maxLength={120}
              defaultValue={checklist.employeeAcknowledgedBy ?? ''}
            />
            <span className="meta">
              Optional. Enter the employee&apos;s name if they signed for the handover.
            </span>
          </div>

          <p className="hint">
            This secure link can be used once. Human Resources will follow up on anything still
            outstanding.
          </p>
          <button type="submit" className="button--primary">
            Submit Checklist
          </button>
        </div>
      </form>
    </Shell>
  );
}
