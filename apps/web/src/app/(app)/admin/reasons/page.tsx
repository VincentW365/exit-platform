import type { Metadata } from 'next';
import { ServiceError, listReasonCategories } from '@exit/db';
import { can, DEPARTURE_TYPES } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import { approveReasonAction, retireReasonAction, upsertReasonAction } from './actions';

export const metadata: Metadata = { title: 'Reason taxonomy' };
export const dynamic = 'force-dynamic';

export default async function ReasonsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const sp = await searchParams;
  let categories: Awaited<ReturnType<typeof listReasonCategories>>;
  try {
    categories = await listReasonCategories(actor);
  } catch (e) {
    if (e instanceof ServiceError)
      return (
        <>
          <h1>Access restricted</h1>
          <p className="panel">Reason taxonomy requires an authorized role.</p>
        </>
      );
    throw e;
  }
  const canManage = can(actor, 'reasons.manage');

  return (
    <>
      <h1>Reason taxonomy</h1>
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint" role="note">
        Versioned configurable reference data - never a code enum. Synthetic examples require HR
        approval before operational use. Retiring a category never alters prior cases; reporting
        groups aggregate without exposing restricted reason notes.
      </p>
      <div className="panel" style={{ overflowX: 'auto' }} tabIndex={0}>
        <table>
          <caption className="visually-hidden">Reason categories</caption>
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Label</th>
              <th scope="col">Version</th>
              <th scope="col">Applicability</th>
              <th scope="col">Reporting group</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id}>
                <td>
                  <code>{c.code}</code>
                  {c.sensitive ? (
                    <>
                      {' '}
                      <span className="badge badge--warning">Sensitive</span>
                    </>
                  ) : null}
                </td>
                <td>
                  {c.label}
                  {c.isTestOnly ? <span className="hint"> (requires HR approval)</span> : null}
                </td>
                <td>v{c.taxonomyVersion}</td>
                <td>
                  {c.voluntary === null ? 'Any' : c.voluntary ? 'Voluntary' : 'Involuntary'}
                  {c.departureTypes.length ? (
                    <span className="hint"> - {c.departureTypes.join(', ')}</span>
                  ) : null}
                </td>
                <td>{c.reportingGroup ?? '-'}</td>
                <td>
                  <span className={`badge ${c.isActive ? 'badge--success' : 'badge--neutral'}`}>
                    {c.isActive ? 'Active' : c.retiredAt ? 'Retired' : 'Draft'}
                  </span>
                  {c.approvedAt ? (
                    <span className="hint"> approved</span>
                  ) : (
                    <span className="hint"> unapproved</span>
                  )}
                </td>
                <td>
                  {canManage && !c.approvedAt ? (
                    <form action={approveReasonAction} style={{ display: 'inline-block' }}>
                      <input type="hidden" name="id" value={c.id} />
                      <button type="submit">Approve + activate</button>
                    </form>
                  ) : null}{' '}
                  {canManage && c.isActive ? (
                    <details className="action" style={{ display: 'inline-block' }}>
                      <summary>Retire</summary>
                      <form action={retireReasonAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <label htmlFor={`rr-${c.id}`}>Reason (audited)</label>
                        <input id={`rr-${c.id}`} name="reason" required maxLength={500} />
                        <button type="submit">Retire category</button>
                      </form>
                    </details>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canManage ? (
        <details className="action">
          <summary>Add or revise a category (creates a new version)</summary>
          <form action={upsertReasonAction}>
            <label htmlFor="rc-code">Code (A-Z, 0-9, dashes)</label>
            <input id="rc-code" name="code" required maxLength={40} />
            <label htmlFor="rc-label">Label</label>
            <input id="rc-label" name="label" required maxLength={200} />
            <label htmlFor="rc-desc">Description</label>
            <textarea id="rc-desc" name="description" rows={2} maxLength={1000} />
            <label htmlFor="rc-vol">Voluntary / involuntary applicability</label>
            <select id="rc-vol" name="voluntary" defaultValue="">
              <option value="">Any</option>
              <option value="true">Voluntary only</option>
              <option value="false">Involuntary only</option>
            </select>
            <fieldset>
              <legend>Departure-type applicability (none = all)</legend>
              {DEPARTURE_TYPES.map((t) => (
                <label key={t} style={{ display: 'block' }}>
                  <input type="checkbox" name="departureTypes" value={t} /> {t}
                </label>
              ))}
            </fieldset>
            <label htmlFor="rc-group">Reporting group</label>
            <input id="rc-group" name="reportingGroup" maxLength={100} />
            <label htmlFor="rc-sort">Sort order</label>
            <input
              id="rc-sort"
              name="sortOrder"
              type="number"
              min={0}
              max={1000}
              defaultValue={0}
            />
            <label>
              <input type="checkbox" name="sensitive" /> Sensitive (reported only through its group)
            </label>
            <label htmlFor="rc-reason">Change reason (required, audited)</label>
            <input id="rc-reason" name="changeReason" required maxLength={500} />
            <button type="submit">Save as new version (requires approval)</button>
          </form>
        </details>
      ) : null}
    </>
  );
}
