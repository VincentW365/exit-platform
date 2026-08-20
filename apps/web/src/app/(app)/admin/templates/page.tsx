import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { can, formatInstant, DOCUMENT_PLACEHOLDERS } from '@exit/domain';
import { listTemplates } from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { Feedback } from '@/components/ui';
import {
  activateTemplateAction,
  createTemplateAction,
  retireTemplateAction,
  updateTemplateAction,
} from './actions';
import { humanize } from '@/lib/text';

export const metadata: Metadata = { title: 'Document Templates' };
export const dynamic = 'force-dynamic';

const TPL_BADGE: Record<string, string> = {
  DRAFT: 'badge--neutral',
  ACTIVE: 'badge--success',
  SUPERSEDED: 'badge--neutral',
  RETIRED: 'badge--warning',
};

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; ok?: string }>;
}) {
  const { actor } = await requireAuth();
  if (!can(actor, 'template.view')) redirect('/unauthorized');
  const sp = await searchParams;
  const templates = await listTemplates(actor);
  const canDraft = can(actor, 'template.draft');
  const canActivate = can(actor, 'template.activate');

  return (
    <>
      <h1>Controlled Document Templates</h1>
      <Feedback err={sp.err} ok={sp.ok} />
      <p className="hint">
        Active templates are immutable; edits create a new draft version. Officers draft, HR
        Managers activate. Development templates are clearly marked and require HR approval before
        operational use. The termination placeholder is permanently disabled in this increment.
      </p>

      {canDraft ? (
        <details className="action" style={{ marginBottom: '1rem' }}>
          <summary>Create a new draft version</summary>
          <form action={createTemplateAction} className="stack panel">
            <div className="field">
              <label htmlFor="t-type">Document Type</label>
              <select id="t-type" name="documentType" required defaultValue="">
                <option value="" disabled>
                  Choose...
                </option>
                <option value="RESIGNATION_ACCEPTANCE_WITH_NOTICE">
                  Resignation acceptance (with notice)
                </option>
                <option value="IMMEDIATE_RESIGNATION_ACKNOWLEDGEMENT">
                  Immediate resignation acknowledgement
                </option>
                <option value="OFFBOARDING_ACTION_FORM">Offboarding action form</option>
                <option value="MANUAL_EXCEPTION_DOCUMENT">Manual exception document</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="t-name">Name</label>
              <input id="t-name" name="name" type="text" required maxLength={120} />
            </div>
            <div className="field" style={{ maxWidth: '46rem' }}>
              <label htmlFor="t-body">
                Content (Plain Text; Placeholders Like [[EMPLOYEE_LEGAL_NAME]])
              </label>
              <textarea id="t-body" name="contentBody" rows={12} />
              <p className="hint">Allowed placeholders: {DOCUMENT_PLACEHOLDERS.join(', ')}</p>
            </div>
            <div className="field">
              <label htmlFor="t-reason">Reason for Change</label>
              <input id="t-reason" name="changeReason" type="text" maxLength={200} />
            </div>
            <button type="submit">Create draft</button>
          </form>
        </details>
      ) : null}

      {templates.map((t) => (
        <section key={t.id} className="panel" aria-label={`${t.name} v${t.version}`}>
          <h2 style={{ marginTop: 0 }}>
            {t.name} <span className="badge badge--neutral">v{t.version}</span>{' '}
            <span className={`badge ${TPL_BADGE[t.status]}`}>{humanize(t.status)}</span>
          </h2>
          <dl className="kv">
            <dt>Type</dt>
            <dd>{humanize(t.documentType)}</dd>
            <dt>Checksum</dt>
            <dd>
              <code>{t.contentChecksum.slice(0, 16)}...</code>
            </dd>
            {t.activatedAt ? (
              <>
                <dt>Activated</dt>
                <dd>{formatInstant(t.activatedAt)}</dd>
              </>
            ) : null}
            {t.changeReason ? (
              <>
                <dt>Change Reason</dt>
                <dd>{t.changeReason}</dd>
              </>
            ) : null}
          </dl>
          {t.contentBody ? (
            <details className="action">
              <summary>View content</summary>
              <pre
                tabIndex={0}
                style={{
                  whiteSpace: 'pre-wrap',
                  background: 'var(--muted)',
                  padding: '0.75rem',
                  borderRadius: '6px',
                  overflowX: 'auto',
                }}
              >
                {t.contentBody}
              </pre>
            </details>
          ) : (
            <p className="hint">No body content (upload-based or disabled placeholder).</p>
          )}
          <div className="actions-row" style={{ marginTop: '0.5rem' }}>
            {t.status === 'DRAFT' &&
            canDraft &&
            t.documentType !== 'TERMINATION_DOCUMENT_PLACEHOLDER' ? (
              <details className="action">
                <summary>Edit draft</summary>
                <form action={updateTemplateAction} className="stack">
                  <input type="hidden" name="templateId" value={t.id} />
                  <div className="field">
                    <label htmlFor={`n-${t.id}`}>Name</label>
                    <input
                      id={`n-${t.id}`}
                      name="name"
                      type="text"
                      defaultValue={t.name}
                      maxLength={120}
                    />
                  </div>
                  <div className="field" style={{ maxWidth: '46rem' }}>
                    <label htmlFor={`b-${t.id}`}>Content</label>
                    <textarea
                      id={`b-${t.id}`}
                      name="contentBody"
                      rows={12}
                      defaultValue={t.contentBody}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`r-${t.id}`}>Reason for Change</label>
                    <input id={`r-${t.id}`} name="changeReason" type="text" maxLength={200} />
                  </div>
                  <button type="submit">Save draft</button>
                </form>
              </details>
            ) : null}
            {t.status === 'DRAFT' &&
            canActivate &&
            t.documentType !== 'TERMINATION_DOCUMENT_PLACEHOLDER' ? (
              <form action={activateTemplateAction}>
                <input type="hidden" name="templateId" value={t.id} />
                <button type="submit">Activate (supersedes prior active)</button>
              </form>
            ) : null}
            {t.status === 'ACTIVE' && canActivate ? (
              <details className="action">
                <summary>Retire</summary>
                <form action={retireTemplateAction} className="stack">
                  <input type="hidden" name="templateId" value={t.id} />
                  <div className="field">
                    <label htmlFor={`ret-${t.id}`}>Reason (Required)</label>
                    <input id={`ret-${t.id}`} name="reason" type="text" required maxLength={200} />
                  </div>
                  <button type="submit" className="danger">
                    Retire template
                  </button>
                </form>
              </details>
            ) : null}
            {t.documentType === 'TERMINATION_DOCUMENT_PLACEHOLDER' ? (
              <p className="banner-restricted" style={{ margin: 0 }}>
                Permanently disabled: cannot be activated, rendered or issued in this increment.
              </p>
            ) : null}
          </div>
        </section>
      ))}
    </>
  );
}
