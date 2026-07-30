import type { Metadata } from 'next';
import { ServiceError, diagnosticBundle, listTickets } from '@exit/db';
import { formatInstant } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import { createTicketAction, updateTicketAction } from './actions';

export const metadata: Metadata = { title: 'Support' };
export const dynamic = 'force-dynamic';

const SEV_BADGE: Record<string, string> = {
  INFO: 'badge--neutral',
  WARNING: 'badge--warning',
  HIGH: 'badge--warning',
  CRITICAL: 'badge--danger',
};

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const sp = await searchParams;
  let data: Awaited<ReturnType<typeof listTickets>>;
  let bundle: Awaited<ReturnType<typeof diagnosticBundle>> | null = null;
  try {
    data = await listTickets(actor);
    bundle = await diagnosticBundle(actor);
  } catch (e) {
    if (e instanceof ServiceError)
      return <p className="panel">Support requires an authenticated application role.</p>;
    throw e;
  }

  return (
    <>
      <h1>Support and incidents</h1>
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint" role="note">
        Use SAFE operational descriptions only - never employee personal data. Technical support
        personnel do not receive case content through this area.
      </p>

      <details className="action">
        <summary>Raise a support record</summary>
        <form action={createTicketAction}>
          <label htmlFor="t-cat">Category</label>
          <select id="t-cat" name="category" required>
            <option value="INCIDENT">Incident</option>
            <option value="SERVICE_REQUEST">Service request</option>
            <option value="INTEGRATION_FAILURE">Integration failure</option>
            <option value="SECURITY_PRIVACY_INCIDENT">Security / privacy incident</option>
            <option value="DATA_CORRECTION">Data correction request</option>
            <option value="ACCESS_REQUEST">Access request</option>
            <option value="CONFIGURATION_ISSUE">Workflow / configuration issue</option>
          </select>
          <label htmlFor="t-sev">Severity</label>
          <select id="t-sev" name="severity">
            <option value="INFO">Info</option>
            <option value="WARNING">Warning</option>
            <option value="HIGH">High</option>
            <option value="CRITICAL">Critical</option>
          </select>
          <label htmlFor="t-title">Title</label>
          <input id="t-title" name="title" required maxLength={200} />
          <label htmlFor="t-desc">Safe description (no personal data)</label>
          <textarea id="t-desc" name="description" rows={3} required maxLength={2000} />
          <label htmlFor="t-comp">Affected component</label>
          <input id="t-comp" name="affectedComponent" maxLength={100} />
          <button type="submit">Create record</button>
        </form>
      </details>

      {data.tickets.length === 0 ? <p className="panel">No support records.</p> : null}
      {data.tickets.map((t) => (
        <section className="panel" key={t.id} aria-label={t.title}>
          <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>
            {t.title}{' '}
            <span className={`badge ${SEV_BADGE[t.severity] ?? 'badge--neutral'}`}>
              {t.severity}
            </span>{' '}
            <span className="badge badge--neutral">{t.category}</span>{' '}
            <span className={`badge ${t.status === 'OPEN' ? 'badge--warning' : 'badge--success'}`}>
              {t.status}
            </span>
          </h2>
          <p className="hint">
            {t.description} - {t.environment} - created {formatInstant(t.createdAt)}
            {t.affectedComponent ? ` - component: ${t.affectedComponent}` : ''}
            {t.resolution ? ` - resolution: ${t.resolution}` : ''}
          </p>
          {data.canManage && (t.status === 'OPEN' || t.status === 'IN_PROGRESS') ? (
            <details className="action">
              <summary>Update</summary>
              <form action={updateTicketAction}>
                <input type="hidden" name="id" value={t.id} />
                <label htmlFor={`ts-${t.id}`}>Status</label>
                <select id={`ts-${t.id}`} name="status">
                  <option value="IN_PROGRESS">In progress</option>
                  <option value="RESOLVED">Resolved</option>
                  <option value="CLOSED">Closed</option>
                </select>
                <label htmlFor={`tr-${t.id}`}>Resolution</label>
                <input id={`tr-${t.id}`} name="resolution" maxLength={500} />
                <button type="submit">Update record</button>
              </form>
            </details>
          ) : null}
        </section>
      ))}

      {bundle ? (
        <section className="panel" aria-labelledby="diag-h">
          <h2 id="diag-h" style={{ marginTop: 0 }}>
            PII-safe diagnostic bundle
          </h2>
          <p className="hint">{bundle.note}</p>
          <pre style={{ whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
            {JSON.stringify(bundle, null, 2)}
          </pre>
        </section>
      ) : null}
    </>
  );
}
