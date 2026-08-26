import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  formatInstant,
  letterTypeForDeparture,
  DOWNLOADABLE_DOC_STATUSES,
  RENDERABLE_LETTER_TYPES,
  type DocumentStatus,
  type DocumentType,
} from '@exit/domain';
import {
  ServiceError,
  getCase,
  getCaseDocuments,
  listAttachments,
  listHrCcContacts,
} from '@exit/db';
import { requireAuth } from '@/lib/auth';
import { CaseTitle, Feedback, RestrictedBanner } from '@/components/ui';
import { CaseNav } from '../CaseNav';
import {
  approveDocAction,
  createExceptionAction,
  createLetterAction,
  issueByEmailAction,
  markIssuedAction,
  setAddressAction,
  refreshFieldsAction,
  returnDocAction,
  submitDocAction,
  supersedeDocAction,
  voidDocAction,
} from './actions';
import { humanize } from '@/lib/text';
import { EmptyState } from '@/components/EmptyState';
import { DocObject } from '@/components/patterns';
import { DocumentIcon } from '@/components/icons';

export const metadata: Metadata = { title: 'Case Documents' };
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
  ISSUED_BY_EMAIL: 'badge--success',
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
      return (
        <>
          <h1>Access Restricted</h1>
          <p className="panel">This area requires explicit case assignment.</p>
        </>
      );
    throw e;
  }
  const c = caseData.case;
  const attachments = await listAttachments(actor, id);
  // Only loaded where the officer can actually issue the letter.
  const ccContacts = docsData.capabilities.canIssue ? await listHrCcContacts(actor, id) : [];
  const letterType = letterTypeForDeparture(c.departureType);
  const uploadedExceptionDocs = attachments.filter(
    (a) => a.purpose === 'MANUAL_EXCEPTION_DOCUMENT' || a.purpose === 'SUPPORTING_DOCUMENT',
  );

  return (
    <>
      <CaseTitle title="Documents" caseNumber={c.caseNumber} />
      {c.classification === 'RESTRICTED' ? <RestrictedBanner /> : null}
      <CaseNav caseId={id} active="documents" />
      <Feedback err={sp.err} ok={sp.ok} />

      {docsData.capabilities.canCreate && (
        <section className="panel actions-row" aria-label="Create documents">
          {/* H.1 (Directive 3): no letter path exists for terminations. */}
          {letterType !== null ? (
            <form action={createLetterAction}>
              <input type="hidden" name="caseId" value={id} />
              <button type="submit">Create resignation document draft</button>
            </form>
          ) : null}
          <details className="action">
            <summary>Create manual-exception document</summary>
            <form action={createExceptionAction} className="stack">
              <input type="hidden" name="caseId" value={id} />
              <div className="field">
                <label htmlFor="ex-att">Uploaded Final Document (From Attachments)</label>
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
                <label htmlFor="ex-reason">Exception Reason (Required, Audited)</label>
                <textarea id="ex-reason" name="reason" rows={2} required maxLength={500} />
              </div>
              <button type="submit">Create exception document</button>
            </form>
          </details>
        </section>
      )}

      {letterType !== null && docsData.capabilities.canEdit ? (
        <section className="panel" aria-labelledby="letter-address-h">
          <h2 id="letter-address-h" style={{ marginTop: 0 }}>
            Address on the Letter
          </h2>
          <p className="hint">
            Typed from the resignation letter scan. The directory holds no home address, so the
            acceptance letter cannot be submitted until this is recorded.
          </p>
          <form action={setAddressAction} className="stack">
            <input type="hidden" name="caseId" value={id} />
            <div className="field">
              <label htmlFor="emp-address">Employee Address</label>
              <textarea
                id="emp-address"
                name="employeeAddress"
                rows={3}
                maxLength={300}
                defaultValue={docsData.delivery.employeeAddress ?? ''}
                placeholder={'14 Fictional Way,\nSt. Andrew'}
              />
              <span className="hint">
                One line per line of the address, exactly as it should print.
              </span>
            </div>
            <button type="submit" className="secondary">
              Save address
            </button>
          </form>
        </section>
      ) : null}

      {docsData.docs.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon={<DocumentIcon />}
            title="No documents yet"
            body="Letters and forms appear here once they are drafted for this case."
          />
        </div>
      ) : (
        docsData.docs.map((d) => {
          const att = docsData.attestations.filter((a) => a.subjectId === d.id);
          return (
            <section key={d.id} className="panel" aria-label={`${d.documentType} v${d.version}`}>
              {/* A document reads as a document: a sheet, its name, what it
                  is, where it stands, and what can be done with it. */}
              <DocObject
                icon={<DocumentIcon />}
                name={d.template?.name ?? humanize(d.documentType)}
                meta={
                  <>
                    {humanize(d.documentType)} · version {d.version}
                    {d.issuedAt ? ` · issued ${formatInstant(d.issuedAt)}` : ''}
                  </>
                }
                status={
                  <span className={`badge ${STATUS_BADGE[d.status] ?? 'badge--neutral'}`}>
                    {humanize(d.status)}
                  </span>
                }
                actions={
                  docsData.capabilities.canDownload &&
                  DOWNLOADABLE_DOC_STATUSES.includes(d.status as DocumentStatus) ? (
                    <a className="button secondary compact" href={`/api/documents/${d.id}/pdf`}>
                      Download PDF
                    </a>
                  ) : null
                }
              />

              {Array.isArray(d.validationErrors) && d.validationErrors.length > 0 ? (
                <div className="error-summary" role="alert">
                  <h3 style={{ marginTop: 0 }}>Validation Issues</h3>
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
                <dt>Template / Document Version</dt>
                <dd>
                  {d.templateVersion ? `template v${d.templateVersion}` : 'n/a'} / document v
                  {d.version}
                </dd>
                {d.contentChecksum ? (
                  <>
                    <dt>Content Checksum</dt>
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
                    <dt>Manually Issued</dt>
                    <dd>
                      {formatInstant(d.issuedAt)} - {humanize(d.issueMethod)} to{' '}
                      {humanize(d.recipientClass)}
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
                          <label htmlFor={`ret-${d.id}`}>Reason (Required)</label>
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
                        <label htmlFor={`m-${d.id}`}>Issue Method</label>
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
                        <label htmlFor={`n-${d.id}`}>Note (Optional, Non-sensitive)</label>
                        <input id={`n-${d.id}`} name="note" type="text" maxLength={300} />
                      </div>
                      <button type="submit">Record issue</button>
                    </form>
                  </details>
                ) : null}
                {d.status === 'RENDERED' &&
                docsData.capabilities.canIssue &&
                RENDERABLE_LETTER_TYPES.includes(d.documentType as DocumentType) ? (
                  <details className="action">
                    <summary>Send to the employee by email</summary>
                    <form action={issueByEmailAction} className="stack">
                      <input type="hidden" name="caseId" value={id} />
                      <input type="hidden" name="docId" value={d.id} />
                      <p className="hint">
                        The letter goes to{' '}
                        <strong>
                          {docsData.delivery.employeeEmailMask ?? 'no address on file'}
                        </strong>{' '}
                        with the signed PDF attached. Sending issues the letter - it cannot be
                        recalled, only superseded by a corrected version.
                      </p>
                      <fieldset className="stack">
                        <legend>Copy To (Human Resources)</legend>
                        {ccContacts.length === 0 ? (
                          <p className="hint">
                            No Human Resources contacts with a work email are on record.
                          </p>
                        ) : (
                          ccContacts.map((p) => (
                            <label key={p.sourceId} className="checkbox-row">
                              <input type="checkbox" name="ccIds" value={p.sourceId} />{' '}
                              {p.displayName}
                              {p.jobTitle ? ` - ${p.jobTitle}` : ''}{' '}
                              <span className="hint">{p.emailMask}</span>
                            </label>
                          ))
                        )}
                      </fieldset>
                      <div className="field">
                        <label htmlFor={`en-${d.id}`}>Note (Optional, Non-sensitive)</label>
                        <input id={`en-${d.id}`} name="note" type="text" maxLength={300} />
                      </div>
                      <button type="submit" disabled={!docsData.delivery.employeeEmailMask}>
                        Send letter
                      </button>
                    </form>
                  </details>
                ) : null}
                {['RENDERED', 'MANUALLY_ISSUED', 'ISSUED_BY_EMAIL'].includes(d.status) &&
                docsData.capabilities.canApprove ? (
                  <details className="action">
                    <summary>Supersede with corrected version</summary>
                    <form action={supersedeDocAction} className="stack">
                      <input type="hidden" name="caseId" value={id} />
                      <input type="hidden" name="docId" value={d.id} />
                      <div className="field">
                        <label htmlFor={`s-${d.id}`}>Reason (Required)</label>
                        <textarea id={`s-${d.id}`} name="reason" rows={2} required />
                      </div>
                      <button type="submit" className="secondary">
                        Supersede and create corrected draft
                      </button>
                    </form>
                  </details>
                ) : null}
                {!['MANUALLY_ISSUED', 'ISSUED_BY_EMAIL', 'SUPERSEDED', 'VOIDED'].includes(
                  d.status,
                ) && docsData.capabilities.canApprove ? (
                  <details className="action">
                    <summary>Void</summary>
                    <form action={voidDocAction} className="stack">
                      <input type="hidden" name="caseId" value={id} />
                      <input type="hidden" name="docId" value={d.id} />
                      <div className="field">
                        <label htmlFor={`v-${d.id}`}>Reason (Required)</label>
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
