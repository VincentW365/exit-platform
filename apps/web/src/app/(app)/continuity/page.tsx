import type { Metadata } from 'next';
import { ServiceError, continuityOverview } from '@exit/db';
import { formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import {
  closeOutageAction,
  declareOutageAction,
  reconcileEntryAction,
  recordEntryAction,
} from './actions';
import { humanize } from '@/lib/text';

export const metadata: Metadata = { title: 'Business Continuity' };
export const dynamic = 'force-dynamic';

const BLANK_FORMS = [
  {
    name: 'Manual case intake form',
    fields: 'Fallback ref, date received, receipt source, departure type, notes',
  },
  {
    name: 'Manual notification log',
    fields: 'Fallback ref, notification type, recipient class, method, sent by, time',
  },
  {
    name: 'Manual access-removal log',
    fields: 'Fallback ref, systems removed, removed by, exact time, evidence',
  },
  { name: 'Manual asset checklist', fields: 'Fallback ref, asset, condition, received by, time' },
  {
    name: 'Manual clearance checklist',
    fields: 'Fallback ref, condition checklist, approver, time',
  },
];

export default async function ContinuityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const sp = await searchParams;
  let data: Awaited<ReturnType<typeof continuityOverview>>;
  try {
    data = await continuityOverview(actor);
  } catch (e) {
    if (e instanceof ServiceError)
      return (
        <>
          <h1>Access Restricted</h1>
          <p className="panel">The continuity center requires an authorized role.</p>
        </>
      );
    throw e;
  }

  return (
    <>
      <h1>Business Continuity and Manual Fallback</h1>
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint" role="note">
        Blank fallback forms are SANITIZED - never pre-filled with employee details. Manual records
        carry controlled FB-references and must be reconciled (duplicate-safe) before an outage
        closes. Exact-time IT access removal is still performed manually during an outage.
      </p>

      <section className="panel" aria-labelledby="forms-h">
        <h2 id="forms-h" style={{ marginTop: 0 }}>
          Blank Fallback Forms (Print and Use Manually)
        </h2>
        <ul>
          {BLANK_FORMS.map((f) => (
            <li key={f.name}>
              <strong>{f.name}</strong>
              <span className="hint"> - columns: {f.fields}</span>
            </li>
          ))}
        </ul>
      </section>

      {data.canOperate ? (
        <details className="action">
          <summary>Declare an outage</summary>
          <form action={declareOutageAction}>
            <label htmlFor="o-title">Title</label>
            <input id="o-title" name="title" required maxLength={200} />
            <label htmlFor="o-note">Note</label>
            <input id="o-note" name="note" maxLength={500} />
            <button type="submit">Declare outage</button>
          </form>
        </details>
      ) : null}

      {data.outages.map((o) => (
        <section className="panel" key={o.id} aria-label={`Outage ${o.title}`}>
          <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>
            {o.title}{' '}
            <span className={`badge ${o.status === 'CLOSED' ? 'badge--neutral' : 'badge--danger'}`}>
              {humanize(o.status)}
            </span>
          </h2>
          <p className="hint">
            Declared {formatInstant(o.declaredAt)}
            {o.closedAt ? ` - closed ${formatInstant(o.closedAt)}` : ''}
            {o.note ? ` - ${o.note}` : ''}
          </p>
          <ul>
            {o.entries.map((e) => (
              <li key={e.id}>
                <code>{e.refNumber}</code> [{e.kind}] {e.summary}{' '}
                {e.reconciledAt ? (
                  <span className="badge badge--success">reconciled</span>
                ) : (
                  <>
                    <span className="badge badge--warning">awaiting reconciliation</span>{' '}
                    {data.canOperate && o.status !== 'CLOSED' ? (
                      <details className="action" style={{ display: 'inline-block' }}>
                        <summary>Reconcile</summary>
                        <form action={reconcileEntryAction}>
                          <input type="hidden" name="entryId" value={e.id} />
                          <label htmlFor={`rc-case-${e.id}`}>
                            Linked System Case ID (Optional)
                          </label>
                          <input id={`rc-case-${e.id}`} name="caseId" maxLength={40} />
                          <label htmlFor={`rc-note-${e.id}`}>Reconciliation Note (Audited)</label>
                          <input id={`rc-note-${e.id}`} name="note" required maxLength={500} />
                          <button type="submit">Reconcile entry</button>
                        </form>
                      </details>
                    ) : null}
                  </>
                )}
              </li>
            ))}
          </ul>
          {data.canOperate && o.status !== 'CLOSED' ? (
            <>
              <details className="action">
                <summary>Record a manual entry</summary>
                <form action={recordEntryAction}>
                  <input type="hidden" name="outageId" value={o.id} />
                  <label htmlFor={`fe-kind-${o.id}`}>Kind</label>
                  <select id={`fe-kind-${o.id}`} name="kind" required>
                    <option value="CASE">Case</option>
                    <option value="NOTIFICATION">Notification</option>
                    <option value="ACCESS_REMOVAL">Access removal</option>
                    <option value="ASSET">Asset</option>
                    <option value="CLEARANCE">Clearance</option>
                  </select>
                  <label htmlFor={`fe-sum-${o.id}`}>
                    Safe Summary (No Personal Detail Beyond Need)
                  </label>
                  <textarea
                    id={`fe-sum-${o.id}`}
                    name="summary"
                    rows={2}
                    required
                    maxLength={1000}
                  />
                  <button type="submit">Record manual entry</button>
                </form>
              </details>
              <details className="action">
                <summary>Close outage (requires full reconciliation)</summary>
                <form action={closeOutageAction}>
                  <input type="hidden" name="outageId" value={o.id} />
                  <label htmlFor={`oc-note-${o.id}`}>Closure Note (Audited)</label>
                  <input id={`oc-note-${o.id}`} name="note" required maxLength={500} />
                  <button type="submit">Close outage</button>
                </form>
              </details>
            </>
          ) : null}
        </section>
      ))}
    </>
  );
}
