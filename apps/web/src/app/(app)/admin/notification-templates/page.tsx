import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import {
  ServiceError,
  listNotificationTemplateVersions,
  previewNotificationTemplate,
} from '@exit/db';
import { can, formatInstant, NOTIFICATION_PLACEHOLDERS, NOTIFICATION_TYPES } from '@exit/domain';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import {
  activateNotifTemplateAction,
  draftNotifTemplateAction,
  retireNotifTemplateAction,
  testSendNotifTemplateAction,
} from './actions';

export const metadata: Metadata = { title: 'Notification templates' };
export const dynamic = 'force-dynamic';

const TPL_BADGE: Record<string, string> = {
  DRAFT: 'badge--neutral',
  ACTIVE: 'badge--success',
  SUPERSEDED: 'badge--neutral',
  RETIRED: 'badge--warning',
};

export default async function NotificationTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; ok?: string; preview?: string }>;
}) {
  const { actor } = await requireAuth();
  if (!can(actor, 'notifTemplate.view')) redirect('/admin');
  const sp = await searchParams;
  const templates = await listNotificationTemplateVersions(actor);
  const canDraft = can(actor, 'notifTemplate.draft');
  const canActivate = can(actor, 'notifTemplate.activate');

  let preview: { subject: string; body: string; note: string } | null = null;
  if (sp.preview) {
    try {
      preview = await previewNotificationTemplate(actor, sp.preview);
    } catch (e) {
      if (!(e instanceof ServiceError)) throw e;
    }
  }

  const byType = new Map<string, typeof templates>();
  for (const t of templates) {
    const list = byType.get(t.notificationType) ?? [];
    list.push(t);
    byType.set(t.notificationType, list);
  }

  return (
    <>
      <h1>Notification templates</h1>
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint" role="note">
        Versioned, deterministic, plain-text email templates. Officers draft; HR Managers activate
        (the prior active version is superseded). Previews and test sends use clearly synthetic
        sample values only; test sends go to the development capture destination, never a real
        recipient.
      </p>

      {preview ? (
        <section className="panel" aria-labelledby="preview-h">
          <h2 id="preview-h" style={{ marginTop: 0 }}>
            Rendered output
          </h2>
          <p className="hint">{preview.note}</p>
          <p>
            <strong>Subject:</strong> {preview.subject}
          </p>
          <pre tabIndex={0} style={{ whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
            {preview.body}
          </pre>
        </section>
      ) : null}

      {NOTIFICATION_TYPES.filter((type) => (byType.get(type) ?? []).length > 0).map((type) => (
        <section className="panel" key={type} aria-label={`${type} template versions`}>
          <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>
            <code>{type}</code>
          </h2>
          <div className="table-wrap" tabIndex={0}>
            <table className="data">
              <caption className="sr-only">Versions of the {type} template</caption>
              <thead>
                <tr>
                  <th scope="col">Version</th>
                  <th scope="col">Status</th>
                  <th scope="col">Name</th>
                  <th scope="col">Activated</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(byType.get(type) ?? []).map((t) => (
                  <tr key={t.id}>
                    <td>v{t.version}</td>
                    <td>
                      <span className={`badge ${TPL_BADGE[t.status] ?? 'badge--neutral'}`}>
                        {t.status}
                      </span>
                    </td>
                    <td>{t.name}</td>
                    <td>{t.activatedAt ? formatInstant(t.activatedAt) : '-'}</td>
                    <td>
                      <div className="actions-row">
                        <a className="button secondary compact" href={`?preview=${t.id}`}>
                          Preview
                        </a>
                        {canDraft ? (
                          <form action={testSendNotifTemplateAction}>
                            <input type="hidden" name="templateId" value={t.id} />
                            <button type="submit" className="secondary compact">
                              Test send (capture)
                            </button>
                          </form>
                        ) : null}
                        {t.status === 'DRAFT' && canActivate ? (
                          <form action={activateNotifTemplateAction}>
                            <input type="hidden" name="templateId" value={t.id} />
                            <button type="submit" className="compact">
                              Activate version
                            </button>
                          </form>
                        ) : null}
                        {t.status === 'DRAFT' && canActivate ? (
                          <details className="action">
                            <summary>Retire draft</summary>
                            <form action={retireNotifTemplateAction} className="stack">
                              <input type="hidden" name="templateId" value={t.id} />
                              <label htmlFor={`rr-${t.id}`}>Reason (required, audited)</label>
                              <input id={`rr-${t.id}`} name="reason" required maxLength={500} />
                              <button type="submit" className="danger compact">
                                Retire draft
                              </button>
                            </form>
                          </details>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {templates.length === 0 ? (
        <p className="panel">No notification template versions exist yet.</p>
      ) : null}

      {canDraft ? (
        <details className="action">
          <summary>Draft a new version</summary>
          <form action={draftNotifTemplateAction} className="stack panel">
            <div className="field">
              <label htmlFor="nt-type">Notification type</label>
              <select id="nt-type" name="notificationType" required defaultValue="">
                <option value="" disabled>
                  Choose...
                </option>
                {NOTIFICATION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <details>
              <summary>Allowed placeholders per type (minimum-data allow-list)</summary>
              <ul>
                {NOTIFICATION_TYPES.map((t) => (
                  <li key={t}>
                    <code>{t}</code>: {NOTIFICATION_PLACEHOLDERS[t].join(', ')}
                  </li>
                ))}
              </ul>
            </details>
            <div className="field">
              <label htmlFor="nt-name">Name</label>
              <input id="nt-name" name="name" required maxLength={200} />
            </div>
            <div className="field">
              <label htmlFor="nt-subject">Subject (plain text, [[PLACEHOLDER]] tokens)</label>
              <input id="nt-subject" name="subjectTemplate" required maxLength={300} />
            </div>
            <div className="field" style={{ maxWidth: '46rem' }}>
              <label htmlFor="nt-body">Body (plain text, [[PLACEHOLDER]] tokens)</label>
              <textarea id="nt-body" name="bodyTemplate" required rows={12} maxLength={10000} />
            </div>
            <div className="field">
              <label htmlFor="nt-mindata">
                Minimum-data note (what this email may carry, and why)
              </label>
              <textarea id="nt-mindata" name="minimumDataNote" required rows={2} maxLength={1000} />
            </div>
            <div className="field">
              <label htmlFor="nt-reason">Change reason (required, audited)</label>
              <input id="nt-reason" name="changeReason" required maxLength={500} />
            </div>
            <button type="submit">Create draft version</button>
          </form>
        </details>
      ) : null}
    </>
  );
}
