import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatInstant } from '@exit/domain';
import { ServiceError, getCase, getCaseDocuments, listAttachments } from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { Feedback, RestrictedBanner } from '@/components/ui';
import { CaseNav } from '../CaseNav';
import {
  approveDocAction,
  createExceptionAction,
  createLetterAction,
  markIssuedAction,
  refreshFieldsAction,
  returnDocAction,
  submitDocAction,
  supersedeDocAction,
  voidDocAction,
} from './actions';

export const metadata: Metadata = { title: 'Case documents' };
export const dynamic = 'force-dynamic';

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'badge--neutral',
  VALIDATION_FAILED: 'badge--danger',
  PENDING_APPROVAL: 'badge--warning',
  RETURNED: 'badge--warning',
  APPROVED: 'badge--info',
  RENDERING: 'badge--info',
  RENDERED: 'badge--success',
  MANUALLY_ISSUED: 'badge--success',
  SUPERSEDED: 'badge--neutral',
  VOIDED: 'badge--neutral',
  RENDER_FAILED: 'badge--danger',
};

export default async function CaseDocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { actor } = await requireAuth();
  const { id } = await params;
  const sp = await searchParams;

  let caseData: Awaited<ReturnType<typeof getCase>>;
  let docsData: Awaited<ReturnType<typeof getCaseDocuments>>;
  try {
    caseData = await getCase(actor, id);
    docsData = await getCaseDocuments(actor, id);
  } catch (e) {
    if (e instanceof ServiceError && e.code === 'NOT_FOUND') notFound();
    if (e instanceof ServiceError && e.code === 'FORBIDDEN')
      return <p className="panel">This area requires explicit case assignment.</p>;
    throw e;
  }
  const c = caseData.case;
  const attachments = await listAttachments(actor, id);
  const uploadedExceptionDocs = attachments.filter(
    (a) => a.purpose === 'MANUAL_EXCEPTION_DOCUMENT' || a.purpose === 'SUPPORTING_DOCUMENT',
  );

  return (
    <>
      <h1>{c.caseNumber} - Documents</h1>
      {c.classification === 'RESTRICTED' ? <RestrictedBanner /> : null}
      <CaseNav caseId={id} active="documents" />
      <Feedback err={sp.err} ok={sp.ok} />

      {docsData.capabilities.canCreate && (
        <section className="panel actions-row" aria-label="Create documents">
          <form action={createLetterAction}>
            <input type="hidden" name="caseId" value={id} />
            <button type="submit">Create resignation document draft</button>
          </form>
          <details className="action">
            <summary>Create manual-exception document</summary>
            <form action={createExceptionAction} className="stack">
              <input type="hidden" name="caseId" value={id} />
              <div className="field">
                <label htmlFor="ex-att">Uploaded final document (from Attachments)</label>
                <select id="ex-att" name="attachmentId" required defaultValue="">
                  <option value="" disabled>
                    Choose an uploaded file...
                  </option>
                  {uploadedExceptionDocs.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.fileName} ({a.scanStatus})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="ex-reason">Exception reason (required, audited)</label>
                <textarea id="ex-reason" name="reason" rows={2} required maxLength={500} />
              </div>
              <button type="submit">Create exception document</button>
            </form>
          </details>
        </section>
      )}

      {docsData.docs.length === 0 ? (
        <p className="panel">No documents yet.</p>
      ) : (
        docsData.docs.map((d) => {
          const att = docsData.attestations.filter((a) => a.subjectId === d.id);
          return (
            <section key={d.id} className="panel" aria-label={`${d.documentType} v${d.version}`}>
              <h2 style={{ marginTop: 0 }}>
                {d.template?.name ?? d.documentType.replaceAll('_', ' ').toLowerCase()}{' '}
                <span className="badge badge--neutral">v{d.version}</span>{' '}
                <span className={`badge ${STATUS_BADGE[d.status] ?? 'badge--neutral'}`}>
                  {d.status.replaceAll('_', ' ')}
                </span>
              </h2>

              {Array.isArray(d.validationErrors) && d.validationErrors.length > 0 ? (
                <div className="error-summary" role="alert">
                  <h3 style={{ marginTop: 0 }}>Validation issues</h3>
                  <ul>
                    {(d.validationErrors as string[]).map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {d.returnReason && d.status === 'RETURNED' ? (
                <p className="banner-baseline">Returned: {d.returnReason}</p>
              ) : null}
              {d.renderError && d.status === 'RENDER_FAILED' ? (
                <p className="banner-restricted">
                  Render failed - the worker will retry. ({d.renderError})
                </p>
              ) : null}

              {d.contentSnapshot ? (
                <details className="action" open={d.status === 'PENDING_APPROVAL'}>
                  <summary>Preview (exact content bound to approval)</summary>
                  <div
                    style={{
                      whiteSpace: 'pre-wrap',
                      background: 'var(--muted)',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      padding: '1rem',
                      fontFamily: 'Georgia, serif',
                      marginTop: '0.5rem',
                    }}
                  >
                    {d.contentSnapshot}
                  </div>
                </details>
              ) : d.exceptionReason ? (
                <p className="hint">Manual exception: {d.exceptionReason}</p>
              ) : (
                <p className="hint">Draft - submit to capture the reviewed content snapshot.</p>
              )}

              <dl className="kv" style={{ marginTop: '0.5rem' }}>
                <dt>Template / document version</dt>
                <dd>
                  {d.templateVersion ? `template v${d.templateVersion}` : 'n/a'} / document v
                  {d.version}
                </dd>
                {d.contentChecksum ? (
                  <>
                    <dt>Content checksum</dt>
                    <dd>
                      <code>{d.contentChecksum.slice(0, 16)}...</code>
                    </dd>
                  </>
                ) : null}
                {d.pdfChecksum ? (
                  <>
                    <dt>Final PDF</dt>
                    <dd>
                      <a href={`/api/documents/${d.id}/pdf`}>Download PDF</a>{' '}
                      <span className="hint">
                        sha256 {d.pdfChecksum.slice(0, 16)}...{' '}
                        {d.status === 'SUPERSEDED' ? '(superseded copy)' : ''}
                      </span>
                    </dd>
                  </>
                ) : null}
                {d.issuedAt ? (
                  <>
                    <dt>Manually issued</dt>
                    <dd>
                      {formatInstant(d.issuedAt)} -{' '}
                      {d.issueMethod?.replaceAll('_', ' ').toLowerCase()} to{' '}
                      {d.recipientClass?.replaceAll('_', ' ').toLowerCase()}
                      {d.issueNote ? ` (${d.issueNote})` : ''}
                    </dd>
                  </>
                ) : null}
                {att.length ? (
                  <>
                    <dt>Approvals</dt>
                    <dd>
                      {att.map((a) => (
                        <div key={a.id}>
                          {a.actorDisplayName} ({a.actorRole}) - {formatInstant(a.createdAt)}
                          {a.invalidatedAt ? (
                            <strong> INVALIDATED: {a.invalidatedReason}</strong>
                          ) : null}
                        </div>
                      ))}
                    </dd>
                  </>
                ) : null}
              </dl>

              <div className="actions-row" style={{ marginTop: '0.5rem' }}>
                {['DRAFT', 'RETURNED', 'VALIDATION_FAILED'].includes(d.status) && d.templateId ? (
                  <>
                    <form action={refreshFieldsAction}>
                      <input type="hidden" name="caseId" value={id} />
                      <input type="hidden" name="docId" value={d.id} />
                      <button type="submit" className="secondary">
                        Refresh fields from case
                      </button>
                    </form>
                    <form action={submitDocAction}>
                      <input type="hidden" name="caseId" value={id} />
                      <input type="hidden" name="docId" value={d.id} />
                      <button type="submit">Validate and submit for approval</button>
                    </form>
                  </>
                ) : null}
                {d.status === 'DRAFT' && !d.templateId ? (
                  <form action={submitDocAction}>
                    <input type="hidden" name="caseId" value={id} />
                    <input type="hidden" name="docId" value={d.id} />
                    <button type="submit">Submit exception for approval</button>
                  </form>
                ) : null}
                {d.status === 'PENDING_APPROVAL' && docsData.capabilities.canApprove ? (
                  <>
                    <form action={approveDocAction}>
                      <input type="hidden" name="caseId" value={id} />
                      <input type="hidden" name="docId" value={d.id} />
                      <button type="submit">Approve exact version (attested)</button>
                    </form>
                    <details className="action">
                      <summary>Return for correction</summary>
                      <form action={returnDocAction} className="stack">
                        <input type="hidden" name="caseId" value={id} />
                        <input type="hidden" name="docId" value={d.id} />
                        <div className="field">
                          <label htmlFor={`ret-${d.id}`}>Reason (required)</label>
                          <textarea id={`ret-${d.id}`} name="reason" rows={2} required />
                        </div>
                        <button type="submit" className="secondary">
                          Return
                        </button>
                      </form>
                    </details>
                  </>
                ) : null}
                {d.status === 'RENDERED' && docsData.capabilities.canApprove ? (
                  <details className="action">
                    <summary>Record manual issue (no email is sent)</summary>
                    <form action={markIssuedAction} className="stack">
                      <input type="hidden" name="caseId" value={id} />
                      <input type="hidden" name="docId" value={d.id} />
                      <div className="field">
                        <label htmlFor={`m-${d.id}`}>Issue method</label>
                        <select id={`m-${d.id}`} name="method" defaultValue="HAND_DELIVERY">
                          <option value="HAND_DELIVERY">Hand delivery</option>
                          <option value="REGISTERED_MAIL">Registered mail</option>
                          <option value="OTHER_APPROVED">Other approved method</option>
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor={`r-${d.id}`}>Recipient</label>
                        <select id={`r-${d.id}`} name="recipientClass" defaultValue="EMPLOYEE">
                          <option value="EMPLOYEE">Employee</option>
                          <option value="AUTHORIZED_REPRESENTATIVE">
                            Authorized representative
                          </option>
                          <option value="INTERNAL_RECORD">Internal record</option>
                        </select>
                      </div>
                      <div className="field">
                        <label htmlFor={`n-${d.id}`}>Note (optional, non-sensitive)</label>
                        <input id={`n-${d.id}`} name="note" type="text" maxLength={300} />
                      </div>
                      <button type="submit">Record issue</button>
                    </form>
                  </details>
                ) : null}
                {['RENDERED', 'MANUALLY_ISSUED'].includes(d.status) &&
                docsData.capabilities.canApprove ? (
                  <details className="action">
                    <summary>Supersede with corrected version</summary>
                    <form action={supersedeDocAction} className="stack">
                      <input type="hidden" name="caseId" value={id} />
                      <input type="hidden" name="docId" value={d.id} />
                      <div className="field">
                        <label htmlFor={`s-${d.id}`}>Reason (required)</label>
                        <textarea id={`s-${d.id}`} name="reason" rows={2} required />
                      </div>
                      <button type="submit" className="secondary">
                        Supersede and create corrected draft
                      </button>
                    </form>
                  </details>
                ) : null}
                {!['MANUALLY_ISSUED', 'SUPERSEDED', 'VOIDED'].includes(d.status) &&
                docsData.capabilities.canApprove ? (
                  <details className="action">
                    <summary>Void</summary>
                    <form action={voidDocAction} className="stack">
                      <input type="hidden" name="caseId" value={id} />
                      <input type="hidden" name="docId" value={d.id} />
                      <div className="field">
                        <label htmlFor={`v-${d.id}`}>Reason (required)</label>
                        <textarea id={`v-${d.id}`} name="reason" rows={2} required />
                      </div>
                      <button type="submit" className="danger">
                        Void document
                      </button>
                    </form>
                  </details>
                ) : null}
              </div>
            </section>
          );
        })
      )}
    </>
  );
}
